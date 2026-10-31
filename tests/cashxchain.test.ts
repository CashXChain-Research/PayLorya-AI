import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CashXChainClient, CxcApiError } from "../src/cashxchain.js";
import { loadConfig } from "../src/config.js";
import { payoutKey, PayoutDesk, rejectDraft, toDecimal } from "../src/payout.js";
import { invoiceFingerprint } from "../src/readiness.js";
import { RunStore, type Run, type RunState } from "../src/runs.js";
import type { Invoice } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 1_248_000,
  reference: "PO-7781",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};
const us: Invoice = {
  id: "A-5531",
  supplier: "Lakeside Robotics Inc.",
  destinationCountry: "US",
  currency: "USD",
  amountMinor: 425_000,
  routingNumber: "021000021",
  accountNumber: "000123456789",
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server => new Promise<void>(resolve => (server.closeAllConnections(), server.close(() => resolve())))),
  );
});

async function listen(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setup() {
  const fake = createFakeCxc();
  const client = new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: await listen(fake.app) });
  const runs = new RunStore();
  const desk = new PayoutDesk(client, runs, { pollIntervalMs: 1, pollAttempts: 5 });
  return { fake, client, runs, desk };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A run as the agent leaves it at DRAFT_READY, with the payout prepared against the fake. */
async function draftReady(s: Setup, invoice: Invoice = sepa): Promise<Run> {
  const prepared = await s.desk.prepare(invoice);
  if (prepared.kind !== "ready") throw new Error(`prepare: ${prepared.kind} ${prepared.reason}`);
  const run = s.runs.create(JSON.stringify(invoice));
  run.invoice = invoice;
  run.fingerprint = invoiceFingerprint(invoice);
  run.draft = {
    status: "awaiting_human_approval",
    executable: true,
    invoiceId: invoice.id,
    supplier: invoice.supplier,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    cashxchain: prepared.plan,
    note: "n",
  };
  s.runs.transition(run, "DRAFT_READY");
  return run;
}

const SETTLED_STATES: RunState[] = ["PAYOUT_SETTLED", "PAYOUT_FAILED", "PAYOUT_UNKNOWN", "PAYOUT_IN_FLIGHT"];
async function settle(run: Run): Promise<Run> {
  for (let i = 0; i < 200 && !SETTLED_STATES.includes(run.state); i++) await new Promise(r => setTimeout(r, 5));
  // Let in-flight polling finish too.
  for (let i = 0; i < 200 && run.state === "PAYOUT_IN_FLIGHT"; i++) await new Promise(r => setTimeout(r, 5));
  return run;
}

describe("CashXChain sandbox lock (config)", () => {
  it("accepts sandbox secret and restricted keys only", () => {
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_sk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_rk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({}).cxcReady).toBe(false);
    expect(() => loadConfig({ CASHXCHAIN_API_KEY: "cxc_sk_live_abc123" })).toThrow(/sandbox key/);
    // Legacy format says "sandbox" in every environment, so it may be a production key.
    expect(() => loadConfig({ CASHXCHAIN_API_KEY: "sk_sandbox_abc123" })).toThrow(/sandbox key/);
    expect(() => loadConfig({ CASHXCHAIN_API_KEY: "cxc_pk_sandbox_abc123" })).toThrow(/sandbox key/);
  });
});

describe("CashXChain client", () => {
  it("sends the bearer key and parses the error envelope", async () => {
    const { fake } = await setup();
    const url = await listen(fake.app);
    const bad = new CashXChainClient({ apiKey: "cxc_sk_sandbox_wrong", baseUrl: url });
    const error = await bad.listAccounts().catch(e => e);
    expect(error).toBeInstanceOf(CxcApiError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
    expect(error.requestId).toMatch(/^req_/);
    expect(fake.state.seen.at(-1)?.authorization).toBe("Bearer cxc_sk_sandbox_wrong");
  });

  it("reports framework plain-text rejections without a code", async () => {
    const app = express();
    app.post("/v1/banking/payouts", (_req, res) => void res.status(422).type("text/plain").send("Failed to deserialize the JSON body: missing field `beneficiary_id`"));
    const client = new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: await listen(app) });
    const error = await client.createPayout({ source_account_id: "a", beneficiary_id: "", amount: "1.00", currency: "EUR" }, "k").catch(e => e);
    expect(error).toMatchObject({ status: 422, code: undefined });
    expect(error.message).toContain("missing field `beneficiary_id`");
  });

  it("formats amounts with exactly the currency's decimals", () => {
    expect(toDecimal(1_248_000, "EUR")).toBe("12480.00");
    expect(toDecimal(5, "USD")).toBe("0.05");
    expect(toDecimal(1_000, "JPY")).toBe("1000");
  });
});

describe("payout preparation (moves no money)", () => {
  it("picks the account, registers the payee, checks it and prices the payout", async () => {
    const s = await setup();
    const prepared = await s.desk.prepare(sepa);
    expect(prepared).toMatchObject({
      kind: "ready",
      plan: {
        environment: "sandbox",
        sourceAccountId: "mockacct_fake_eur",
        scheme: "iban",
        crossCurrency: false,
        amount: "12480.00",
        currency: "EUR",
        reference: "PO-7781",
        payeeCheck: { outcome: "not_checked", mayPay: true },
        quote: { sourceAmount: "12485.00", sourceCurrency: "EUR", fee: "5.00", simulated: true },
        available: "50000.0000",
        sufficientFunds: true,
      },
    });
    const ben = s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries")!;
    expect(ben.body).toEqual({
      beneficiary_type: "business",
      name: "Brenner Maschinenbau GmbH",
      currency: "EUR",
      country_code: "DE",
      account: { scheme: "iban", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
    });
    expect(ben.idempotencyKey).toMatch(/^agentpay-ben-[0-9a-f]{32}$/);
    expect(s.fake.state.seen.some(r => r.path === "/v1/banking/corridors?currency=EUR&country=DE&entity_type=business")).toBe(true);
    expect(s.fake.payoutCount()).toBe(0);
    // Same payee again: same key, same beneficiary.
    const again = await s.desk.prepare(sepa);
    expect(again.kind === "ready" && prepared.kind === "ready" && again.plan.beneficiaryId === prepared.plan.beneficiaryId).toBe(true);
  });

  it("flags missing funds without refusing the draft", async () => {
    const s = await setup();
    s.fake.state.balances.set("mockacct_fake_eur", 100);
    expect(await s.desk.prepare(sepa)).toMatchObject({ kind: "ready", plan: { available: "100.0000", sufficientFunds: false } });
  });

  it("pays a USD invoice from the EUR account when no USD account exists (sandbox converts)", async () => {
    const s = await setup();
    const prepared = await s.desk.prepare({ ...us, accountType: "checking" });
    expect(prepared).toMatchObject({
      kind: "ready",
      plan: { sourceAccountId: "mockacct_fake_eur", crossCurrency: true, currency: "USD", amount: "4250.00", quote: { sourceCurrency: "EUR", sourceAmount: "3405.00", rate: "1.25" } },
    });
    const run = await draftReady(s, { ...us, accountType: "checking" });
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(s.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000 - 3_405);
  });

  it("asks for corridor fields the invoice does not carry, and sends them once printed", async () => {
    const s = await setup();
    s.fake.state.accounts.push({ id: "mockacct_fake_usd", currency: "USD", status: "active", display_name: "USD" });
    s.fake.state.balances.set("mockacct_fake_usd", 10_000);
    expect(await s.desk.prepare(us)).toEqual({ kind: "needs_info", reason: "USD/US also requires account_type (Account type)" });
    expect(s.fake.state.seen.some(r => r.path === "/v1/banking/beneficiaries")).toBe(false);

    const prepared = await s.desk.prepare({ ...us, accountType: "checking" });
    expect(prepared).toMatchObject({ kind: "ready", plan: { scheme: "us_routing", amount: "4250.00", sourceAccountId: "mockacct_fake_usd", crossCurrency: false } });
    expect(s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries")?.body).toMatchObject({
      account: { scheme: "us_routing", routing_number: "021000021", account_number: "000123456789" },
      corridor_fields: { account_type: "checking" },
    });
  });

  it("separates invoice problems from setup problems", async () => {
    const s = await setup();
    s.fake.state.accounts.push({ id: "mockacct_fake_gbp", currency: "GBP", status: "active", display_name: "GBP" });
    const gb = { ...sepa, destinationCountry: "GB", currency: "GBP", iban: "GB29NWBK60161331926819", bic: undefined };
    expect(await s.desk.prepare(gb)).toMatchObject({ kind: "needs_info", reason: expect.stringContaining("takes scan") });

    s.fake.state.accounts.push({ id: "mockacct_fake_chf", currency: "CHF", status: "active", display_name: "CHF" });
    expect(await s.desk.prepare({ ...sepa, destinationCountry: "CH", currency: "CHF" })).toMatchObject({ kind: "blocked" });

    s.fake.state.accounts = [];
    expect(await s.desk.prepare(sepa)).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("no active account") });
    s.fake.state.accounts = [{ id: "mockacct_fake_eur", currency: "EUR", status: "active", display_name: "EUR account" }];

    s.fake.state.payee = { outcome: "close_match", may_pay: false, account_holder: "Brenner Maschinenbau AG", check: "VOP" };
    expect(await s.desk.prepare(sepa)).toMatchObject({ kind: "needs_info", reason: 'payee-name check: close_match (bank holds "Brenner Maschinenbau AG")' });

    const offline = new PayoutDesk(new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: "http://127.0.0.1:9", timeoutMs: 2_000 }), s.runs);
    expect(await offline.prepare(sepa)).toMatchObject({ kind: "unavailable" });
  });
});

describe("payout execution (only after human approval)", () => {
  it("approve sends exactly one payout under the invoice-derived key and ends settled", async () => {
    const s = await setup();
    const run = await draftReady(s);
    expect(s.desk.approve(run)).toEqual({ ok: true });
    // Double click while sending: refused synchronously.
    expect(s.desk.approve(run)).toMatchObject({ ok: false, status: 409 });
    await settle(run);

    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(run.payout).toMatchObject({ environment: "sandbox", attempt: 1, status: "settled", amount: "12480.0000", currency: "EUR" });
    expect(run.payout?.settledAt).toBeTruthy();
    const creates = s.fake.payoutCreates();
    expect(creates).toHaveLength(1);
    expect(creates[0]!.idempotencyKey).toBe(payoutKey(invoiceFingerprint(sepa), 1));
    expect(creates[0]!.body).toEqual({
      source_account_id: "mockacct_fake_eur",
      beneficiary_id: run.draft!.cashxchain!.beneficiaryId,
      amount: "12480.00",
      currency: "EUR",
      reference: "PO-7781",
    });
    expect(s.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000 - 12_485);
    expect(s.desk.approve(run)).toMatchObject({ ok: false, error: "run is PAYOUT_SETTLED" });
  });

  it("after a restart, the same invoice replays the settled payout instead of paying again", async () => {
    const s = await setup();
    const first = await draftReady(s);
    s.desk.approve(first);
    await settle(first);

    // New process: fresh desk and run store, same CashXChain account.
    const runs = new RunStore();
    const desk = new PayoutDesk(new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: await listen(s.fake.app) }), runs, { pollIntervalMs: 1 });
    const second = await draftReady({ ...s, runs, desk });
    desk.approve(second);
    await settle(second);

    expect(second.state).toBe("PAYOUT_SETTLED");
    expect(second.payout?.id).toBe(first.payout?.id);
    expect(s.fake.payoutCount()).toBe(1);
    expect(s.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000 - 12_485);
  });

  it("a refusal that burns the key moves the next approval to a new key", async () => {
    const s = await setup();
    s.fake.state.balances.set("mockacct_fake_eur", 10);
    const run = await draftReady(s);
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_FAILED");
    expect(run.payout).toMatchObject({ attempt: 1, retryWithNewKey: true, error: { httpStatus: 400, code: "insufficient_balance" } });

    s.fake.state.balances.set("mockacct_fake_eur", 50_000); // topped up in the web app
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(run.payout?.attempt).toBe(2);
    expect(s.fake.payoutCreates().map(c => c.idempotencyKey)).toEqual([
      payoutKey(run.fingerprint!, 1),
      payoutKey(run.fingerprint!, 2),
    ]);
  });

  it("a refusal recorded nowhere keeps the key, so a restart cannot open a gap", async () => {
    const s = await setup();
    const run = await draftReady(s);
    s.fake.state.failNextCreate = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit" };
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_FAILED");
    expect(run.payout).toMatchObject({ attempt: 1, retryWithNewKey: false, error: { code: "plan_limit_exceeded" } });

    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(new Set(s.fake.payoutCreates().map(c => c.idempotencyKey))).toEqual(new Set([payoutKey(run.fingerprint!, 1)]));
  });

  it("an unknown outcome (5xx) is re-checked under the same key and never paid twice", async () => {
    const s = await setup();
    const run = await draftReady(s);
    s.fake.state.failNextCreate = { status: 504, error: "gateway_timeout", message: "Upstream service timed out", record: "settled" };
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_UNKNOWN");
    expect(run.payout?.error).toMatchObject({ httpStatus: 504, code: "gateway_timeout" });

    s.desk.approve(run); // "Check status"
    await settle(run);
    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(s.fake.payoutCount()).toBe(1);
    expect(s.fake.payoutCreates().every(c => c.idempotencyKey === payoutKey(run.fingerprint!, 1))).toBe(true);
  });

  it("follows an in-flight payout until it settles", async () => {
    const s = await setup();
    s.fake.state.createStatus = "submitted";
    s.fake.state.getStatuses = ["processing", "settled"];
    const run = await draftReady(s);
    s.desk.approve(run);
    await settle(run);
    expect(run.state).toBe("PAYOUT_SETTLED");
    expect(run.timeline.map(t => t.state).slice(-4)).toEqual(["DRAFT_READY", "PAYOUT_SENDING", "PAYOUT_IN_FLIGHT", "PAYOUT_SETTLED"]);
  });

  it("refuses non-executable drafts and rejected runs", async () => {
    const s = await setup();
    const run = await draftReady(s);
    expect(rejectDraft(s.runs, run)).toEqual({ ok: true });
    expect(run.state).toBe("REJECTED");
    expect(s.desk.approve(run)).toMatchObject({ ok: false, error: "run is REJECTED" });

    const blocked = await draftReady(s, { ...sepa, id: "INV-2" });
    blocked.draft = { ...blocked.draft!, executable: false, cashxchain: undefined, blockedReason: "CashXChain unavailable: down" };
    expect(s.desk.approve(blocked)).toMatchObject({ ok: false, status: 409, error: "draft is not executable: CashXChain unavailable: down" });
    expect(s.fake.payoutCount()).toBe(0);
  });
});
