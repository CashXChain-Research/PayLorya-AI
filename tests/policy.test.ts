import { describe, expect, it } from "vitest";
import type { PaymentRequirements } from "@x402/core/types";
import { filterOffers, PayoutLedger, precheck, SpendLedger, type SpendPolicy } from "../src/policy.js";

const policy: SpendPolicy = {
  allowedPayTo: ["addr_test1seller"],
  maxPriceLovelace: 3_000_000n,
  sessionBudgetLovelace: 5_000_000n,
  maxPaymentsPerRun: 1,
};

const offer = (o: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "cardano:preprod",
  asset: "lovelace",
  amount: "2000000",
  payTo: "addr_test1seller",
  maxTimeoutSeconds: 600,
  extra: {},
  ...o,
});

describe("x402 offer filter", () => {
  it("keeps only allowlisted, capped preprod lovelace offers", () => {
    expect(filterOffers([offer()], policy)).toHaveLength(1);
    expect(filterOffers([offer({ payTo: "addr_test1attacker" })], policy)).toHaveLength(0);
    expect(filterOffers([offer({ amount: "3000001" })], policy)).toHaveLength(0);
    expect(filterOffers([offer({ network: "cardano:mainnet" })], policy)).toHaveLength(0);
    expect(filterOffers([offer({ asset: "c48c.0014df105553444d" })], policy)).toHaveLength(0);
    expect(filterOffers([offer({ extra: { assetTransferMethod: "default" } })], policy)).toHaveLength(1);
    expect(filterOffers([offer({ extra: { assetTransferMethod: "script" } })], policy)).toHaveLength(0);
    expect(filterOffers([offer({ extra: { assetTransferMethod: "masumi" } })], policy)).toHaveLength(0);
  });
});

describe("payout ledger", () => {
  const limits = { maxLovelace: 5_000_000n, budgetLovelace: 8_000_000n };

  it("pays an invoice at most once; refused releases, unknown locks", () => {
    const l = new PayoutLedger(limits);
    expect(l.reserve("a", "EUR", 1_248_000).ok).toBe(true);
    expect(l.reserve("a", "EUR", 1_248_000)).toMatchObject({ ok: false, reason: expect.stringContaining("in progress") });
    l.release("a");
    expect(l.reserve("a", "EUR", 1_248_000).ok).toBe(true);
    l.markPaid("a");
    expect(l.reserve("a", "EUR", 1_248_000)).toMatchObject({ ok: false, reason: expect.stringContaining("already paid out") });

    expect(l.reserve("b", "EUR", 100).ok).toBe(true);
    l.markUnknown("b");
    expect(l.reserve("b", "EUR", 100)).toMatchObject({ ok: false, reason: expect.stringContaining("unknown outcome") });
  });

  it("caps ADA payouts per invoice and per session; fiat is not counted", () => {
    const l = new PayoutLedger(limits);
    expect(l.reserve("big", "ADA", 5_000_001)).toMatchObject({ ok: false, reason: expect.stringContaining("cap") });
    expect(l.reserve("x", "ADA", 4_500_000).ok).toBe(true);
    expect(l.reserve("y", "ADA", 4_000_000)).toMatchObject({ ok: false, reason: expect.stringContaining("budget") });
    expect(l.reserve("fiat", "EUR", 99_999_999).ok).toBe(true);
    l.markUnknown("x");
    expect(l.spentLovelace).toBe(4_500_000n);
    expect(l.reserve("z", "ADA", 3_500_000).ok).toBe(true);
    expect(l.reserve("w", "ADA", 1)).toMatchObject({ ok: false, reason: expect.stringContaining("budget") });
  });
});

describe("precheck", () => {
  const base = { id: "I-1", supplier: "S", destinationCountry: "DE", currency: "ADA", amountMinor: 1 };

  it("accepts a Cardano address as the account identifier", () => {
    expect(precheck(base).ok).toBe(false);
    expect(precheck({ ...base, cardanoAddress: "addr_test1..." }).ok).toBe(true);
  });
});

describe("spend ledger", () => {
  it("refuses to pay twice for the same invoice", () => {
    const l = new SpendLedger(policy);
    l.markPaid("inv", 2_000_000n);
    expect(l.canPay("inv", 2_000_000n).ok).toBe(false);
  });

  it("locks an invoice with unknown settlement and counts it against budget", () => {
    const l = new SpendLedger(policy);
    l.markUnknown("inv", 2_000_000n);
    expect(l.canPay("inv", 2_000_000n)).toMatchObject({ ok: false });
    expect(l.canPay("other", 2_000_000n).ok).toBe(true);
    expect(l.canPay("other", 4_000_000n).ok).toBe(false);
  });

  it("holds an in-flight payment against invoice and budget until marked or released", () => {
    const l = new SpendLedger(policy);
    expect(l.reserve("inv", 2_000_000n).ok).toBe(true);
    expect(l.reserve("inv", 2_000_000n)).toMatchObject({ ok: false });
    expect(l.canPay("other", 4_000_000n).ok).toBe(false);
    l.release("inv");
    expect(l.reserve("inv", 2_000_000n).ok).toBe(true);
    l.markPaid("inv", 2_000_000n);
    expect(l.spentLovelace).toBe(2_000_000n);
    expect(l.canPay("other", 3_000_000n).ok).toBe(true);
  });
});
