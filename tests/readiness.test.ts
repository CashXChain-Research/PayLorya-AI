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
      reference: "R-99", iban: "de89 3704 0044 0532 0130 00", bic: null, routingNumber: null, accountNumber: null,
    });
    expect(inv.destinationCountry).toBe("DE");
    expect(inv.iban).toBe("DE89370400440532013000");
    expect(() =>
      toInvoice({ invoiceId: null, supplierName: "x", destinationCountry: "DE", currency: "EUR", amount: "1", reference: null, iban: null, bic: null, routingNumber: null, accountNumber: null }),
    ).toThrow();
  });
});


describe("deterministic report cross-checks", () => {
  const report = (overrides: Partial<Invoice>) => buildReadinessReport({ ...sepa, reference: "PO-7781", ...overrides }, "cross-check", new ReadinessLedger(), opts);

  it("fails IBAN/destination disagreement and requests correction", () => {
    const r = report({ destinationCountry: "FR" });
    expect(r.checks.find(c => c.id === "iban_country")).toMatchObject({ status: "fail", source: "deterministic", message: "IBAN country DE; destination FR" });
    expect(r.verdict).toBe("needs_info");
  });

  it("warns on BIC/IBAN country disagreement while retaining valid IBAN status", () => {
    const r = report({ bic: "BNPAFRPPXXX" });
    expect(r.checks.find(c => c.id === "bic_country")).toMatchObject({ status: "warn", source: "deterministic" });
    expect(r.checks.find(c => c.id === "account")?.status).toBe("pass");
    expect(r.verdict).toBe("needs_info");
  });

  it("still fails malformed BICs", () => {
    expect(report({ bic: "not-a-bic" }).checks.find(c => c.id === "account")?.status).toBe("fail");
  });

  it("explains a known country's currency mismatch and blocks it", () => {
    const r = report({ currency: "USD" });
    expect(r.checks.find(c => c.id === "currency")).toMatchObject({ status: "fail", source: "deterministic" });
    expect(r.checks.find(c => c.id === "corridor")?.message).toContain("USD does not match demo corridor currency for DE: EUR");
    expect(r.verdict).toBe("blocked");
  });

  it("keeps an unknown corridor distinct from currency disagreement", () => {
    const r = report({ destinationCountry: "PL", currency: "PLN" });
    expect(r.checks.find(c => c.id === "currency")?.status).toBe("skip");
    expect(r.checks.find(c => c.id === "corridor")?.message).toBe("No demo corridor for PL/PLN");
    expect(r.verdict).toBe("blocked");
  });

  it.each([undefined, "   "])("warns about missing references without preventing a human-review draft", reference => {
    const r = report({ reference });
    expect(r.checks.find(c => c.id === "reference")).toMatchObject({ status: "warn", source: "deterministic" });
    expect(r.checks.find(c => c.id === "reference")?.message).toContain("reconciliation risk");
    expect(r.verdict).toBe("ready_for_review");
  });

  it("passes matching countries/currency/reference and skips unavailable comparisons", () => {
    const r = report({});
    for (const id of ["iban_country", "bic_country", "currency", "reference"]) {
      expect(r.checks.find(c => c.id === id)).toMatchObject({ status: "pass", source: "deterministic" });
    }
    const us = report({ destinationCountry: "US", currency: "USD", iban: undefined, bic: undefined, routingNumber: "021000021", accountNumber: "12345678" });
    expect(us.checks.find(c => c.id === "iban_country")?.status).toBe("skip");
    expect(us.checks.find(c => c.id === "bic_country")?.status).toBe("skip");
    expect(us.verdict).toBe("ready_for_review");
  });
});
