import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { randomBase62 } from "./api-keys.js";
import type { DueDelivery, PaymentEvent, Store } from "./store.js";
import { Vault } from "./vault.js";

/**
 * Outbound webhooks: an account's endpoints get a signed POST for each payment event. Every event is
 * stored per endpoint first (webhook_deliveries) and sent from there by a background loop with
 * retries, so a restart or a deploy loses none. Nothing here can fail or hold up a payment: queueing
 * errors are logged (Store.emitPayment), sending runs detached.
 */

export const WEBHOOK_EVENTS = ["payment.created", "payment.updated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** `ping` is sent only on request (POST /webhooks/:id/test), whatever the endpoint subscribed to. */
export type WebhookEventType = WebhookEvent | "ping";

/** An endpoint as the API shows it: never its secret. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string;
  /** When the latest attempt was made, successful or not. */
  lastDeliveryAt?: string;
  /** The HTTP status of the latest attempt; 0 when the endpoint gave no HTTP answer (timeout, refused, blocked). */
  lastStatus?: number;
}

export const MAX_WEBHOOKS = 10;
/** The first attempt and five retries, after 1 min, 5 min, 30 min, 2 h and 6 h. */
export const MAX_ATTEMPTS = 6;
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;
export const DELIVERY_TIMEOUT_MS = 10_000;
/** A claimed delivery is out of reach this long: a crash mid-attempt is retried after it. */
const LEASE_MS = 60_000;
const BATCH = 100;
const CONCURRENCY = 8;
const KEEP_MS = 30 * 24 * 3_600_000;
const MAX_URL_LENGTH = 2048;

export const SECRET_PATTERN = /^whsec_[0-9A-Za-z]{40}$/;
export const USER_AGENT = "PayLorya-Webhooks/1";

// Signature --------------------------------------------------------------------------------

const hmac = (secret: string, t: number, rawBody: string | Uint8Array) => createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");

/** The x-paylorya-signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. */
export function signWebhook(secret: string, rawBody: string | Uint8Array, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmac(secret, t, rawBody)}`;
}

/**
 * Checks an x-paylorya-signature header against the raw request body, as received (before any JSON
 * parsing). The key is the whole secret, `whsec_` included. False when the header is missing or
 * malformed, the signature does not match, or `t` is more than `toleranceSec` from now (replays).
 */
export function verifyWebhookSignature(secret: string, header: string | null | undefined, rawBody: string | Uint8Array, toleranceSec = 300): boolean {
  if (!header) return false;
  let t: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (t === undefined || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(hmac(secret, t, rawBody), "hex");
  return signatures.some(s => timingSafeEqual(Buffer.from(s, "hex"), expected));
}

// Where a webhook may point ----------------------------------------------------------------

/** Addresses that are not on the public internet: private, loopback, link-local, shared, reserved. */
const NOT_PUBLIC = new BlockList();
const V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
for (const [net, prefix] of V4_RANGES) {
  NOT_PUBLIC.addSubnet(net, prefix, "ipv4");
  // The same ranges inside NAT64 and 6to4 addresses (IPv4-mapped ::ffff:0:0/96 is matched by BlockList itself).
  NOT_PUBLIC.addSubnet(`64:ff9b::${net}`, 96 + prefix, "ipv6");
  const [a, b, c, d] = net.split(".").map(Number) as [number, number, number, number];
  NOT_PUBLIC.addSubnet(`2002:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}::`, 16 + prefix, "ipv6");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["64:ff9b:1::", 48],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as Array<[string, number]>) {
  NOT_PUBLIC.addSubnet(net, prefix, "ipv6");
}

/** True for an IP address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Names that never leave this host or its private network. */
const LOCAL_NAME = /(^|\.)(localhost|internal|local|localdomain|home\.arpa)$/;

export interface UrlPolicy {
  /** In production: https only, and only public addresses. */
  production: boolean;
  /** Hosts never allowed, e.g. the Cloudflare data proxy (CFO_DATA_URL). */
  blockedHosts?: string[];
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

/** Where a webhook may point. Checked when it is created and again before every attempt. */
export function checkWebhookUrl(raw: string, policy: UrlPolicy): { ok: true; url: URL } | { ok: false; error: string } {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: `The URL is longer than ${MAX_URL_LENGTH} characters.` };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "This is not a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Use an https:// URL." };
  if (url.username || url.password) return { ok: false, error: "Put no user name or password in the URL: check the x-paylorya-signature header instead." };
  const host = bare(url.hostname);
  if (policy.blockedHosts?.some(h => bare(h) === host)) return { ok: false, error: "This host cannot receive webhooks." };
  if (url.protocol === "http:" && (policy.production || (host !== "localhost" && host !== "127.0.0.1"))) {
    return { ok: false, error: policy.production ? "Use an https:// URL." : "Use an https:// URL (http:// only for localhost and 127.0.0.1 while testing)." };
  }
  if (policy.production) {
    if (isIP(host) && !isPublicAddress(host)) return { ok: false, error: "This URL points to a private, loopback or link-local address: use a public https:// URL." };
    if (!isIP(host) && (LOCAL_NAME.test(host) || !host.includes("."))) return { ok: false, error: "This URL points to a local host name: use a public https:// URL." };
  }
  url.hash = "";
  return { ok: true, url };
}

// Delivery ---------------------------------------------------------------------------------

/** Resolves a host name to all its addresses (the DNS check before every attempt). */
export type Resolve = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface WebhooksOptions extends UrlPolicy {
  /** Tests: a stand-in for DNS. */
  resolve?: Resolve;
  timeoutMs?: number;
}

/** The outcome of one attempt. `status` is the HTTP status, 0 without an HTTP answer. */
export interface AttemptResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** A request the caller must change: shown to the person, nothing is stored. */
export class WebhookRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

class BlockedAddress extends Error {
  readonly code = "EBLOCKED";
}

/** What a sealed signing secret is bound to: it only opens for this webhook of this account. */
const secretContext = (ws: string, id: string) => `webhook:${ws}:${id}`;
const iso = (ms: number) => new Date(ms).toISOString();
const maxAttempts = (type: WebhookEventType) => (type === "ping" ? 1 : MAX_ATTEMPTS);

function describe(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e instanceof BlockedAddress) return e.message;
  switch (e?.code) {
    case "ECONNREFUSED":
      return "connection refused";
    case "ECONNRESET":
      return "connection reset";
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ENODATA":
      return "host not found";
  }
  return e instanceof Error ? e.message : String(error);
}

export class Webhooks {
  private readonly vault?: Vault;
  private readonly resolve: Resolve;
  private auto = false;
  private passing?: Promise<void>;
  private again = false;
  private lastPrune = 0;

  constructor(
    private readonly store: Store,
    secret: string | undefined,
    private readonly opts: WebhooksOptions,
  ) {
    // Like connection credentials (cxc-keys.ts): without a fixed secret a sealed one would not survive a restart.
    if (secret) this.vault = new Vault(secret);
    this.resolve = opts.resolve ?? (hostname => dnsLookup(hostname, { all: true }));
  }

  get ready(): boolean {
    return Boolean(this.vault);
  }

  /** Creates an endpoint; its secret is returned this once and stored sealed (vault.ts). */
  async create(ws: string, input: { url: string; events?: WebhookEvent[] }): Promise<Pick<Webhook, "id" | "url" | "events" | "createdAt"> & { secret: string }> {
    if (!this.vault) throw new WebhookRefused("This server cannot sign webhooks (BETTER_AUTH_SECRET is not set).", 503);
    const checked = checkWebhookUrl(input.url, this.opts);
    if (!checked.ok) throw new WebhookRefused(checked.error);
    if ((await this.store.webhooks(ws)).length >= MAX_WEBHOOKS) throw new WebhookRefused(`This account has ${MAX_WEBHOOKS} webhooks: delete one first.`, 409);
    const events = WEBHOOK_EVENTS.filter(e => !input.events || input.events.includes(e));
    const id = randomUUID();
    const secret = `whsec_${randomBase62(40)}`;
    const w = await this.store.addWebhook(ws, { id, url: checked.url.toString(), events, secretEnc: this.vault.seal(secret, secretContext(ws, id)) });
    return { id: w.id, url: w.url, events: w.events, createdAt: w.createdAt, secret };
  }

  /** Store.onPaymentEvent: queues the event for every endpoint of the account that wants it. */
  async emitPayment(ws: string, event: PaymentEvent): Promise<void> {
    const data = event.type === "payment.created" ? { payment: event.payment } : { payment: event.payment, previousStatus: event.previousStatus };
    await this.enqueue(ws, event.type, data);
  }

  private async enqueue(ws: string, type: WebhookEventType, data: unknown, only?: { webhookId: string; leaseUntil: string }) {
    const eventId = `evt_${randomBase62(24)}`;
    const at = new Date().toISOString();
    const body = JSON.stringify({ id: eventId, type, createdAt: at, data });
    const queued = await this.store.enqueueWebhookEvent(ws, { eventId, type, body, at, nextAttemptAt: only?.leaseUntil ?? at }, only?.webhookId);
    if (queued > 0 && !only) this.kick();
    return { eventId, body, queued };
  }

  /** POST /webhooks/:id/test: a `ping`, sent at once and not retried. Undefined when there is no such webhook. */
  async ping(ws: string, id: string, now = Date.now()): Promise<({ id: string; type: "ping"; delivered: boolean } & Omit<AttemptResult, "ok">) | undefined> {
    const hook = await this.store.webhook(ws, id);
    const secretEnc = hook && (await this.store.webhookSecret(ws, id));
    if (!hook || !secretEnc) return undefined;
    // Queued already claimed, so the delivery loop leaves it to this request.
    const leaseUntil = iso(now + LEASE_MS);
    const { eventId, body, queued } = await this.enqueue(ws, "ping", { webhookId: id }, { webhookId: id, leaseUntil });
    if (queued === 0) return undefined; // deleted in between
    const r = await this.attempt({ webhookId: id, eventId, ws, type: "ping", body, attempts: 0, nextAttemptAt: leaseUntil, url: hook.url, secretEnc }, now);
    return { id: eventId, type: "ping", delivered: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) };
  }

  /**
   * One delivery pass: every delivery due by `now`, oldest first. Endpoints are served in parallel,
   * each one's events in order; an endpoint that fails gets no more attempts in this pass. Returns
   * how many attempts were made. Tests call it directly (createCfo's noSweep).
   */
  async deliverDue(now = Date.now()): Promise<number> {
    const groups = new Map<string, DueDelivery[]>();
    for (const d of await this.store.dueWebhookDeliveries(iso(now), BATCH)) groups.set(d.webhookId, [...(groups.get(d.webhookId) ?? []), d]);
    const queue = [...groups.values()];
    let attempted = 0;
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const d of group) {
          try {
            if (d.attempts >= maxAttempts(d.type)) {
              // Its last attempt was cut off (a restart): counted, not sent again.
              await this.store.finishWebhookDelivery(d, { status: "failed", attempts: d.attempts, nextAttemptAt: null, httpStatus: 0, error: "interrupted by a restart", at: iso(now) });
              continue;
            }
            if (!(await this.store.claimWebhookDelivery(d, iso(now + LEASE_MS)))) continue;
            attempted++;
            if (!(await this.attempt(d, now)).ok) break;
          } catch (error) {
            console.error(`webhook delivery ${d.eventId} to ${d.webhookId} failed`, error);
            break;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (now - this.lastPrune > 3_600_000) {
      this.lastPrune = now;
      await this.store.pruneWebhookDeliveries(iso(now - KEEP_MS)).catch(error => console.error("webhook delivery prune failed", error));
    }
    return attempted;
  }

  /** Background delivery: at once (deliveries left by a restart), every `intervalMs`, and after each new event. */
  start(intervalMs = 30_000): void {
    this.auto = true;
    this.kick();
    setInterval(() => this.kick(), intervalMs).unref();
  }

  private kick(): void {
    if (!this.auto) return;
    if (this.passing) {
      this.again = true;
      return;
    }
    this.passing = (async () => {
      try {
        do {
          this.again = false;
          await this.deliverDue().catch(error => console.error("webhook delivery pass failed", error));
        } while (this.again);
      } finally {
        this.passing = undefined;
      }
    })();
  }

  /** Sends a claimed delivery once and records the outcome: delivered, retried later, or failed for good. */
  private async attempt(d: DueDelivery, now: number): Promise<AttemptResult> {
    const attempts = d.attempts + 1;
    let r: AttemptResult;
    try {
      let secret: string;
      try {
        secret = this.vault!.open(d.secretEnc, secretContext(d.ws, d.webhookId));
      } catch {
        throw new Error("The signing secret cannot be read anymore (the server secret changed): delete this webhook and add it again.");
      }
      r = await this.send(d, secret);
    } catch (error) {
      r = { ok: false, status: 0, error: describe(error) };
    }
    const done = r.ok || attempts >= maxAttempts(d.type);
    await this.store.finishWebhookDelivery(d, {
      status: r.ok ? "delivered" : done ? "failed" : "pending",
      attempts,
      nextAttemptAt: done ? null : iso(now + RETRY_DELAYS_MS[attempts - 1]!),
      httpStatus: r.status,
      error: r.error ?? null,
      at: iso(now),
    });
    if (!r.ok && done && d.type !== "ping") {
      await this.store
        .log(d.ws, "system", "webhook delivery failed", `${d.type} ${d.eventId} to ${d.url}: ${r.error ?? `HTTP ${r.status}`}, after ${attempts} attempts`, { type: "webhook", id: d.webhookId })
        .catch(() => undefined);
    }
    return r;
  }

  /**
   * One signed POST: 2xx is success, anything else (redirects included, never followed) a failure.
   * The address connected to is the one checked: DNS is resolved here, and in production every
   * address of the host must be public.
   */
  private async send(d: Pick<DueDelivery, "url" | "type" | "eventId" | "body">, secret: string): Promise<AttemptResult> {
    const checked = checkWebhookUrl(d.url, this.opts);
    if (!checked.ok) return { ok: false, status: 0, error: checked.error };
    const url = checked.url;
    const host = bare(url.hostname);
    if (this.opts.production && isIP(host) && !isPublicAddress(host)) return { ok: false, status: 0, error: `refused: ${host} is not a public address` };
    const headers = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(d.body)),
      "user-agent": USER_AGENT,
      "x-paylorya-event": d.type,
      "x-paylorya-delivery": d.eventId,
      "x-paylorya-signature": signWebhook(secret, d.body),
    };
    const timeoutMs = this.opts.timeoutMs ?? DELIVERY_TIMEOUT_MS;
    return new Promise<AttemptResult>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (r: AttemptResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const req = (url.protocol === "https:" ? https : http).request(url, { method: "POST", headers, agent: false, lookup: this.lookup }, res => {
        const status = res.statusCode ?? 0;
        res.destroy(); // the answer's body is not read
        if (status >= 200 && status < 300) finish({ ok: true, status });
        else finish({ ok: false, status, error: status >= 300 && status < 400 ? `HTTP ${status}: redirects are not followed` : `HTTP ${status}` });
      });
      timer = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs);
      req.on("error", error => finish({ ok: false, status: 0, error: describe(error) }));
      req.end(d.body);
    });
  }

  /** DNS for the socket itself, so the address checked is the address connected to (no rebinding). */
  private readonly lookup: LookupFunction = (hostname, options, callback) => {
    this.resolve(hostname).then(
      addresses => {
        const blocked = this.opts.production ? addresses.find(a => !isPublicAddress(a.address)) : undefined;
        if (blocked) return callback(new BlockedAddress(`refused: ${hostname} resolves to ${blocked.address}, not a public address`), []);
        const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
        const usable = family ? addresses.filter(a => a.family === family) : addresses;
        if (usable.length === 0) return callback(Object.assign(new Error(`${hostname} has no address`), { code: "ENOTFOUND" }), []);
        if (options.all) callback(null, usable);
        else callback(null, usable[0]!.address, usable[0]!.family);
      },
      error => callback(error as NodeJS.ErrnoException, []),
    );
  };
}

/**
 * Production unless this server runs locally: its own URL is on a loopback host and it does not use
 * the Cloudflare data proxy. The app has no other production switch (it reaches only test networks).
 */
export function isProductionServer(config: { baseUrl: string; CFO_DATA_URL?: string }): boolean {
  if (config.CFO_DATA_URL) return true;
  try {
    return !["localhost", "127.0.0.1", "::1"].includes(bare(new URL(config.baseUrl).hostname));
  } catch {
    return true;
  }
}
