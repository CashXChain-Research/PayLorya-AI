import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientCardanoSigner } from "@x402/cardano";
import { BuyerAgent } from "../src/agent.js";
import { CashXChainClient } from "../src/cashxchain.js";
import { loadConfig } from "../src/config.js";
import { beneficiaryTarget, CashXChainPayoutRoute, PayoutRefusedError, PayoutUnknownError, toDecimal } from "../src/payout-cashxchain.js";
import { invoiceFingerprint } from "../src/readiness.js";
import { CRYPTO_PAYEE, decideRoute, findPayee, payeeDirectory, payoutKey, type VerifiedPayee } from "../src/routing.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

const IBAN = "DE89370400440532013000";
const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH, Augsburg",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 62_400,
  iban: IBAN,
};
const us: Invoice = {
  id: "A-5531",
  supplier: "Lakeside Robotics Inc.",
  destinationCountry: "US",
  currency: "USD",
  amountMinor: 42_500,
  routingNumber: "021000021",
  accountNumber: "000123456789",
};
// The verified records the agent passes; never derived from invoice text.
const directory = payeeDirectory();
const BRENNER = findPayee(directory, sepa.supplier)!;
const LAKESIDE = findPayee(directory, us.supplier)!;

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

async function setup(opts: { pollAttempts?: number } = {}) {
  const fake = createFakeCxc();
  const client = new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: await listen(fake.app) });
  const route = new CashXChainPayoutRoute(client, { pollIntervalMs: 1, pollAttempts: opts.pollAttempts ?? 3 });
  const pay = (invoice: Invoice = sepa, payee: VerifiedPayee = BRENNER, idempotencyKey = "payout-k1") =>
    route.payout({ idempotencyKey, invoice, destination: "display only", payee });
  return { fake, route, pay };
}

const rejection = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);

describe("CashXChainPayoutRoute: settled and replayed", () => {
  it("registers the verified payee, pays with the agent's key and returns the payout id", async () => {
    const s = await setup();
    const { reference } = await s.pay();

    const [create] = s.fake.payoutCreates();
    expect(create?.idempotencyKey).toBe("payout-k1");
    expect(create?.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(create?.body).toEqual({
      source_account_id: "mockacct_fake_eur",
      beneficiary_id: expect.stringMatching(/^mockben_fake_/),
      amount: "624.00",
      currency: "EUR",
      reference: "INV20261042",
    });
    expect([...s.fake.state.payouts.values()][0]?.payout).toMatchObject({ id: reference, status: "settled" });
    const ben = s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries");
    // Name and account from the record, not the extracted "Brenner Maschinenbau GmbH, Augsburg".
    expect(ben?.body).toEqual({
      beneficiary_type: "business",
      name: BRENNER.name,
      currency: "EUR",
      country_code: "DE",
      account: { scheme: "iban", iban: IBAN, ...(BRENNER.bic ? { bic: BRENNER.bic } : {}) },
    });
    expect(ben?.idempotencyKey).toMatch(/^agentpay-ben-[0-9a-f]{32}$/);
  });

  it("the same key replays the payout instead of paying again", async () => {
    const s = await setup();
    const first = await s.pay();
    const second = await s.pay();
    expect(second.reference).toBe(first.reference);
    expect(s.fake.payoutCount()).toBe(1);
    expect(s.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000 - 624 - 5);
  });

  it("pays a US payee over us_routing with the record's account_type", async () => {
    const s = await setup();
    s.fake.state.accounts.push({ id: "mockacct_fake_usd", currency: "USD", status: "active", display_name: "USD" });
    s.fake.state.balances.set("mockacct_fake_usd", 10_000);
    expect(LAKESIDE.accountType).toBe("checking");
    expect((await s.pay(us, LAKESIDE)).reference).toBeTruthy();
    expect(s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries")?.body).toMatchObject({
      name: LAKESIDE.name,
      country_code: "US",
      account: { scheme: "us_routing", routing_number: "021000021", account_number: "000123456789" },
      corridor_fields: { account_type: "checking" },
    });
    expect(s.fake.payoutCreates()[0]?.body).toMatchObject({ source_account_id: "mockacct_fake_usd", amount: "425.00", currency: "USD" });
  });

  it("follows an accepted payout until it settles, and returns it while still in flight", async () => {
    const s = await setup();
    s.fake.state.createStatus = "submitted";
    s.fake.state.getStatuses = ["processing", "settled"];
    expect((await s.pay()).reference).toBeTruthy();

    const slow = await setup({ pollAttempts: 2 });
    slow.fake.state.createStatus = "submitted";
    slow.fake.state.getStatuses = ["processing"];
    expect((await slow.pay()).reference).toBeTruthy(); // accepted: the agent records it as submitted
  });
});

describe("CashXChainPayoutRoute: refused means nothing was sent", () => {
  it("before the payout POST: no source account, no bank account on record, unreachable API", async () => {
    const s = await setup();
    s.fake.state.accounts = [];
    expect(await rejection(s.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "no_source_account" });
    const wallet = findPayee(directory, CRYPTO_PAYEE)!;
    expect(await rejection(s.pay(sepa, wallet))).toMatchObject({ constructor: PayoutRefusedError, code: "no_bank_account" });

    const offline = new CashXChainPayoutRoute(new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: "http://127.0.0.1:9", timeoutMs: 2_000 }));
    expect(await rejection(offline.payout({ idempotencyKey: "k", invoice: sepa, destination: IBAN, payee: BRENNER }))).toMatchObject({
      constructor: PayoutRefusedError,
      code: "unreachable",
    });
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });

  it("a corridor field missing from the record (USD/US account_type) refuses at registration", async () => {
    const s = await setup();
    s.fake.state.accounts.push({ id: "mockacct_fake_usd", currency: "USD", status: "active", display_name: "USD" });
    const error = await rejection(s.pay(us, { ...LAKESIDE, accountType: undefined }));
    expect(error).toMatchObject({ constructor: PayoutRefusedError, code: "bad_request" });
    expect((error as Error).message).toContain("account_type");
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });

  it("a 4xx on the payout POST (plan limit, balance) is a refusal", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit of the free plan" };
    expect(await rejection(s.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "plan_limit_exceeded" });

    const poor = await setup();
    poor.fake.state.balances.set("mockacct_fake_eur", 10);
    expect(await rejection(poor.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "insufficient_balance" });
    // Same key again: CashXChain recorded it as failed and replays 200 { status: "failed" }. Still nothing paid.
    poor.fake.state.balances.set("mockacct_fake_eur", 50_000);
    expect(await rejection(poor.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "failed" });
    expect(poor.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000);
  });

  it("isDefinitiveRejection is true for refusals only", async () => {
    const s = await setup();
    expect(s.route.isDefinitiveRejection(new PayoutRefusedError("x", "y"))).toBe(true);
    expect(s.route.isDefinitiveRejection(new PayoutUnknownError("y"))).toBe(false);
    expect(s.route.isDefinitiveRejection(new Error("y"))).toBe(false);
  });
});

describe("CashXChainPayoutRoute: a 4xx is a refusal only when no payout can exist under the key", () => {
  it("409 (key bound to another body, or a conflict) and 429 are unknown", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 409, error: "idempotency_key_reuse", message: "this Idempotency-Key was used for a different request" };
    expect(await rejection(s.pay())).toBeInstanceOf(PayoutUnknownError);
    s.fake.state.failNextCreate = { status: 429, error: "rate_limited", message: "upstream partner rate-limited the request", record: "created" };
    expect(await rejection(s.pay(sepa, BRENNER, "payout-k2"))).toBeInstanceOf(PayoutUnknownError);
  });

  it("any other 4xx is unknown, even on a fresh key: a replay re-runs checks before it finds the payout", async () => {
    const s = await setup();
    for (const failure of [
      { status: 403, error: "account_on_hold", message: "This account is on hold. Contact support." },
      { status: 403, error: "account_not_verified", message: "This account cannot move money until its business verification is approved." },
      { status: 404, error: "not_found", message: "no beneficiary mockben_x" },
      { status: 422, error: "payee_name_mismatch", message: "The receiving bank says this account is held by someone else." },
    ]) {
      s.fake.state.failNextCreate = failure;
      expect(await rejection(s.pay(sepa, BRENNER, `payout-${failure.error}`))).toBeInstanceOf(PayoutUnknownError);
    }
  });

  it("after a restart, a settled payout behind a re-run 403 is not reported as nothing paid", async () => {
    const s = await setup();
    const { reference } = await s.pay(); // settled by the process before the restart
    const restarted = new CashXChainPayoutRoute(new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: await listen(s.fake.app) }), { pollIntervalMs: 1 });
    s.fake.state.failNextCreate = { status: 403, error: "account_on_hold", message: "This account is on hold. Contact support.", beforeReplay: true };
    const error = await rejection(restarted.payout({ idempotencyKey: "payout-k1", invoice: sepa, destination: IBAN, payee: BRENNER }));
    expect(error).toBeInstanceOf(PayoutUnknownError);
    expect(restarted.isDefinitiveRejection(error)).toBe(false);
    expect(s.fake.payoutCount()).toBe(1);
    expect([...s.fake.state.payouts.values()][0]?.payout.id).toBe(reference);
  });

  it("corridor_unsupported is a refusal: CashXChain checks corridors only on a first attempt", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 422, error: "corridor_unsupported", message: "EUR payouts to DE are not offered." };
    expect(await rejection(s.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "corridor_unsupported" });
  });

  it("plan_limit_exceeded stays a refusal on a resent key: limits run after the replay lookup", async () => {
    const s = await setup();
    const limit = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit" };
    s.fake.state.failNextCreate = limit;
    expect(await rejection(s.pay())).toBeInstanceOf(PayoutRefusedError);
    s.fake.state.failNextCreate = limit;
    expect(await rejection(s.pay())).toBeInstanceOf(PayoutRefusedError);
  });

  it("ids whose case only differs outside ASCII share a key and send one reference", async () => {
    const s = await setup();
    // Same payoutKey (it lower-cases first), but upper-casing the raw ids would differ.
    for (const [a, b] of [["İNV-7", "inv-7"], ["ẞ-11", "ß-11"]] as const) {
      expect(payoutKey(BRENNER, { ...sepa, id: a })).toBe(payoutKey(BRENNER, { ...sepa, id: b }));
      const key = `payout-${payoutKey(BRENNER, { ...sepa, id: a })}`;
      expect((await s.pay({ ...sepa, id: a }, BRENNER, key)).reference).toBe((await s.pay({ ...sepa, id: b }, BRENNER, key)).reference);
    }
    expect(s.fake.payoutCount()).toBe(2);
  });

  it("invoice id variants that share the agent's payout key send an identical body", async () => {
    const s = await setup();
    const variants = ["INV-2026-1042", " inv 2026/1042 ", "Inv.2026.1042"];
    expect(new Set(variants.map(id => payoutKey(BRENNER, { ...sepa, id })))).toHaveProperty("size", 1);
    const refs = [];
    for (const id of variants) refs.push((await s.pay({ ...sepa, id })).reference);
    expect(new Set(refs).size).toBe(1);
    expect(new Set(s.fake.payoutCreates().map(c => (c.body as { reference: string }).reference))).toEqual(new Set(["INV20261042"]));
    expect(s.fake.payoutCount()).toBe(1);
  });
});

describe("CashXChainPayoutRoute: unknown means lock and check", () => {
  it("a 5xx or timeout on the payout POST", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 504, error: "gateway_timeout", message: "Upstream service timed out", record: "settled" };
    const error = await rejection(s.pay());
    expect(error).toBeInstanceOf(PayoutUnknownError);
    expect((error as PayoutUnknownError).payoutId).toBeUndefined();
    // The payout did happen; the same key finds it instead of paying again.
    expect((await s.pay()).reference).toBeTruthy();
    expect(s.fake.payoutCount()).toBe(1);
  });

  it("a payout stuck in created, and one returned after settling", async () => {
    const stuck = await setup({ pollAttempts: 2 });
    stuck.fake.state.createStatus = "created";
    expect(await rejection(stuck.pay())).toMatchObject({ constructor: PayoutUnknownError, payoutId: expect.any(String) });

    const back = await setup();
    back.fake.state.createStatus = "submitted";
    back.fake.state.getStatuses = ["returned"];
    expect(await rejection(back.pay())).toMatchObject({ constructor: PayoutUnknownError, payoutId: expect.any(String) });
  });
});

describe("helpers and config", () => {
  it("maps verified records and formats amounts", () => {
    expect(beneficiaryTarget({ name: "x", iban: IBAN })).toEqual({ account: { scheme: "iban", iban: IBAN }, country: "DE" });
    expect(beneficiaryTarget({ name: "x", routingNumber: "021000021", accountNumber: "1" })).toEqual({
      account: { scheme: "us_routing", routing_number: "021000021", account_number: "1" },
      country: "US",
    });
    expect(beneficiaryTarget({ name: "x", cardanoAddress: "addr_test1q" })).toBeUndefined();
    expect(toDecimal(62_400, "EUR")).toBe("624.00");
    expect(toDecimal(5, "USD")).toBe("0.05");
    expect(toDecimal(1_000, "JPY")).toBe("1000");
  });

  it("accepts CashXChain sandbox keys only; any other key is dropped with a reason, never a crash", () => {
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_sk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_rk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({}).cxcReady).toBe(false);
    for (const key of ["cxc_sk_live_abc123", "sk_sandbox_abc123", "cxc_mk_sandbox_abc123"]) {
      const config = loadConfig({ CASHXCHAIN_API_KEY: key });
      expect(config.cxcReady).toBe(false);
      expect(config.CASHXCHAIN_API_KEY).toBeUndefined();
      expect(config.cxcRefused.apiKey).toMatch(/^CASHXCHAIN_API_KEY: not a CashXChain sandbox key; live keys are refused/);
    }
  });

  it("takes a sandbox master key only; a live master key is dropped with a reason", () => {
    expect(loadConfig({ CASHXCHAIN_MASTER_KEY: "cxc_mk_sandbox_abc123" }).CASHXCHAIN_MASTER_KEY).toBe("cxc_mk_sandbox_abc123");
    const live = loadConfig({ CASHXCHAIN_MASTER_KEY: "cxc_mk_live_abc123" });
    expect(live.CASHXCHAIN_MASTER_KEY).toBeUndefined();
    expect(live.cxcRefused).toEqual({ masterKey: expect.stringMatching(/^CASHXCHAIN_MASTER_KEY: not a CashXChain sandbox key/) });
    expect(loadConfig({ CASHXCHAIN_MASTER_KEY: "cxc_sk_sandbox_abc123" }).CASHXCHAIN_MASTER_KEY).toBeUndefined();
  });
});

describe("wired into the agent's approval flow", () => {
  const SELLER = "addr_test1vqsellerstub000000000000000000000000000000000000";
  const signer: ClientCardanoSigner = {
    getAddress: () => "addr_test1vqbuyerstub0000000000000000000000000000000000000",
    buildAndSignPaymentTransaction: () => {
      throw new Error("fiat payouts must not sign");
    },
  };

  /** A run as the agent leaves it after a paid, passing report: DRAFT_READY with the selected route. */
  function draftReady(runs: RunStore, invoice: Invoice): Run {
    const run = runs.create(JSON.stringify(invoice));
    run.invoice = invoice;
    run.fingerprint = invoiceFingerprint(invoice);
    const route = decideRoute(invoice, directory, { payoutMaxLovelace: 10_000_000n });
    run.route = route;
    run.draft = {
      status: "awaiting_human_approval",
      executable: route.status === "selected",
      invoiceId: invoice.id,
      supplier: invoice.supplier,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      route,
      note: "n",
    };
    runs.transition(run, "DRAFT_READY");
    return run;
  }

  async function approve(agent: BuyerAgent, run: Run): Promise<void> {
    const started = agent.approve(run);
    if (!started.ok) throw new Error(started.reason);
    await started.done;
  }

  function agentWith(s: Awaited<ReturnType<typeof setup>>) {
    const runs = new RunStore();
    const agent = new BuyerAgent(loadConfig({ SELLER_ADDRESS: SELLER }), runs, signer, { fiat: s.route });
    return { runs, agent };
  }

  it("approve pays the verified payee through CashXChain and records the payout id", async () => {
    const s = await setup();
    const { runs, agent } = agentWith(s);
    const run = draftReady(runs, sepa);
    await approve(agent, run);

    expect(run.state).toBe("EXECUTED");
    expect(run.payout).toMatchObject({
      rail: "cxc_fiat",
      status: "submitted",
      simulated: false,
      reference: [...s.fake.state.payouts.values()][0]?.payout.id,
      label: "CashXChain sandbox payout (test ledger, no real money)",
    });
    expect(s.fake.payoutCreates()[0]?.idempotencyKey).toBe(`payout-${payoutKey(BRENNER, sepa)}`);
  });

  it("a run given its own route (a workspace's own CashXChain key) pays over it; other runs keep the default", async () => {
    const s = await setup();
    const runs = new RunStore();
    // Default route: the simulated stand-in. The first run carries the CashXChain route instead.
    const agent = new BuyerAgent(loadConfig({ SELLER_ADDRESS: SELLER }), runs, signer, {});
    const own = draftReady(runs, sepa);
    agent.useFiatRoute(own, s.route);
    const preview = await agent.preview(own, "disabled");
    expect(preview.railLabel).toBe("CashXChain sandbox payout (test ledger, no real money)");
    expect(preview.from).toMatchObject({ kind: "cxc_account", currency: "EUR" });
    await approve(agent, own);
    expect(own.payout).toMatchObject({ status: "submitted", simulated: false, reference: [...s.fake.state.payouts.values()][0]?.payout.id });

    const other = draftReady(runs, us);
    await approve(agent, other);
    expect(other.payout).toMatchObject({ status: "simulated", simulated: true });
    expect(s.fake.payoutCreates()).toHaveLength(1);
  });

  it("a refusal hands the draft back, and approving again pays under the same key", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit" };
    const { runs, agent } = agentWith(s);
    const run = draftReady(runs, sepa);

    await approve(agent, run);
    expect(run.state).toBe("DRAFT_READY");
    expect(run.error).toContain("plan_limit_exceeded");

    await approve(agent, run);
    expect(run.state).toBe("EXECUTED");
    expect(new Set(s.fake.payoutCreates().map(c => c.idempotencyKey))).toEqual(new Set([`payout-${payoutKey(BRENNER, sepa)}`]));
    expect(s.fake.payoutCount()).toBe(1);
  });

  it("insufficient balance burns the key at CashXChain: refusable again, never paid twice", async () => {
    const s = await setup();
    s.fake.state.balances.set("mockacct_fake_eur", 10);
    const { runs, agent } = agentWith(s);
    const run = draftReady(runs, sepa);
    await approve(agent, run);
    expect(run.state).toBe("DRAFT_READY");

    s.fake.state.balances.set("mockacct_fake_eur", 50_000); // topped up
    await approve(agent, run);
    // Same per-invoice key: CashXChain replays the recorded failure. Nothing paid, not locked.
    expect(run.state).toBe("DRAFT_READY");
    expect(run.error).toContain("failed");
    expect(s.fake.state.balances.get("mockacct_fake_eur")).toBe(50_000);
  });

  it("an unknown outcome locks the invoice", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 503, error: "service_unavailable", message: "Upstream service is unavailable" };
    const { runs, agent } = agentWith(s);
    const run = draftReady(runs, sepa);
    await approve(agent, run);
    expect(run.state).toBe("PAYOUT_UNKNOWN");
    expect(agent.approve(run)).toMatchObject({ ok: false });
  });
});
