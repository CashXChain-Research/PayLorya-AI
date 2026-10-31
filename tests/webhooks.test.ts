import { once } from "node:events";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { INTERRUPTED } from "../src/cfo/payments.js";
import {
  checkWebhookUrl,
  isProductionServer,
  isPublicAddress,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  SECRET_PATTERN,
  signWebhook,
  USER_AGENT,
  verifyWebhookSignature,
  type Resolve,
} from "../src/cfo/webhooks.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

type Call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any; headers: Headers }>;

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function start(webhooks: { production?: boolean; resolve?: Resolve } = {}) {
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "s".repeat(40) });
  const engine: PaymentEngine = { runs: new RunStore(), agent: {} as BuyerAgent };
  const deps = await createCfo(config, engine, { memory: true, noSweep: true, agentFor: () => ({}) as BuyerAgent, webhooks });
  mountCfo(app, deps);

  const call = (auth: Record<string, string>): Call => async (method, path, body, headers = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), origin: base, ...auth, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : undefined, headers: r.headers };
  };
  async function user(email: string): Promise<Call> {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    return call({ cookie: res.headers.get("set-cookie")!.split(";")[0]! });
  }
  const withKey = (key: string) => call({ authorization: `Bearer ${key}` });
  return { user, withKey, deps };
}

/** A local endpoint that records each delivery (raw body) and answers with the queued statuses, then 200. */
async function receiver() {
  const app = express();
  const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
  const statuses: number[] = [];
  app.post("/hook", express.raw({ type: "*/*" }), (req, res) => {
    received.push({ headers: req.headers, body: (req.body as Buffer).toString("utf8") });
    res.status(statuses.shift() ?? 200).end();
  });
  return { url: `${await listen(app)}/hook`, received, statuses };
}

/** A signed-in owner with a saved payee, and a way to draft payments to it. */
async function owner(s: Awaited<ReturnType<typeof start>>) {
  const me = await s.user("owner@example.com");
  const ws = (await me("GET", "/api/v1/me")).json.workspace.id as string;
  const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", country: "DE", iban: "DE89 3704 0044 0532 0130 00" })).json;
  let n = 0;
  const draft = async () => {
    const r = await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000 + n, currency: "EUR", reason: `INV-${++n}` });
    expect(r.status).toBe(201);
    return r.json as { id: string; status: string };
  };
  return { me, ws, draft };
}

const deliveries = async (s: Awaited<ReturnType<typeof start>>) =>
  (await s.deps.store.sql.query("SELECT event_type, status, attempts, last_status, next_attempt_at FROM webhook_deliveries ORDER BY created_at, rowid")).rows;

describe("webhooks API", () => {
  it("creates a webhook with its secret shown once, lists it without, and deletes it", async () => {
    const s = await start();
    const { me } = await owner(s);
    const created = await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/paylorya" });
    expect(created.status).toBe(201);
    expect(Object.keys(created.json).sort()).toEqual(["createdAt", "events", "id", "secret", "url"]);
    expect(created.json).toMatchObject({ url: "https://hooks.example.com/paylorya", events: ["payment.created", "payment.updated"] });
    expect(created.json.secret).toMatch(SECRET_PATTERN);

    const listed = await me("GET", "/api/v1/webhooks");
    expect(listed.status).toBe(200);
    expect(listed.json).toEqual([{ id: created.json.id, url: created.json.url, events: created.json.events, createdAt: created.json.createdAt }]);
    expect(JSON.stringify(listed.json)).not.toContain(created.json.secret);

    // Stored sealed (vault.ts), never in plaintext.
    const row = (await s.deps.store.sql.query("SELECT secret_enc FROM webhooks WHERE id = ?", [created.json.id])).rows[0]!;
    expect(String(row.secret_enc)).toMatch(/^v1\./);
    expect(String(row.secret_enc)).not.toContain(created.json.secret.slice(6));

    const only = await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/updates", events: ["payment.updated"] });
    expect(only.json.events).toEqual(["payment.updated"]);
    expect((await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/x", events: ["payment.deleted"] })).status).toBe(400);
    expect((await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/x", events: [] })).status).toBe(400);

    expect((await me("DELETE", `/api/v1/webhooks/${created.json.id}`)).status).toBe(204);
    expect((await me("DELETE", `/api/v1/webhooks/${created.json.id}`)).status).toBe(404);
    expect((await me("GET", "/api/v1/webhooks")).json.map((w: { id: string }) => w.id)).toEqual([only.json.id]);

    const actions = (await me("GET", "/api/v1/activity")).json.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["added webhook", "removed webhook"]));
  });

  it("allows at most 10 webhooks per account", async () => {
    const s = await start();
    const { me } = await owner(s);
    for (let i = 0; i < 10; i++) expect((await me("POST", "/api/v1/webhooks", { url: `https://hooks.example.com/${i}` })).status).toBe(201);
    const eleventh = await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/10" });
    expect(eleventh.status).toBe(409);
    expect(eleventh.json.error).toMatch(/10 webhooks/);
  });

  it("are listed but never created, deleted or tested with an API key", async () => {
    const s = await start();
    const { me } = await owner(s);
    const hook = (await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/a" })).json;
    const writer = s.withKey((await me("POST", "/api/v1/api-keys", { name: "erp", scopes: ["read", "write"] })).json.key);
    for (const [method, path, body] of [
      ["POST", "/api/v1/webhooks", { url: "https://evil.example.com/" }],
      ["DELETE", `/api/v1/webhooks/${hook.id}`, undefined],
      ["POST", `/api/v1/webhooks/${hook.id}/test`, undefined],
    ] as const) {
      const r = await writer(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.code, `${method} ${path}`).toBe("human_only");
    }
    const reader = s.withKey((await me("POST", "/api/v1/api-keys", { name: "bi", scopes: ["read"] })).json.key);
    const listed = await reader("GET", "/api/v1/webhooks");
    expect(listed.status).toBe(200);
    expect(listed.json).toHaveLength(1);
    expect(listed.json[0]).not.toHaveProperty("secret");
  });
});

describe("webhook delivery", () => {
  it("sends payment.created signed, verifiable with verifyWebhookSignature", async () => {
    const s = await start();
    const { me, draft } = await owner(s);
    const r = await receiver();
    const hook = (await me("POST", "/api/v1/webhooks", { url: r.url })).json;
    const payment = await draft();

    expect(r.received).toHaveLength(0); // noSweep: nothing goes out until the test delivers
    expect(await s.deps.webhooks.deliverDue()).toBe(1);
    expect(r.received).toHaveLength(1);
    const { headers, body } = r.received[0]!;
    const event = JSON.parse(body);
    expect(event).toMatchObject({ type: "payment.created", data: { payment: { id: payment.id, status: payment.status } } });
    expect(event.id).toMatch(/^evt_[0-9A-Za-z]{24}$/);
    expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt);
    expect(Object.keys(event.data)).toEqual(["payment"]);
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(headers["x-paylorya-event"]).toBe("payment.created");
    expect(headers["x-paylorya-delivery"]).toBe(event.id);

    const signature = headers["x-paylorya-signature"] as string;
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(Math.abs(Number(/^t=(\d+)/.exec(signature)![1]) - Date.now() / 1000)).toBeLessThan(30);
    expect(verifyWebhookSignature(hook.secret, signature, body)).toBe(true);
    expect(verifyWebhookSignature(hook.secret, signature, Buffer.from(body))).toBe(true);
    expect(verifyWebhookSignature(hook.secret, signature, body.replace("payment.created", "payment.updated"))).toBe(false);
    expect(verifyWebhookSignature(`whsec_${"x".repeat(40)}`, signature, body)).toBe(false);

    const [listed] = (await me("GET", "/api/v1/webhooks")).json;
    expect(listed.lastStatus).toBe(200);
    expect(listed.lastDeliveryAt).toBeTruthy();
    // Delivered once: nothing left to send.
    expect(await s.deps.webhooks.deliverDue(Date.now() + 24 * 3_600_000)).toBe(0);
  });

  it("sends payment.updated with previousStatus on every status change, the sweep's included", async () => {
    const s = await start();
    const { me, ws, draft } = await owner(s);
    const r = await receiver();
    await me("POST", "/api/v1/webhooks", { url: r.url });
    const first = await draft();
    // Started, then cut off by a restart: the sweep sends it back to approval.
    expect(await s.deps.store.claimPayment(ws, first.id, [first.status as "blocked"], "executing", new Date().toISOString())).toBe(true);
    await s.deps.payments.sweep();
    expect((await s.deps.store.payment(ws, first.id))!.status).toBe("pending_approval");
    // A person rejects it.
    expect((await me("POST", `/api/v1/payments/${first.id}/reject`, {})).status).toBe(200);
    // A change without a new status announces nothing.
    await s.deps.store.updatePayment(ws, first.id, { reference: "note" });

    await s.deps.webhooks.deliverDue();
    const events = r.received.map(x => JSON.parse(x.body));
    expect(events.map(e => [e.type, e.data.previousStatus, e.data.payment.status])).toEqual([
      ["payment.created", undefined, first.status],
      ["payment.updated", first.status, "executing"],
      ["payment.updated", "executing", "pending_approval"],
      ["payment.updated", "pending_approval", "rejected"],
    ]);
    // The reason travels with the status change it explains.
    expect(events[2].data.payment.error).toBe(INTERRUPTED);
    expect(new Set(events.map(e => e.id)).size).toBe(4);
  });

  it("only sends the events an endpoint subscribed to", async () => {
    const s = await start();
    const { me, ws, draft } = await owner(s);
    const r = await receiver();
    await me("POST", "/api/v1/webhooks", { url: r.url, events: ["payment.updated"] });
    const p = await draft();
    await s.deps.store.updatePayment(ws, p.id, { status: "failed", error: "test" });
    await s.deps.webhooks.deliverDue();
    expect(r.received.map(x => x.headers["x-paylorya-event"])).toEqual(["payment.updated"]);
    expect(JSON.parse(r.received[0]!.body).data).toMatchObject({ previousStatus: p.status, payment: { status: "failed", error: "test" } });
  });

  it("retries after the endpoint answers 500, with the same event", async () => {
    const s = await start();
    const { me, draft } = await owner(s);
    const r = await receiver();
    r.statuses.push(500);
    await me("POST", "/api/v1/webhooks", { url: r.url });
    await draft();
    const t0 = Date.now();

    expect(await s.deps.webhooks.deliverDue(t0)).toBe(1);
    expect((await me("GET", "/api/v1/webhooks")).json[0].lastStatus).toBe(500);
    expect(await deliveries(s)).toMatchObject([{ status: "pending", attempts: 1, last_status: 500 }]);
    // Not before the first backoff (1 minute).
    expect(await s.deps.webhooks.deliverDue(t0)).toBe(0);
    expect(await s.deps.webhooks.deliverDue(t0 + RETRY_DELAYS_MS[0] - 1_000)).toBe(0);

    expect(await s.deps.webhooks.deliverDue(t0 + RETRY_DELAYS_MS[0] + 1_000)).toBe(1);
    expect(r.received).toHaveLength(2);
    expect(r.received[1]!.headers["x-paylorya-delivery"]).toBe(r.received[0]!.headers["x-paylorya-delivery"]);
    expect(r.received[1]!.body).toBe(r.received[0]!.body);
    expect((await me("GET", "/api/v1/webhooks")).json[0].lastStatus).toBe(200);
    expect(await deliveries(s)).toMatchObject([{ status: "delivered", attempts: 2, last_status: 200, next_attempt_at: null }]);
  });

  it("gives up after six attempts on the backoff schedule, and logs it", async () => {
    const s = await start();
    const { me, draft } = await owner(s);
    const r = await receiver();
    r.statuses.push(...Array<number>(10).fill(503));
    await me("POST", "/api/v1/webhooks", { url: r.url });
    await draft();
    let t = Date.now();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await s.deps.webhooks.deliverDue(t), `attempt ${attempt}`).toBe(1);
      t += (RETRY_DELAYS_MS[attempt - 1] ?? 0) + 1_000;
    }
    expect(r.received).toHaveLength(MAX_ATTEMPTS);
    expect(await deliveries(s)).toMatchObject([{ status: "failed", attempts: MAX_ATTEMPTS, last_status: 503, next_attempt_at: null }]);
    expect(await s.deps.webhooks.deliverDue(t + 24 * 3_600_000)).toBe(0);
    const failed = (await me("GET", "/api/v1/activity")).json.find((a: { action: string }) => a.action === "webhook delivery failed");
    expect(failed.detail).toMatch(/payment\.created evt_\w+ to http:\/\/127\.0\.0\.1:\d+\/hook: HTTP 503, after 6 attempts/);
  });

  it("does not follow redirects", async () => {
    const s = await start();
    const { me, draft } = await owner(s);
    const r = await receiver();
    const app = express();
    app.post("/moved", (_req, res) => res.redirect(307, r.url));
    const moved = `${await listen(app)}/moved`;
    await me("POST", "/api/v1/webhooks", { url: moved });
    await draft();
    await s.deps.webhooks.deliverDue();
    expect(r.received).toHaveLength(0);
    expect((await me("GET", "/api/v1/webhooks")).json[0].lastStatus).toBe(307);
  });

  it("never fails or holds up a payment when queueing or delivery fails", async () => {
    const s = await start();
    const { me, draft } = await owner(s);
    // An endpoint nobody listens on.
    const dead = await receiver();
    await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
    await me("POST", "/api/v1/webhooks", { url: dead.url });
    await draft();
    expect(await s.deps.webhooks.deliverDue()).toBe(1);
    expect((await me("GET", "/api/v1/webhooks")).json[0].lastStatus).toBe(0);

    vi.spyOn(s.deps.store, "enqueueWebhookEvent").mockRejectedValue(new Error("database unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = await draft();
    expect(p.id).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("webhook test ping", () => {
  it("sends a ping at once and reports the endpoint's answer, whatever it subscribed to", async () => {
    const s = await start();
    const { me } = await owner(s);
    const r = await receiver();
    const hook = (await me("POST", "/api/v1/webhooks", { url: r.url, events: ["payment.updated"] })).json;
    const ping = await me("POST", `/api/v1/webhooks/${hook.id}/test`);
    expect(ping.status).toBe(200);
    expect(ping.json).toMatchObject({ type: "ping", delivered: true, status: 200 });
    expect(ping.json.id).toMatch(/^evt_/);
    expect(r.received).toHaveLength(1);
    const { headers, body } = r.received[0]!;
    expect(headers["x-paylorya-event"]).toBe("ping");
    expect(headers["x-paylorya-delivery"]).toBe(ping.json.id);
    expect(JSON.parse(body)).toMatchObject({ id: ping.json.id, type: "ping", data: { webhookId: hook.id } });
    expect(verifyWebhookSignature(hook.secret, headers["x-paylorya-signature"] as string, body)).toBe(true);
    expect((await me("POST", "/api/v1/webhooks/00000000-0000-0000-0000-000000000000/test")).status).toBe(404);
  });

  it("reports a failing endpoint and does not retry the ping", async () => {
    const s = await start();
    const { me } = await owner(s);
    const r = await receiver();
    r.statuses.push(500);
    const hook = (await me("POST", "/api/v1/webhooks", { url: r.url })).json;
    const ping = await me("POST", `/api/v1/webhooks/${hook.id}/test`);
    expect(ping.json).toMatchObject({ type: "ping", delivered: false, status: 500, error: "HTTP 500" });
    expect(await s.deps.webhooks.deliverDue(Date.now() + 24 * 3_600_000)).toBe(0);
    expect(r.received).toHaveLength(1);
    expect(await deliveries(s)).toMatchObject([{ event_type: "ping", status: "failed", attempts: 1 }]);
  });
});

describe("webhook URLs", () => {
  it("are https only outside of local testing, where http://localhost and 127.0.0.1 also work", async () => {
    const s = await start();
    const { me } = await owner(s);
    for (const url of ["http://hooks.example.com/x", "ftp://hooks.example.com/x", "not a url", "https://user:pw@hooks.example.com/x", "http://10.0.0.1/x"]) {
      const r = await me("POST", "/api/v1/webhooks", { url });
      expect(r.status, url).toBe(400);
    }
    for (const url of ["http://localhost:4000/hook", "http://127.0.0.1:4000/hook", "https://hooks.example.com/x"]) {
      expect((await me("POST", "/api/v1/webhooks", { url })).status, url).toBe(201);
    }
  });

  it("refuse private, loopback and link-local hosts in production, also when DNS points there", async () => {
    const resolve = vi.fn<Resolve>(async host => {
      if (host === "hooks.example.com") return [{ address: "10.0.0.7", family: 4 }];
      if (host === "mixed.example.com") return [{ address: "93.184.216.34", family: 4 }, { address: "fd00::1", family: 6 }];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    });
    const s = await start({ production: true, resolve });
    const { me } = await owner(s);
    for (const url of [
      "http://127.0.0.1:4000/hook",
      "http://localhost:4000/hook",
      "http://93.184.216.34/hook",
      "https://127.0.0.1/hook",
      "https://2130706433/hook",
      "https://10.0.0.1/hook",
      "https://172.16.5.4/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/hook",
      "https://0.0.0.0/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://[fe80::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://localhost/hook",
      "https://api.localhost/hook",
      "https://cfo-data.internal/sql",
      "https://intranet/hook",
    ]) {
      const r = await me("POST", "/api/v1/webhooks", { url });
      expect(r.status, url).toBe(400);
    }
    expect((await me("POST", "/api/v1/webhooks", { url: "https://93.184.216.34/hook" })).status).toBe(201);
    // A name is checked when it is used: DNS can change after the webhook was added.
    const hook = (await me("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/hook" })).json;
    expect(resolve).not.toHaveBeenCalled();
    const ping = await me("POST", `/api/v1/webhooks/${hook.id}/test`);
    expect(ping.json).toMatchObject({ delivered: false, status: 0 });
    expect(ping.json.error).toMatch(/hooks\.example\.com resolves to 10\.0\.0\.7, not a public address/);
    expect(resolve).toHaveBeenCalledWith("hooks.example.com");

    const mixed = (await me("POST", "/api/v1/webhooks", { url: "https://mixed.example.com/hook" })).json;
    expect((await me("POST", `/api/v1/webhooks/${mixed.id}/test`)).json.error).toMatch(/resolves to fd00::1/);
  });

  it("checkWebhookUrl, isPublicAddress and isProductionServer", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["10.1.2.3", "172.31.255.255", "192.168.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:a00:1::1", "ff02::1", "not-an-ip"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    const prod = { production: true, blockedHosts: [] };
    expect(checkWebhookUrl("https://hooks.example.com/a#frag", prod)).toMatchObject({ ok: true });
    const ok = checkWebhookUrl("https://hooks.example.com/a#frag", prod);
    expect(ok.ok && ok.url.toString()).toBe("https://hooks.example.com/a");
    expect(checkWebhookUrl("https://LOCALHOST./a", prod).ok).toBe(false);
    expect(checkWebhookUrl(`https://hooks.example.com/${"a".repeat(2100)}`, prod).ok).toBe(false);
    expect(checkWebhookUrl("http://cfo-data.internal/sql", { production: false, blockedHosts: ["cfo-data.internal"] }).ok).toBe(false);
    expect(checkWebhookUrl("http://localhost:3000/hook", { production: false }).ok).toBe(true);

    expect(isProductionServer({ baseUrl: "http://localhost:8787" })).toBe(false);
    expect(isProductionServer({ baseUrl: "http://127.0.0.1:5000" })).toBe(false);
    expect(isProductionServer({ baseUrl: "https://paylorya.valentin.is" })).toBe(true);
    expect(isProductionServer({ baseUrl: "http://localhost:8787", CFO_DATA_URL: "http://cfo-data.internal" })).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = `whsec_${"A1b2C3d4E5".repeat(4)}`;
  const body = JSON.stringify({ id: "evt_1", type: "ping", createdAt: new Date().toISOString(), data: {} });
  const now = () => Math.floor(Date.now() / 1000);

  it("accepts the header PayLorya sends, computed as documented", async () => {
    const { createHmac } = await import("node:crypto");
    const t = now();
    const header = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    expect(signWebhook(secret, body, t)).toBe(header);
    expect(verifyWebhookSignature(secret, header, body)).toBe(true);
    expect(verifyWebhookSignature(secret, ` t=${t} , v1=${header.split("v1=")[1]} `, body)).toBe(true);
  });

  it("refuses other secrets, altered bodies, malformed headers and old or future timestamps", () => {
    const header = signWebhook(secret, body);
    expect(verifyWebhookSignature(`${secret.slice(0, -1)}Z`, header, body)).toBe(false);
    expect(verifyWebhookSignature(secret, header, `${body} `)).toBe(false);
    for (const bad of [undefined, null, "", "garbage", `t=${now()}`, `v1=${"0".repeat(64)}`, `t=abc,v1=${header.split("v1=")[1]}`, header.replace(/v1=\w+/, "v1=zz")]) {
      expect(verifyWebhookSignature(secret, bad, body), String(bad)).toBe(false);
    }
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now() - 301), body)).toBe(false);
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now() + 301), body)).toBe(false);
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now() - 299), body)).toBe(true);
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now() - 3_000), body, 3_600)).toBe(true);
  });

  it("accepts the header if any of several v1 signatures matches", () => {
    const t = now();
    const good = signWebhook(secret, body, t).split("v1=")[1];
    expect(verifyWebhookSignature(secret, `t=${t},v1=${"0".repeat(64)},v1=${good}`, body)).toBe(true);
  });
});
