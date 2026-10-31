import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientCardanoSigner } from "@x402/cardano";
import { BuyerAgent } from "../src/agent.js";
import { CashXChainClient } from "../src/cashxchain.js";
import { loadConfig } from "../src/config.js";
import { accountFromDestination, CashXChainPayoutRoute, PayoutRefusedError, PayoutUnknownError, toDecimal } from "../src/payout-cashxchain.js";
import { invoiceFingerprint } from "../src/readiness.js";
import { decideRoute, payeeDirectory } from "../src/routing.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 62_400,
  iban: "DE89370400440532013000",
};
const IBAN = "DE89370400440532013000";
const us: Invoice = {
  id: "A-5531",
  supplier: "Lakeside Robotics Inc.",
  destinationCountry: "US",
  currency: "USD",
  amountMinor: 42_500,
  routingNumber: "021000021",
  accountNumber: "000123456789",
};

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
  const pay = (invoice: Invoice = sepa, destination = IBAN, idempotencyKey = "run-1") => route.payout({ idempotencyKey, invoice, destination });
  return { fake, route, pay };
}

const rejection = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);

describe("CashXChainPayoutRoute: settled and replayed", () => {
  it("registers the verified account, pays with the agent's key and returns the payout id", async () => {
    const s = await setup();
    const { reference } = await s.pay();

    const [create] = s.fake.payoutCreates();
    expect(create?.idempotencyKey).toBe("run-1");
    expect(create?.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(create?.body).toEqual({
      source_account_id: "mockacct_fake_eur",
      beneficiary_id: expect.stringMatching(/^mockben_fake_/),
      amount: "624.00",
      currency: "EUR",
      reference: "INV-2026-1042",
    });
    expect([...s.fake.state.payouts.values()][0]?.payout).toMatchObject({ id: reference, status: "settled" });
    const ben = s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries");
    expect(ben?.body).toEqual({
      beneficiary_type: "business",
      name: "Brenner Maschinenbau GmbH",
      currency: "EUR",
      country_code: "DE",
      account: { scheme: "iban", iban: IBAN },
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
  it("before the payout POST: no source account, unsupported destination, unreachable API", async () => {
    const s = await setup();
    s.fake.state.accounts = [];
    expect(await rejection(s.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "no_source_account" });
    expect(await rejection(s.pay(sepa, "acct 42"))).toMatchObject({ constructor: PayoutRefusedError, code: "unsupported_destination" });

    const offline = new CashXChainPayoutRoute(new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: "http://127.0.0.1:9", timeoutMs: 2_000 }));
    expect(await rejection(offline.payout({ idempotencyKey: "k", invoice: sepa, destination: IBAN }))).toMatchObject({
      constructor: PayoutRefusedError,
      code: "unreachable",
    });
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });

  it("a corridor field the payee record lacks (USD/US account_type) refuses at registration", async () => {
    const s = await setup();
    s.fake.state.accounts.push({ id: "mockacct_fake_usd", currency: "USD", status: "active", display_name: "USD" });
    const error = await rejection(s.pay(us, "ABA 021000021 / 000123456789"));
    expect(error).toMatchObject({ constructor: PayoutRefusedError, code: "bad_request" });
    expect((error as Error).message).toContain("account_type");
    expect(s.fake.state.seen.find(r => r.path === "/v1/banking/beneficiaries")?.body).toMatchObject({
      account: { scheme: "us_routing", routing_number: "021000021", account_number: "000123456789" },
    });
    expect(s.fake.payoutCreates()).toHaveLength(0);
  });

  it("a 4xx on the payout POST (plan limit, balance) is a refusal", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit of the free plan" };
    expect(await rejection(s.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "plan_limit_exceeded" });

    const poor = await setup();
    poor.fake.state.balances.set("mockacct_fake_eur", 10);
    expect(await rejection(poor.pay())).toMatchObject({ constructor: PayoutRefusedError, code: "insufficient_balance" });
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

  it("a replay of a recorded failure, and a payout stuck in created", async () => {
    const s = await setup();
    s.fake.state.balances.set("mockacct_fake_eur", 10);
    expect(await rejection(s.pay())).toBeInstanceOf(PayoutRefusedError); // first answer: 400 insufficient_balance
    const replay = await rejection(s.pay()); // same key: 200 with status failed
    expect(replay).toMatchObject({ constructor: PayoutUnknownError, payoutId: expect.any(String) });

    const stuck = await setup({ pollAttempts: 2 });
    stuck.fake.state.createStatus = "created";
    expect(await rejection(stuck.pay())).toMatchObject({ constructor: PayoutUnknownError, payoutId: expect.any(String) });
  });
});

describe("helpers and config", () => {
  it("parses the router's destinations and formats amounts", () => {
    expect(accountFromDestination(IBAN)).toEqual({ scheme: "iban", iban: IBAN });
    expect(accountFromDestination("ABA 021000021 / 000123456789")).toEqual({
      scheme: "us_routing",
      routing_number: "021000021",
      account_number: "000123456789",
    });
    expect(accountFromDestination("addr_test1qxyz")).toBeUndefined();
    expect(toDecimal(62_400, "EUR")).toBe("624.00");
    expect(toDecimal(5, "USD")).toBe("0.05");
    expect(toDecimal(1_000, "JPY")).toBe("1000");
  });

  it("accepts CashXChain sandbox keys only", () => {
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_sk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({ CASHXCHAIN_API_KEY: "cxc_rk_sandbox_abc123" }).cxcReady).toBe(true);
    expect(loadConfig({}).cxcReady).toBe(false);
    expect(() => loadConfig({ CASHXCHAIN_API_KEY: "cxc_sk_live_abc123" })).toThrow(/sandbox key/);
    expect(() => loadConfig({ CASHXCHAIN_API_KEY: "sk_sandbox_abc123" })).toThrow(/sandbox key/); // legacy format
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
    const route = decideRoute(invoice, payeeDirectory(), { payoutMaxLovelace: 10_000_000n });
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

  async function agentWith(s: Awaited<ReturnType<typeof setup>>) {
    const runs = new RunStore();
    const agent = new BuyerAgent(loadConfig({ SELLER_ADDRESS: SELLER }), runs, signer, { fiat: s.route });
    return { runs, agent };
  }

  it("approve pays the verified IBAN through CashXChain and records the payout id", async () => {
    const s = await setup();
    const { runs, agent } = await agentWith(s);
    const run = draftReady(runs, sepa);

    const started = agent.approve(run);
    expect(started.ok).toBe(true);
    if (started.ok) await started.done;

    expect(run.state).toBe("EXECUTED");
    expect(run.payout).toMatchObject({
      rail: "cxc_fiat",
      status: "submitted",
      simulated: false,
      destination: IBAN,
      reference: [...s.fake.state.payouts.values()][0]?.payout.id,
      label: "CashXChain sandbox payout (test ledger, no real money)",
    });
    expect(s.fake.payoutCreates()[0]?.idempotencyKey).toBe(run.id);
  });

  it("a refusal still ends PAYOUT_UNKNOWN in today's agent (safe side), with the reason", async () => {
    const s = await setup();
    s.fake.state.failNextCreate = { status: 422, error: "plan_limit_exceeded", message: "above the $2500 single-payment limit" };
    const { runs, agent } = await agentWith(s);
    const run = draftReady(runs, sepa);
    const started = agent.approve(run);
    if (started.ok) await started.done;
    expect(run.state).toBe("PAYOUT_UNKNOWN");
    expect(run.error).toContain("plan_limit_exceeded");
  });
});
