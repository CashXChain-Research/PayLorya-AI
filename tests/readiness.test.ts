import { describe, expect, it } from "vitest";
import { parseAmountMinor, toInvoice } from "../src/extract.js";
import { buildReadinessReport, ReadinessLedger, validateAbaRouting, validateBic, validateIban } from "../src/readiness.js";
import type { Invoice } from "../src/types.js";

const opts = { amountCeilingMinor: 5_000_000 };
const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 1_248_000,
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};

describe("account validation", () => {
  it("accepts a valid IBAN and rejects a bad checksum", () => {
    expect(validateIban("DE89 3704 0044 0532 0130 00").ok).toBe(true);
    expect(validateIban("DE89 3704 0044 0532 0130 01")).toEqual({ ok: false, reason: "IBAN checksum (mod-97) failed" });
    expect(validateIban("DE8937040044053201300").ok).toBe(false);
  });
  it("checks ABA routing numbers", () => {
    expect(validateAbaRouting("021000021")).toBe(true);
    expect(validateAbaRouting("021000022")).toBe(false);
  });
  it("checks BIC format and country", () => {
    expect(validateBic("COBADEFFXXX", "DE").ok).toBe(true);
    expect(validateBic("COBADEFFXXX", "FR").ok).toBe(false);
  });
});

describe("readiness report", () => {
  it("is ready_for_review for a clean SEPA invoice", () => {
    const r = buildReadinessReport(sepa, "k1", new ReadinessLedger(), opts);
    expect(r.verdict).toBe("ready_for_review");
    expect(r.payoutExecuted).toBe(false);
    expect(r.routeQuote?.source).toBe("demo-fixture");
  });

  it("returns the cached report for the same idempotency key", () => {
    const ledger = new ReadinessLedger();
    const a = buildReadinessReport(sepa, "k1", ledger, opts);
    const b = buildReadinessReport(sepa, "k1", ledger, opts);
    expect(b).toBe(a);
  });

  it("blocks a duplicate under a different key", () => {
    const ledger = new ReadinessLedger();
    buildReadinessReport(sepa, "k1", ledger, opts);
    const dup = buildReadinessReport(sepa, "k2", ledger, opts);
    expect(dup.verdict).toBe("blocked");
    expect(dup.checks.find(c => c.id === "duplicate")?.status).toBe("fail");
  });

  it("needs info on a bad IBAN, blocks unknown corridors", () => {
    const bad = buildReadinessReport({ ...sepa, iban: "DE89370400440532013001" }, "k", new ReadinessLedger(), opts);
    expect(bad.verdict).toBe("needs_info");
    const nowhere = buildReadinessReport({ ...sepa, destinationCountry: "BR", currency: "USD" }, "k", new ReadinessLedger(), opts);
    expect(nowhere.verdict).toBe("blocked");
  });

  it("requires routing + account number for US", () => {
    const us: Invoice = { id: "A-1", supplier: "Lakeside", destinationCountry: "US", currency: "USD", amountMinor: 425_000, routingNumber: "021000021" };
    expect(buildReadinessReport(us, "k", new ReadinessLedger(), opts).verdict).toBe("needs_info");
    expect(buildReadinessReport({ ...us, accountNumber: "000123456789" }, "k", new ReadinessLedger(), opts).verdict).toBe("ready_for_review");
  });
});

describe("extraction normalization", () => {
  it("parses amounts deterministically", () => {
    expect(parseAmountMinor("12,480.00", "EUR")).toBe(1_248_000);
    expect(parseAmountMinor("12.480,00", "EUR")).toBe(1_248_000);
    expect(parseAmountMinor("980,00", "EUR")).toBe(98_000);
    expect(parseAmountMinor("4250", "USD")).toBe(425_000);
    expect(parseAmountMinor("1,000", "JPY")).toBe(1_000);
  });

  it("derives country from IBAN and rejects incomplete extractions", () => {
    const inv = toInvoice({
      invoiceId: "R-99", supplierName: "Studio Nord GmbH", destinationCountry: null, currency: "eur", amount: "980,00",
      reference: "R-99", iban: "de89 3704 0044 0532 0130 00", bic: null, routingNumber: null, accountNumber: null, cardanoAddress: null,
    });
    expect(inv.destinationCountry).toBe("DE");
    expect(inv.iban).toBe("DE89370400440532013000");
    expect(() =>
      toInvoice({ invoiceId: null, supplierName: "x", destinationCountry: "DE", currency: "EUR", amount: "1", reference: null, iban: null, bic: null, routingNumber: null, accountNumber: null, cardanoAddress: null }),
    ).toThrow();
  });
});

describe("report cross-checks", () => {
  const WALLET = "addr_test1qrh6ayyhzdj2q464ayvyft9awz46ne46hyzwmjsq6s2frflw7j6laqexupvgqym3smjccxmwu6fc3tyu07kffmh4fkyscvyuvz";
  const report = (inv: Invoice) => buildReadinessReport(inv, "x", new ReadinessLedger(), opts);
  const check = (r: ReturnType<typeof report>, id: string) => r.checks.find(c => c.id === id);

  it("names a currency mismatch on a served country, and keeps unserved countries apart", () => {
    const mismatch = report({ ...sepa, currency: "USD" });
    expect(mismatch.verdict).toBe("blocked");
    expect(check(mismatch, "corridor")?.message).toBe("No demo corridor for DE/USD: currency mismatch, the DE corridor pays EUR");
    const unserved = report({ ...sepa, destinationCountry: "PL", currency: "PLN", iban: "PL61109010140000071219812874", bic: undefined });
    expect(unserved.verdict).toBe("blocked");
    expect(check(unserved, "corridor")?.message).toBe("No demo corridor for PL/PLN");
  });

  it("does not block an ADA invoice from a country whose fiat corridor pays another currency", () => {
    const ada: Invoice = { id: "NNS-1", supplier: "Nordwind Node Services OÜ", destinationCountry: "DE", currency: "ADA", amountMinor: 3_500_000, cardanoAddress: WALLET };
    const r = report(ada);
    expect(check(r, "corridor")?.status).toBe("pass");
    expect(r.verdict).toBe("ready_for_review");
  });

  it("reports the payment reference without changing the verdict", () => {
    expect(check(report({ ...sepa, reference: "PO-7781" }), "reference")).toMatchObject({ status: "pass", message: "Payment reference present", source: "deterministic" });
    for (const reference of [undefined, "  "]) {
      const r = report({ ...sepa, reference });
      expect(check(r, "reference")).toMatchObject({ status: "pass", message: "No separate payment reference: reconcile by invoice id" });
      expect(r.verdict).toBe("ready_for_review");
    }
  });

  // Already enforced by the account check: the IBAN must match the destination, and the BIC must match it too.
  it("flags BIC and IBAN countries that disagree", () => {
    const bic = report({ ...sepa, bic: "BNPAFRPPXXX" });
    expect(check(bic, "account")).toMatchObject({ status: "fail", message: "BIC country FR != DE" });
    expect(bic.verdict).toBe("needs_info");
    const iban = report({ ...sepa, destinationCountry: "FR" });
    expect(check(iban, "account")).toMatchObject({ status: "warn", message: "IBAN country differs from destination country" });
    expect(iban.verdict).toBe("needs_info");
  });
});
