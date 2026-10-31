import { describe, expect, it } from "vitest";
import { parseAmountMinor, toInvoice } from "../src/extract.js";
import { precheck } from "../src/policy.js";
import { buildReadinessReport, ReadinessLedger, validateCardanoAddress } from "../src/readiness.js";
import { CRYPTO_PAYEE, decideRoute, findPayee, payeeDirectory } from "../src/routing.js";
import type { Invoice } from "../src/types.js";

const WALLET = "addr_test1qrh6ayyhzdj2q464ayvyft9awz46ne46hyzwmjsq6s2frflw7j6laqexupvgqym3smjccxmwu6fc3tyu07kffmh4fkyscvyuvz";
const OTHER = "addr_test1qrpz79mnach4j9e8g4cwg9gdtqtmcvdps8ess7tn0p6zjnw7x56p9fpsf5erudw33l64y8ul40f03rgfvv5658dgvrqstj4mdu";
const directory = payeeDirectory(WALLET);
const limits = { payoutMaxLovelace: 10_000_000n };

const sepa: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 1_248_000,
  iban: "DE89370400440532013000",
};
const ada: Invoice = { id: "NNS-2026-118", supplier: CRYPTO_PAYEE, destinationCountry: "EE", currency: "ADA", amountMinor: 3_500_000, cardanoAddress: WALLET };

describe("verified payee directory", () => {
  it("matches extracted names with legal forms, cities and diacritics", () => {
    expect(findPayee(directory, "Brenner Maschinenbau GmbH, Augsburg")?.name).toBe("Brenner Maschinenbau GmbH");
    expect(findPayee(directory, "Lakeside Robotics Inc. (Austin, TX)")?.name).toBe("Lakeside Robotics Inc.");
    // The CashXChain US corridor requires an account type for ACH payouts.
    expect(findPayee(directory, "Lakeside Robotics Inc.")?.accountType).toBe("checking");
    expect(findPayee(directory, "Nordwind Node Services OU")?.name).toBe(CRYPTO_PAYEE);
    expect(findPayee(directory, "Studio Nord GmbH")).toBeUndefined();
  });
});

describe("route decision", () => {
  it("fiat: selects CashXChain with the directory account", () => {
    const r = decideRoute(sepa, directory, limits);
    expect(r).toMatchObject({ status: "selected", rail: "cxc_fiat", payee: "Brenner Maschinenbau GmbH", destination: "DE89370400440532013000" });
    expect(r.checks.every(c => c.status === "pass")).toBe(true);
  });

  it("fiat: different bank details for a known payee are blocked", () => {
    const r = decideRoute({ ...sepa, iban: "GB82WEST12345698765432" }, directory, limits);
    expect(r).toMatchObject({ status: "blocked", rail: "cxc_fiat" });
    expect(r.destination).toBeUndefined();
  });

  it("fiat: above the per-payout cap the draft stays for manual handling (unavailable, not blocked)", () => {
    const capped = { ...limits, fiatMaxMinor: 100_000 };
    expect(decideRoute({ ...sepa, amountMinor: 100_000 }, directory, capped)).toMatchObject({ status: "selected" });
    const over = decideRoute({ ...sepa, amountMinor: 100_001 }, directory, capped);
    expect(over).toMatchObject({ status: "unavailable", rail: "cxc_fiat", reason: "Amount above the fiat payout cap of 1000.00 EUR: pay by hand" });
    expect(over.destination).toBeUndefined();
    // Bank-detail mismatches stay blocked even above the cap: fraud signals win.
    expect(decideRoute({ ...sepa, amountMinor: 100_001, iban: "GB82WEST12345698765432" }, directory, capped).status).toBe("blocked");
  });

  it("fiat: US payee needs routing and account to match", () => {
    const us: Invoice = { id: "A-5531", supplier: "Lakeside Robotics Inc.", destinationCountry: "US", currency: "USD", amountMinor: 425_000, routingNumber: "021000021", accountNumber: "000123456789" };
    expect(decideRoute(us, directory, limits)).toMatchObject({ status: "selected", destination: "ABA 021000021 / 000123456789" });
    expect(decideRoute({ ...us, accountNumber: "999" }, directory, limits).status).toBe("blocked");
  });

  it("fiat: an unverified wallet on the invoice is ignored and flagged, never used", () => {
    const r = decideRoute({ ...sepa, cardanoAddress: OTHER }, directory, limits);
    expect(r).toMatchObject({ status: "selected", rail: "cxc_fiat", destination: sepa.iban });
    expect(r.checks.find(c => c.id === "wallet")?.status).toBe("warn");
    expect(JSON.stringify(r)).not.toContain(OTHER);
  });

  it("unknown payee: unavailable, no destination", () => {
    const r = decideRoute({ ...sepa, supplier: "Unverified Trading GmbH" }, directory, limits);
    expect(r).toMatchObject({ status: "unavailable" });
    expect(r.rail).toBeUndefined();
  });

  it("crypto: selects Cardano Preprod only for the verified wallet", () => {
    expect(decideRoute(ada, directory, limits)).toMatchObject({ status: "selected", rail: "cardano_preprod", destination: WALLET });
    const swapped = decideRoute({ ...ada, cardanoAddress: OTHER }, directory, limits);
    expect(swapped).toMatchObject({ status: "blocked", rail: "cardano_preprod" });
    expect(swapped.reason).toContain("possible invoice redirection");
  });

  it("crypto: no wallet configured -> unavailable; amount outside the limits -> blocked", () => {
    expect(decideRoute(ada, payeeDirectory(undefined), limits)).toMatchObject({ status: "unavailable", rail: "cardano_preprod" });
    expect(decideRoute({ ...ada, amountMinor: 10_000_001 }, directory, limits).status).toBe("blocked");
    expect(decideRoute({ ...ada, amountMinor: 999_999 }, directory, limits).status).toBe("blocked");
    expect(decideRoute({ ...ada, amountMinor: 10_000_000 }, directory, limits).status).toBe("selected");
  });
});

describe("ADA invoices in extraction and readiness", () => {
  it("parses ADA amounts into lovelace without breaking fiat thousands", () => {
    expect(parseAmountMinor("3.50", "ADA")).toBe(3_500_000);
    expect(parseAmountMinor("3,5", "ADA")).toBe(3_500_000);
    expect(parseAmountMinor("1.234.567", "ADA")).toBe(1_234_567_000_000);
    expect(parseAmountMinor("12,480", "EUR")).toBe(1_248_000);
    expect(parseAmountMinor("980,0", "EUR")).toBe(98_000);
  });

  it("maps tADA to ADA and keeps the wallet as invoice data", () => {
    const inv = toInvoice({
      invoiceId: "NNS-2026-118", supplierName: CRYPTO_PAYEE, destinationCountry: "EE", currency: "tADA", amount: "3.50",
      reference: null, iban: null, bic: null, routingNumber: null, accountNumber: null, cardanoAddress: WALLET,
    });
    expect(inv).toMatchObject({ currency: "ADA", amountMinor: 3_500_000, cardanoAddress: WALLET });
  });

  it("validates Cardano addresses (prefix, bech32 checksum)", () => {
    expect(validateCardanoAddress(WALLET).ok).toBe(true);
    expect(validateCardanoAddress(WALLET.slice(0, -1) + "q").ok).toBe(false);
    expect(validateCardanoAddress("addr1qx" + WALLET.slice(11)).ok).toBe(false);
  });

  it("readiness: ADA invoice with a valid wallet is ready; a bad wallet needs info; none fails precheck", () => {
    const opts = { amountCeilingMinor: 5_000_000 };
    const r = buildReadinessReport(ada, "k", new ReadinessLedger(), opts);
    expect(r.verdict).toBe("ready_for_review");
    expect(r.routeQuote?.rail).toBe("Cardano Preprod transfer (testnet)");
    const bad = buildReadinessReport({ ...ada, cardanoAddress: WALLET.slice(0, -1) + "q" }, "k", new ReadinessLedger(), opts);
    expect(bad.verdict).toBe("needs_info");
    expect(precheck({ ...ada, cardanoAddress: undefined }).ok).toBe(false);
    expect(precheck({ ...ada, iban: "DE89370400440532013000", cardanoAddress: undefined }).ok).toBe(false);
  });
});
