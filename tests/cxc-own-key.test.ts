import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { KEY_UNREADABLE } from "../src/cfo/cxc-keys.js";
import { connectionContext, keyHint, Vault } from "../src/cfo/vault.js";
import { loadConfig } from "../src/config.js";
import type { FiatPayoutClient } from "../src/payout.js";
import { CashXChainPayoutRoute } from "../src/payout-cashxchain.js";
import type { VerifiedPayee } from "../src/routing.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

const SECRET = "s".repeat(40);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

async function listen(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Payout engine stub that pays over the route the CFO hands it, as BuyerAgent.useFiatRoute does. */
function routeAgent() {
  const routes = new WeakMap<Run, FiatPayoutClient>();
  const given: FiatPayoutClient[] = [];
  const agent = {
    useFiatRoute(run: Run, fiat: FiatPayoutClient) {
      routes.set(run, fiat);
      given.push(fiat);
    },
    async process(run: Run) {
      run.state = "DRAFT_READY";
      run.draft = { executable: true, route: { rail: "cxc_fiat" } } as unknown as Run["draft"];
    },
    approve(run: Run) {
      const fiat = routes.get(run);
      const invoice = JSON.parse(run.input) as Invoice;
      const done = (async () => {
        // No own route: the engine's default (PayFlow AI's shared account) would pay.
        const { reference } = fiat
          ? await fiat.payout({ idempotencyKey: `payout-${invoice.id}`, invoice, destination: "x", payee: run.payees![0] as VerifiedPayee })
          : { reference: "shared_account_payout" };
        run.state = "EXECUTED";
        run.payout = { rail: "cxc_fiat", status: "submitted", simulated: false, amountMinor: invoice.amountMinor, currency: invoice.currency, destination: "x", reference, label: "test", executedAt: new Date().toISOString() };
      })();
      return { ok: true, done };
    },
  } as unknown as BuyerAgent;
  return { agent, given };
}

async function start() {
  const fake = createFakeCxc();
  const cxcUrl = await listen(fake.app);
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: SECRET });
  const { agent, given } = routeAgent();
  const engine: PaymentEngine = { runs: new RunStore(), agent };
  const deps = await createCfo(config, engine, { memory: true, cashxchainBaseUrl: cxcUrl });
  mountCfo(app, deps);

  async function user(email: string) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      return { status: r.status, text, json: (text ? JSON.parse(text) : undefined) as any };
    };
  }
  return { deps, fake, given, user };
}

const settle = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("condition not reached");
};

describe("a workspace connects its own CashXChain account by API key", () => {
  it("offers the key in the catalog and refuses a missing, live or rejected key", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    const cxc = (await me("GET", "/api/v1/connections/catalog")).json.find((c: { kind: string }) => c.kind === "cashxchain");
    // No platform key on this server: the own key is the only way in.
    expect(cxc).toMatchObject({ available: true, acceptsApiKey: true });
    expect(cxc.sharedFallback).toBeUndefined();

    expect((await me("POST", "/api/v1/connections", { kind: "cashxchain" })).json.error).toMatch(/Paste your CashXChain sandbox API key/);
    expect((await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: "cxc_sk_live_abc123" })).json.error).toMatch(/Live keys are not accepted/);
    const rejected = await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: "cxc_sk_sandbox_notIssued9" });
    expect(rejected.status).toBe(400);
    expect(rejected.json.error).toMatch(/did not accept this API key/);
    expect((await me("POST", "/api/v1/connections", { kind: "evm_wallet", address: "0x" + "a".repeat(40), apiKey: FAKE_KEY })).status).toBe(400);
    expect((await me("GET", "/api/v1/connections")).json).toEqual([]);
  });

  it("stores the key sealed, never shows it again, and reads that account's balances", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    const created = await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY, access: "read_write" });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ kind: "cashxchain", access: "read_write", keyHint: "cxc_sk_sandbox_…y123", status: "active" });
    expect(created.json.balances).toEqual([expect.objectContaining({ asset: "EUR", amount: "50000.0000" })]);
    expect(created.text).not.toContain(FAKE_KEY);
    expect((await me("GET", "/api/v1/connections")).text).not.toContain(FAKE_KEY);
    expect(s.fake.state.seen.filter(r => r.path === "/v1/banking/accounts").every(r => r.authorization === `Bearer ${FAKE_KEY}`)).toBe(true);

    const sealed = await s.deps.store.connectionSecret((await me("GET", "/api/v1/me")).json.workspace.id, created.json.id);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(FAKE_KEY);

    // One CashXChain account per workspace: replacing it means removing the old one.
    expect((await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY })).json.error).toMatch(/remove it first/);
    // Another workspace sees none of it.
    const other = await s.user("someone@else.example");
    expect((await other("GET", "/api/v1/connections")).json).toEqual([]);
  });

  it("approved payouts leave from the workspace's own account, with its key", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY, access: "read_write" });
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" });
    expect(draft.status).toBe(201);
    if (draft.json.status === "pending_approval") expect((await me("POST", `/api/v1/payments/${draft.json.id}/approve`)).status).toBe(200);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");

    expect(s.given).toHaveLength(1);
    expect(s.given[0]).toBeInstanceOf(CashXChainPayoutRoute);
    const [create] = s.fake.payoutCreates();
    expect(create?.authorization).toBe(`Bearer ${FAKE_KEY}`);
    const [payout] = [...s.fake.state.payouts.values()];
    expect((await me("GET", "/api/v1/payments")).json[0].reference).toBe(payout?.payout.id);
  });

  it("a key that can no longer be opened fails the payment; it never falls back to the shared account", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    const conn = (await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY, access: "read_write" })).json;
    // As after a BETTER_AUTH_SECRET rotation: sealed under another secret.
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    const foreign = new Vault("x".repeat(40)).seal(FAKE_KEY, connectionContext(ws));
    await (s.deps.store as unknown as { run(sql: string, ...p: unknown[]): Promise<number> }).run("UPDATE connections SET secret_enc = ? WHERE id = ?", foreign, conn.id);

    expect((await me("POST", `/api/v1/connections/${conn.id}/refresh`)).json.error).toBe(KEY_UNREADABLE);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toBe(KEY_UNREADABLE);
    expect(s.given).toHaveLength(0);
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });
});

describe("Vault", () => {
  it("opens only what it sealed, for the same workspace", () => {
    const vault = new Vault(SECRET);
    const sealed = vault.seal(FAKE_KEY, connectionContext("ws_a"));
    expect(vault.open(sealed, connectionContext("ws_a"))).toBe(FAKE_KEY);
    expect(sealed).not.toBe(vault.seal(FAKE_KEY, connectionContext("ws_a"))); // fresh IV each time
    expect(() => vault.open(sealed, connectionContext("ws_b"))).toThrow();
    expect(() => new Vault("y".repeat(40)).open(sealed, connectionContext("ws_a"))).toThrow();
    const [v, iv, body] = sealed.split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0]! ^= 1;
    expect(() => vault.open(`${v}.${iv}.${flipped.toString("base64url")}`, connectionContext("ws_a"))).toThrow();
  });

  it("hints show the key's kind and last four characters only", () => {
    expect(keyHint("cxc_rk_sandbox_abcdefLzQb")).toBe("cxc_rk_sandbox_…LzQb");
  });
});
