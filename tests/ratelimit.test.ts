import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { admitRun, clientId, FixedWindow, HOUR_MS, isStructuredInvoice, MINUTE_MS, RunRateLimiter, textTooLong, type RunRequest } from "../src/ratelimit.js";
import { RunStore } from "../src/runs.js";
import type { Invoice } from "../src/types.js";

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  return { now, advance: (ms: number) => void (t += ms) };
}

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

const invoice: Invoice = {
  id: "INV-2026-001",
  supplier: "Hofmann Feinwerktechnik GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 894_000,
  iban: "DE89370400440532013000",
};

describe("FixedWindow", () => {
  it("allows `limit` hits per window, then reports the whole seconds left", () => {
    const c = clock();
    const w = new FixedWindow(3, MINUTE_MS, c.now);
    for (let i = 0; i < 3; i++) {
      expect(w.wait("a")).toBe(0);
      w.hit("a");
    }
    expect(w.wait("a")).toBe(60);
    c.advance(1_500);
    expect(w.wait("a")).toBe(59); // 58.5 s rounds up
    c.advance(58_499);
    expect(w.wait("a")).toBe(1); // 1 ms left still means retry in 1 s, never 0
    c.advance(1);
    expect(w.wait("a")).toBe(0); // window ended exactly windowMs after its first hit
  });

  it("counts a hit exactly at the window end in a new window, also between sweeps", () => {
    const c = clock();
    const w = new FixedWindow(2, MINUTE_MS, c.now);
    w.hit("x"); // first sweep
    c.advance(30_000);
    w.hit("a");
    w.hit("a");
    c.advance(30_000);
    w.hit("y"); // next sweep; "a" still open, so it stays
    c.advance(30_000); // "a" ends now, the next sweep is 30 s away
    w.hit("a");
    w.hit("a");
    expect(w.wait("a")).toBe(60);
  });

  it("starts a fresh window on the first hit after one ended", () => {
    const c = clock();
    const w = new FixedWindow(1, MINUTE_MS, c.now);
    w.hit("a");
    c.advance(MINUTE_MS + 10_000);
    w.hit("a");
    expect(w.wait("a")).toBe(60);
  });

  it("keeps keys apart and drops ended windows", () => {
    const c = clock();
    const w = new FixedWindow(1, MINUTE_MS, c.now);
    w.hit("a");
    expect(w.wait("b")).toBe(0);
    w.hit("b");
    expect(w.keys).toBe(2);
    c.advance(MINUTE_MS);
    w.hit("c");
    expect(w.keys).toBe(1);
  });
});

describe("RunRateLimiter", () => {
  it("limits each client per minute without touching other clients", () => {
    const c = clock();
    const l = new RunRateLimiter(10, 120, c.now);
    for (let i = 0; i < 10; i++) {
      expect(l.check("1.1.1.1")).toBeUndefined();
      l.record("1.1.1.1");
    }
    expect(l.check("1.1.1.1")).toMatchObject({ scope: "client", retryAfterSec: 60 });
    expect(l.check("2.2.2.2")).toBeUndefined();
    c.advance(MINUTE_MS);
    expect(l.check("1.1.1.1")).toBeUndefined();
  });

  it("limits all clients together per hour, and waits for the later window", () => {
    const c = clock();
    const l = new RunRateLimiter(2, 3, c.now);
    l.record("a");
    c.advance(10 * MINUTE_MS);
    l.record("b");
    l.record("c");
    const refused = l.check("d");
    expect(refused).toMatchObject({ scope: "global", retryAfterSec: 50 * 60 });
    expect(refused?.message).toMatch(/3 runs per hour/);
    // Over both limits: retry when both have cleared.
    l.record("c");
    expect(l.check("c")).toMatchObject({ scope: "global", retryAfterSec: 50 * 60 });
    c.advance(50 * MINUTE_MS);
    expect(l.check("d")).toBeUndefined();
  });

  it("names the limit that clears last", () => {
    const c = clock();
    const l = new RunRateLimiter(1, 2, c.now);
    l.record("a");
    c.advance(30_000);
    l.record("b");
    // "b" is over both: its own window clears in 60 s, the global one 59.5 min after the first hit.
    expect(l.check("b")).toMatchObject({ scope: "global", retryAfterSec: 3570 });
    const l2 = new RunRateLimiter(1, 100, c.now);
    l2.record("a");
    expect(l2.check("a")).toMatchObject({ scope: "client", retryAfterSec: 60 });
  });

  it("check() counts nothing", () => {
    const l = new RunRateLimiter(1, 1, clock().now);
    for (let i = 0; i < 5; i++) expect(l.check("a")).toBeUndefined();
    expect(l.global.keys).toBe(0);
  });
});

describe("clientId", () => {
  it("prefers CF-Connecting-IP over X-Forwarded-For and the socket", () => {
    expect(clientId(headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 203.0.113.7" }), "10.0.0.1")).toEqual({
      id: "203.0.113.7",
      from: "cf-connecting-ip",
    });
  });

  it("falls back to the first X-Forwarded-For entry, then the socket address", () => {
    expect(clientId(headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.2" }), "10.0.0.1")).toEqual({ id: "198.51.100.1", from: "x-forwarded-for" });
    expect(clientId(headers({ "cf-connecting-ip": "  ", "x-forwarded-for": "" }), "::ffff:10.0.0.1")).toEqual({ id: "::ffff:10.0.0.1", from: "socket" });
    expect(clientId(headers({}))).toEqual({ id: "unknown", from: "socket" });
  });

  it("bounds the key length", () => {
    expect(clientId(headers({ "x-forwarded-for": "x".repeat(10_000) })).id).toHaveLength(64);
  });
});

describe("free-text size gate", () => {
  it("caps free text at maxChars", () => {
    expect(textTooLong("a".repeat(20_000), 20_000)).toBe(false);
    expect(textTooLong("a".repeat(20_001), 20_000)).toBe(true);
  });

  it("exempts structured invoices the agent would not send to the model", () => {
    const padded = JSON.stringify(invoice) + " ".repeat(30_000);
    expect(isStructuredInvoice(padded)).toBe(true);
    expect(textTooLong(padded, 20_000)).toBe(false);
  });

  it("caps JSON that fails InvoiceSchema, since that goes to the model", () => {
    const notAnInvoice = JSON.stringify({ ...invoice, currency: "XXX", note: "n".repeat(30_000) });
    expect(isStructuredInvoice(notAnInvoice)).toBe(false);
    expect(textTooLong(notAnInvoice, 20_000)).toBe(true);
  });
});

describe("admitRun (POST /api/runs)", () => {
  const setup = (o: { perMinute?: number; perHour?: number; maxRuns?: number; maxTextChars?: number } = {}) => {
    const c = clock();
    const runs = new RunStore(o.maxRuns ?? 500);
    const limiter = new RunRateLimiter(o.perMinute ?? 10, o.perHour ?? 120, c.now);
    return { c, runs, limiter, gate: { limiter, runs, maxTextChars: o.maxTextChars ?? 100 } };
  };
  const req = (input: unknown, h: Record<string, string> = { "cf-connecting-ip": "203.0.113.7" }): RunRequest => ({
    body: { input },
    header: headers(h),
    socketAddress: "10.0.0.1",
  });

  it("creates the run and counts it", () => {
    const { runs, limiter, gate } = setup({ perMinute: 1 });
    const res = admitRun(req("Invoice from ACME, EUR 10"), gate);
    expect(res.ok).toBe(true);
    if (res.ok) expect(runs.get(res.run.id)?.input).toBe("Invoice from ACME, EUR 10");
    expect(limiter.check("203.0.113.7")).toMatchObject({ scope: "client" });
  });

  it("stringifies a structured invoice object, exempt from the text cap", () => {
    const { gate } = setup({ maxTextChars: 10 });
    const res = admitRun(req(invoice), gate);
    expect(res.ok && res.run.input).toBe(JSON.stringify(invoice));
  });

  it("400 without input", () => {
    const { runs, gate } = setup();
    for (const r of [req(undefined), req(""), { body: undefined, header: headers({}) }]) {
      expect(admitRun(r, gate)).toMatchObject({ ok: false, status: 400 });
    }
    expect(runs.size).toBe(0);
  });

  it("413 for long free text before the rate limit, counting nothing", () => {
    const { runs, limiter, gate } = setup({ perMinute: 1 });
    const res = admitRun(req("x".repeat(101)), gate);
    expect(res).toMatchObject({ ok: false, status: 413, body: { error: expect.stringMatching(/101 characters; the limit is 100/) } });
    expect(runs.size).toBe(0);
    expect(limiter.check("203.0.113.7")).toBeUndefined();
    // Even a client already over its limit gets 413, not 429: the text never queues.
    admitRun(req("ok"), gate);
    expect(admitRun(req("x".repeat(101)), gate)).toMatchObject({ status: 413 });
  });

  it("429 with Retry-After and a JSON error, creating no run", () => {
    const { c, runs, gate } = setup({ perMinute: 2 });
    admitRun(req("one"), gate);
    c.advance(20_000);
    admitRun(req("two"), gate);
    const res = admitRun(req("three"), gate);
    expect(res).toMatchObject({
      ok: false,
      status: 429,
      headers: { "Retry-After": "40" },
      body: { error: expect.stringMatching(/2 runs per minute per client/), retryAfterSec: 40 },
    });
    expect(runs.size).toBe(2);
  });

  it("keys on CF-Connecting-IP, so a spoofed X-Forwarded-For does not reset the limit", () => {
    const { gate } = setup({ perMinute: 1 });
    expect(admitRun(req("a", { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }), gate).ok).toBe(true);
    expect(admitRun(req("b", { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "2.2.2.2" }), gate)).toMatchObject({ status: 429 });
    expect(admitRun(req("c", { "cf-connecting-ip": "203.0.113.8" }), gate).ok).toBe(true);
  });

  it("applies the global hourly limit across clients", () => {
    const { gate } = setup({ perHour: 2 });
    expect(admitRun(req("a", { "cf-connecting-ip": "203.0.113.1" }), gate).ok).toBe(true);
    expect(admitRun(req("b", { "cf-connecting-ip": "203.0.113.2" }), gate).ok).toBe(true);
    expect(admitRun(req("c", { "cf-connecting-ip": "203.0.113.3" }), gate)).toMatchObject({ status: 429, headers: { "Retry-After": "3600" } });
  });

  it("503 when the store is full of in-flight runs, without using up the client's quota", () => {
    const { runs, limiter, gate } = setup({ perMinute: 1, maxRuns: 1 });
    runs.transition(runs.create("in flight"), "PAYING");
    const res = admitRun(req("new"), gate);
    expect(res).toMatchObject({ ok: false, status: 503, body: { error: expect.stringMatching(/run store full/) } });
    expect(runs.size).toBe(1);
    expect(limiter.check("203.0.113.7")).toBeUndefined();
  });
});

describe("limit config", () => {
  it("defaults to 10/min per client, 120/h overall, 20,000 chars, 500 runs, and reads overrides", () => {
    const base = loadConfig({});
    expect([base.RUNS_PER_MINUTE_PER_CLIENT, base.RUNS_PER_HOUR, base.MAX_TEXT_CHARS, base.MAX_RUNS]).toEqual([10, 120, 20_000, 500]);
    const set = loadConfig({ RUNS_PER_MINUTE_PER_CLIENT: "4", RUNS_PER_HOUR: "40", MAX_TEXT_CHARS: "5000", MAX_RUNS: "50" });
    expect([set.RUNS_PER_MINUTE_PER_CLIENT, set.RUNS_PER_HOUR, set.MAX_TEXT_CHARS, set.MAX_RUNS]).toEqual([4, 40, 5000, 50]);
    expect(() => loadConfig({ RUNS_PER_HOUR: "0" })).toThrow();
  });

  it("uses a one-hour global window", () => {
    expect(new RunRateLimiter(1, 1).global.windowMs).toBe(HOUR_MS);
  });
});
