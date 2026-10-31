import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { CashXChainClient } from "../src/cashxchain.js";
import { KEY_UNREADABLE } from "../src/cfo/cxc-keys.js";
import { NEEDS_OWN_KEY } from "../src/cfo/payments.js";
import { connectionContext, keyHint, Vault } from "../src/cfo/vault.js";
import { loadConfig } from "../src/config.js";
import type { FiatPayoutClient } from "../src/payout.js";
import { CashXChainPayoutRoute } from "../src/payout-cashxchain.js";
import type { VerifiedPayee } from "../src/routing.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

const SECRET = "s".repeat(40);
// The account's own agent wallet: it pays the verification on Cardano before every payout.
const AGENT_PHRASE = generateMnemonic(wordlist, 256);
const agentWallet = (me: (method: string, path: string, body?: unknown) => Promise<unknown>) =>
  me("POST", "/api/v1/connections", { kind: "cardano_agent_wallet", recoveryPhrase: AGENT_PHRASE, access: "read_write" });
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
        // No own route: the engine's default (PayLorya AI's shared account) would pay.
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

async function start(env: Record<string, string> = {}) {
  const fake = createFakeCxc();
  const cxcUrl = await listen(fake.app);
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: SECRET, ...env });
  const { agent, given } = routeAgent();
  const engine: PaymentEngine = { runs: new RunStore(), agent };
  const deps = await createCfo(config, engine, { memory: true, cashxchainFor: apiKey => new CashXChainClient({ apiKey, baseUrl: cxcUrl }), agentFor: () => agent });
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
  it("requires the key, even with a shared platform key on the server, and refuses a live or rejected one", async () => {
    // The platform key (public demo) is configured; workspaces still never get its account.
    const s = await start({ CASHXCHAIN_API_KEY: "cxc_sk_sandbox_platformDemo1" });
    const me = await s.user("owner@brenner.example");
    const cxc = (await me("GET", "/api/v1/connections/catalog")).json.find((c: { kind: string }) => c.kind === "cashxchain");
    expect(cxc).toMatchObject({ available: true, acceptsApiKey: true });
    expect(cxc.linkedFallback).toBeUndefined();

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
    await agentWallet(me);
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
    await agentWallet(me);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" });
    expect(draft.status).toBe(201);
    if (draft.json.status === "pending_approval") expect((await me("POST", `/api/v1/payments/${draft.json.id}/approve`, { amountMinor: draft.json.amountMinor, currency: draft.json.currency })).status).toBe(200);
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
    await agentWallet(me);
    // As after a BETTER_AUTH_SECRET rotation: sealed under another secret.
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    const foreign = new Vault("x".repeat(40)).seal(FAKE_KEY, connectionContext(ws));
    await (s.deps.store as unknown as { run(sql: string, ...p: unknown[]): Promise<number> }).run("UPDATE connections SET secret_enc = ? WHERE id = ?", foreign, conn.id);

    expect((await me("POST", `/api/v1/connections/${conn.id}/refresh`)).json.error).toBe(KEY_UNREADABLE);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toBe(KEY_UNREADABLE);
    expect(s.given).toHaveLength(0);
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });
});

describe("a CashXChain payout cut off by a restart", () => {
  it("goes back to approval; approving again replays the same payout and never pays twice", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY, access: "read_write" });
    await agentWallet(me);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    const first = (await me("GET", "/api/v1/payments")).json[0];

    // The payout went through, but the restart came before its outcome was stored.
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    await s.deps.store.updatePayment(ws, draft.id, { status: "executing", reference: undefined, executedAt: undefined });
    await s.deps.payments.sweep();
    expect((await me("GET", "/api/v1/payments")).json[0]).toMatchObject({ status: "pending_approval", error: expect.stringMatching(/never twice/) });

    expect((await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency })).status).toBe(200);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    expect(s.fake.payoutCreates()).toHaveLength(2); // the same request twice…
    expect(s.fake.state.payouts.size).toBe(1); // …one payout at CashXChain
    expect((await me("GET", "/api/v1/payments")).json[0].reference).toBe(first.reference);
  });

  it("refuses to resume when the payee or amount changed since the first attempt", async () => {
    const s = await start();
    const me = await s.user("owner@brenner.example");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: FAKE_KEY, access: "read_write" });
    await agentWallet(me);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    await s.deps.store.updatePayment(ws, draft.id, { status: "executing" });
    await s.deps.payments.sweep();
    await me("PATCH", `/api/v1/payees/${payee.id}`, { name: "Brenner Maschinenbau GmbH" });
    await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toMatch(/changed since an earlier attempt/);
    expect(s.fake.payoutCreates()).toHaveLength(1);
  });
});

describe("no shared CashXChain account for workspaces", () => {
  it("a connection without a key (made before keys were required) reads nothing and cannot pay", async () => {
    const s = await start({ CASHXCHAIN_API_KEY: "cxc_sk_sandbox_platformDemo1" });
    const me = await s.user("owner@brenner.example");
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    const legacy = await s.deps.store.addConnection(ws, { kind: "cashxchain", label: "CashXChain account (sandbox)", network: "cashxchain:sandbox", access: "read_write" });
    await agentWallet(me);

    expect((await me("POST", `/api/v1/connections/${legacy.id}/refresh`)).json.error).toMatch(/connect CashXChain again with your API key/);
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-1042" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toBe(NEEDS_OWN_KEY);
    expect(s.given).toHaveLength(0);
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
