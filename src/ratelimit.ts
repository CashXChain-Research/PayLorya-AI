// Abuse limits for the public, unauthenticated POST /api/runs. In memory, one process (like RunStore).
// The request handling lives here, not in server.ts, so tests can run it without starting a server.
import type { Run, RunStore } from "./runs.js";
import { InvoiceSchema } from "./types.js";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

type Clock = () => number;

/** At most `limit` hits per key per window. A key's window starts at its first hit after the last one ended. */
export class FixedWindow {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private sweptAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  /** Whole seconds until `key` may hit again; 0 if it may now. Counts nothing. */
  wait(key: string): number {
    const now = this.now();
    const w = this.open(key, now);
    if (!w || w.count < this.limit) return 0;
    // An open window has time left, so this is at least 1.
    return Math.ceil((w.start + this.windowMs - now) / 1000);
  }

  hit(key: string): void {
    const now = this.now();
    this.sweep(now);
    const w = this.open(key, now);
    if (w) w.count += 1;
    else this.windows.set(key, { start: now, count: 1 });
  }

  get keys(): number {
    return this.windows.size;
  }

  private open(key: string, now: number) {
    const w = this.windows.get(key);
    return w && now - w.start < this.windowMs ? w : undefined;
  }

  // Drop ended windows at most once per window length, so one-off clients do not pile up.
  private sweep(now: number): void {
    if (now - this.sweptAt < this.windowMs) return;
    this.sweptAt = now;
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
  }
}

export interface RateLimited {
  scope: "client" | "global";
  retryAfterSec: number;
  message: string;
}

const ALL = "*";

/** Per-client runs per minute and overall runs per hour. A refused run counts against neither. */
export class RunRateLimiter {
  readonly perClient: FixedWindow;
  readonly global: FixedWindow;

  constructor(perClientPerMinute: number, perHour: number, now: Clock = Date.now) {
    this.perClient = new FixedWindow(perClientPerMinute, MINUTE_MS, now);
    this.global = new FixedWindow(perHour, HOUR_MS, now);
  }

  /** Undefined if `client` may start a run now. Counts nothing; call record() once the run exists. */
  check(client: string): RateLimited | undefined {
    const own = this.perClient.wait(client);
    const all = this.global.wait(ALL);
    if (!own && !all) return undefined;
    // Both must clear, so wait for the later one.
    const retryAfterSec = Math.max(own, all);
    return all >= own
      ? { scope: "global", retryAfterSec, message: `demo limit of ${this.global.limit} runs per hour reached; retry in ${retryAfterSec} s` }
      : { scope: "client", retryAfterSec, message: `limit of ${this.perClient.limit} runs per minute per client reached; retry in ${retryAfterSec} s` };
  }

  record(client: string): void {
    this.perClient.hit(client);
    this.global.hit(ALL);
  }
}

export type ClientIdSource = "cf-connecting-ip" | "x-forwarded-for" | "socket";

/**
 * Who is asking. The Worker hands the original Request to the container unchanged (cloudflare/worker.ts,
 * @cloudflare/containers containerFetch), so Cloudflare's CF-Connecting-IP should arrive here. X-Forwarded-For's
 * first entry is client-controlled behind Cloudflare; it is only a fallback for other proxies.
 */
export function clientId(header: (name: string) => string | undefined, socketAddress?: string): { id: string; from: ClientIdSource } {
  const cf = header("cf-connecting-ip")?.trim();
  if (cf) return { id: cf.slice(0, 64), from: "cf-connecting-ip" };
  const xff = header("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return { id: xff.slice(0, 64), from: "x-forwarded-for" };
  return { id: socketAddress || "unknown", from: "socket" };
}

/** Same test as BuyerAgent.extract: input that parses as an InvoiceSchema invoice never reaches the model. */
export function isStructuredInvoice(input: string): boolean {
  try {
    return InvoiceSchema.safeParse(JSON.parse(input)).success;
  } catch {
    return false;
  }
}

/** Free text over the cap would go to Claude; a structured invoice skips the model and is not capped here. */
export function textTooLong(input: string, maxChars: number): boolean {
  return input.length > maxChars && !isStructuredInvoice(input);
}

export interface RunGate {
  limiter: RunRateLimiter;
  runs: RunStore;
  maxTextChars: number;
}

export interface RunRequest {
  body: unknown;
  header(name: string): string | undefined;
  socketAddress?: string;
}

export type Refusal = { status: 400 | 413 | 429 | 503; body: { error: string; retryAfterSec?: number }; headers: Record<string, string> };
export type Admission = { ok: true; run: Run } | ({ ok: false } & Refusal);

const refuse = (status: Refusal["status"], error: string): Admission => ({ ok: false, status, body: { error }, headers: {} });

/**
 * POST /api/runs up to the stored run: input, text size, rate limits, store capacity, in that order.
 * Nothing here calls the model or pays; a refused request leaves no run and no rate-limit count.
 */
export function admitRun(req: RunRequest, gate: RunGate): Admission {
  const raw = (req.body as { input?: unknown } | null | undefined)?.input;
  const input = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  if (!input || input === '""') return refuse(400, "body.input (invoice text or JSON) required");
  if (textTooLong(input, gate.maxTextChars)) {
    return refuse(413, `invoice text is ${input.length} characters; the limit is ${gate.maxTextChars} (structured JSON invoices are exempt)`);
  }

  const client = clientId(name => req.header(name), req.socketAddress).id;
  const limited = gate.limiter.check(client);
  if (limited) {
    return { ok: false, status: 429, body: { error: limited.message, retryAfterSec: limited.retryAfterSec }, headers: { "Retry-After": String(limited.retryAfterSec) } };
  }
  const run = gate.runs.tryCreate(input);
  if (!run) return refuse(503, `run store full: all ${gate.runs.maxRuns} stored runs are in flight; retry shortly`);
  gate.limiter.record(client);
  return { ok: true, run };
}
