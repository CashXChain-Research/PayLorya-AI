import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CashXChainClient } from "../src/cashxchain.js";
import { buildCxcReadinessReport, buildReadinessReport, ReadinessLedger } from "../src/readiness.js";
import type { Invoice, ReadinessReport } from "../src/types.js";
import { createFakeCxc, FAKE_KEY } from "./fake-cashxchain.js";

// Readiness report with corridor, required fields and quote from the CashXChain sandbox (fake on 127.0.0.1).

const opts = { amountCeilingMinor: 5_000_000 };
const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 62_400,
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};
const us: Invoice = {
  id: "A-5531",
  supplier: "Lakeside Robotics Inc.",
  destinationCountry: "US",
  currency: "USD",
  amountMinor: 42_500,
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountType: "checking",
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

async function setup(apiKey = FAKE_KEY) {
  const fake = createFakeCxc();
  const client = new CashXChainClient({ apiKey, baseUrl: await listen(fake.app) });
  const ledger = new ReadinessLedger();
  const report = (invoice: Invoice, key = "k1") => buildCxcReadinessReport(invoice, key, ledger, opts, client);
  return { fake, client, ledger, report };
}

const check = (r: ReadinessReport, id: string) => r.checks.find(c => c.id === id);
const sources = (r: ReadinessReport) => Object.fromEntries(r.checks.map(c => [c.id, c.source]));
const FIXTURE_DISCLAIMER = buildReadinessReport(sepa, "fixture", new ReadinessLedger(), opts).disclaimer;

describe("readiness from the CashXChain sandbox", () => {
  it("SEPA invoice: corridor, fields and quote from CashXChain; read-only calls only", async () => {
    const s = await setup();
    const r = await s.report(sepa);

    expect(r.verdict).toBe("ready_for_review");
    expect(r.source).toBe("cxc-sandbox");
    expect(sources(r)).toEqual({
      corridor: "cxc-sandbox",
      required_fields: "cxc-sandbox",
      account: "deterministic",
      duplicate: "deterministic",
      amount: "deterministic",
    });
    expect(check(r, "corridor")).toMatchObject({ status: "pass", message: "DE/EUR via sepa, sepa_instant" });
    expect(check(r, "required_fields")).toMatchObject({ status: "pass", message: "Present: iban" });
    expect(r.cxcQuote).toEqual({
      source: "cxc-sandbox",
      label: "CashXChain sandbox quote",
      rails: ["sepa", "sepa_instant"],
      payoutCurrency: "EUR",
      payoutAmount: "624.00",
      sourceCurrency: "EUR",
      sourceAmount: "629.00",
      fee: "5.00",
      rate: "1",
    });
    expect(r.routeQuote).toBeUndefined();
    expect(r.payoutExecuted).toBe(false);
    expect(r.disclaimer).toContain("CashXChain sandbox");
    expect(r.disclaimer).not.toContain("simulated");

    expect(s.fake.state.seen.map(c => `${c.method} ${c.path}`).sort()).toEqual([
      "GET /v1/banking/accounts",
      "GET /v1/banking/corridors?currency=EUR&country=DE&entity_type=business",
      "POST /v1/banking/payouts/quote",
    ]);
    // Priced without registering a beneficiary.
    expect(s.fake.state.seen.find(c => c.path === "/v1/banking/payouts/quote")?.body).toEqual({
      source_account_id: "mockacct_fake_eur",
      amount: "624.00",
      currency: "EUR",
    });
  });

  it("US invoice with account_type: quoted cross-currency from the EUR account", async () => {
    const s = await setup();
    const r = await s.report(us);

    expect(r.verdict).toBe("ready_for_review");
    expect(check(r, "corridor")?.message).toBe("US/USD via ach, fedwire");
    expect(check(r, "required_fields")).toMatchObject({ status: "pass", message: "Present: us_routing, account_type" });
    expect(r.cxcQuote).toMatchObject({ rails: ["ach", "fedwire"], payoutCurrency: "USD", payoutAmount: "425.00", sourceCurrency: "EUR", rate: "1.25" });
  });

  it("missing account_type for USD/US -> required_fields fail -> needs_info", async () => {
    const s = await setup();
    const { accountType: _, ...noType } = us;
    const r = await s.report(noType);

    expect(r.verdict).toBe("needs_info");
    expect(check(r, "required_fields")).toEqual({
      id: "required_fields",
      status: "fail",
      message: "Missing: account_type (Account type)",
      source: "cxc-sandbox",
    });
    expect(r.cxcQuote?.source).toBe("cxc-sandbox");
  });

  it("no account details in a scheme the corridor accepts -> required_fields fail naming the schemes", async () => {
    const s = await setup();
    const { accountNumber: _, ...routingOnly } = us;
    const r = await s.report(routingOnly);

    expect(r.verdict).toBe("needs_info");
    expect(check(r, "required_fields")).toMatchObject({
      status: "fail",
      message: "USD/US takes us_routing; the invoice has no matching account details",
      source: "cxc-sandbox",
    });
  });

  it("corridor_unsupported -> corridor fail -> blocked, even where the demo fixture has a corridor", async () => {
    const s = await setup();
    // CH/CHF is in the demo corridor table; the CashXChain sandbox does not offer it.
    const r = await s.report({ ...sepa, destinationCountry: "CH", currency: "CHF", iban: "CH9300762011623852957", bic: undefined });

    expect(check(r, "account")?.status).toBe("pass");
    expect(r.verdict).toBe("blocked");
    expect(r.source).toBe("cxc-sandbox");
    expect(check(r, "corridor")).toEqual({
      id: "corridor",
      status: "fail",
      message: "No CashXChain corridor for CH/CHF (corridor_unsupported)",
      source: "cxc-sandbox",
    });
    expect(check(r, "required_fields")).toMatchObject({ status: "skip", source: "cxc-sandbox" });
    expect(r.cxcQuote).toBeUndefined();
    expect(r.routeQuote).toBeUndefined();
  });

  it("corridor from CashXChain but no active account: demo-fixture quote, labeled as such", async () => {
    const s = await setup();
    s.fake.state.accounts = [];
    const r = await s.report(sepa);

    expect(r.verdict).toBe("ready_for_review");
    expect(r.source).toBe("cxc-sandbox");
    expect(check(r, "corridor")?.source).toBe("cxc-sandbox");
    expect(r.cxcQuote).toBeUndefined();
    expect(r.routeQuote).toMatchObject({ source: "demo-fixture", label: "Simulated route/fees" });
    expect(r.disclaimer).toContain("route and fees are simulated");
    expect(s.fake.state.seen.some(c => c.path === "/v1/banking/payouts/quote")).toBe(false);
  });
});

describe("CashXChain unavailable -> demo-fixture fallback", () => {
  const outages: Array<{ name: string; start: () => Promise<{ client: CashXChainClient }> }> = [
    {
      name: "503 on every call",
      start: async () => {
        const s = await setup();
        s.fake.state.down = { status: 503, error: "service_unavailable", message: "maintenance" };
        return s;
      },
    },
    { name: "401 (bad key)", start: () => setup("cxc_sk_sandbox_wrongKey") },
    {
      name: "network error",
      start: async () => {
        const app = express();
        const url = await listen(app);
        await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
        return { client: new CashXChainClient({ apiKey: FAKE_KEY, baseUrl: url }) };
      },
    },
  ];

  it.each(outages)("$name: report as without CashXChain", async ({ start }) => {
    const { client } = await start();
    const r = await buildCxcReadinessReport(sepa, "k1", new ReadinessLedger(), opts, client);
    const plain = buildReadinessReport(sepa, "k1", new ReadinessLedger(), opts);

    expect(r).toEqual({ ...plain, generatedAt: r.generatedAt });
    expect(r.source).toBe("demo-fixture");
    expect(check(r, "corridor")?.source).toBe("demo-fixture");
    expect(r.routeQuote?.source).toBe("demo-fixture");
    expect(r.cxcQuote).toBeUndefined();
    expect(r.disclaimer).toBe(FIXTURE_DISCLAIMER);
  });
});

describe("idempotency with CashXChain", () => {
  it("same Idempotency-Key: identical cached report, one set of CashXChain calls", async () => {
    const s = await setup();
    const first = await s.report(sepa, "k1");
    const calls = s.fake.state.seen.length;
    expect(calls).toBe(3);

    expect(await s.report(sepa, "k1")).toBe(first);
    expect(s.fake.state.seen).toHaveLength(calls);
  });

  it("same key while the first build is still running joins it", async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.report(sepa, "k1"), s.report(sepa, "k1")]);

    expect(b).toBe(a);
    expect(a.checks.find(c => c.id === "duplicate")?.status).toBe("pass");
    expect(s.fake.state.seen).toHaveLength(3);
  });

  it("a new key for the same invoice is a duplicate -> blocked", async () => {
    const s = await setup();
    await s.report(sepa, "k1");
    const dup = await s.report(sepa, "k2");

    expect(dup.verdict).toBe("blocked");
    expect(check(dup, "duplicate")?.status).toBe("fail");
  });

  it("concurrent keys for the same invoice: the first to arrive passes, the other is the duplicate", async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.report(sepa, "k1"), s.report(sepa, "k2")]);

    expect(check(a, "duplicate")?.status).toBe("pass");
    expect(check(b, "duplicate")?.status).toBe("fail");
    expect(b.verdict).toBe("blocked");
  });
});
