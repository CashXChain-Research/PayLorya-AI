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
      reference: "R-99", iban: "de89 3704 0044 0532 0130 00", bic: null, routingNumber: null, accountNumber: null, accountType: null,
    });
    expect(inv.destinationCountry).toBe("DE");
    expect(inv.iban).toBe("DE89370400440532013000");
    expect(() =>
      toInvoice({ invoiceId: null, supplierName: "x", destinationCountry: "DE", currency: "EUR", amount: "1", reference: null, iban: null, bic: null, routingNumber: null, accountNumber: null, accountType: null }),
    ).toThrow();
  });

  it("keeps a printed US account type and drops anything else", () => {
    const base = {
      invoiceId: "A-5531", supplierName: "Lakeside Robotics Inc.", destinationCountry: "US", currency: "USD", amount: "4,250.00",
      reference: null, iban: null, bic: null, routingNumber: "021000021", accountNumber: "000123456789",
    };
    expect(toInvoice({ ...base, accountType: " Checking " }).accountType).toBe("checking");
    expect(toInvoice({ ...base, accountType: "brokerage" }).accountType).toBeUndefined();
    expect(toInvoice({ ...base, accountType: null }).accountType).toBeUndefined();
  });
});
