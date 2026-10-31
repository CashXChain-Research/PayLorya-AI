import type { PaymentRequirements } from "@x402/core/types";
import { CARDANO_NETWORK } from "./config.js";
import type { Invoice } from "./types.js";

/**
 * Deterministic spend policy for the buyer agent. Nothing in here is derived from model
 * output: network, asset, recipient and caps come from operator config only.
 */
export interface SpendPolicy {
  allowedPayTo: string[];
  maxPriceLovelace: bigint;
  sessionBudgetLovelace: bigint;
  maxPaymentsPerRun: number;
}

/** x402 offer filter: keep only offers we are willing to sign. */
export function filterOffers(reqs: PaymentRequirements[], policy: SpendPolicy): PaymentRequirements[] {
  return reqs.filter(
    r =>
      r.scheme === "exact" &&
      r.network === CARDANO_NETWORK &&
      r.asset === "lovelace" &&
      // Plain transfer only: masumi/script methods lock funds in a contract instead of paying payTo.
      (r.extra?.assetTransferMethod ?? "default") === "default" &&
      policy.allowedPayTo.includes(r.payTo) &&
      /^\d+$/.test(r.amount) &&
      BigInt(r.amount) <= policy.maxPriceLovelace,
  );
}

/** Session-level budget and per-invoice payment locks (prevents paying twice). */
export class SpendLedger {
  private spent = 0n;
  private paidFingerprints = new Set<string>();
  private unknownFingerprints = new Set<string>();
  // Payment being signed or in flight: locks the invoice and holds budget until marked.
  private pending = new Map<string, bigint>();

  constructor(private readonly policy: SpendPolicy) {}

  canPay(fingerprint: string, amount: bigint): { ok: true } | { ok: false; reason: string } {
    if (this.unknownFingerprints.has(fingerprint)) {
      return { ok: false, reason: "previous payment for this invoice has unknown settlement; resolve before paying again" };
    }
    if (this.paidFingerprints.has(fingerprint)) return { ok: false, reason: "report for this invoice already paid" };
    if (this.pending.has(fingerprint)) return { ok: false, reason: "payment for this invoice already in progress" };
    const held = [...this.pending.values()].reduce((sum, a) => sum + a, this.spent);
    if (held + amount > this.policy.sessionBudgetLovelace) return { ok: false, reason: "session budget exhausted" };
    return { ok: true };
  }

  /** canPay plus a hold in the same tick, so concurrent runs cannot both pass the checks. */
  reserve(fingerprint: string, amount: bigint): { ok: true } | { ok: false; reason: string } {
    const allowed = this.canPay(fingerprint, amount);
    if (allowed.ok) this.pending.set(fingerprint, amount);
    return allowed;
  }

  /** Only for a hold whose payment never left the buyer (signing failed). */
  release(fingerprint: string): void {
    this.pending.delete(fingerprint);
  }

  markPaid(fingerprint: string, amount: bigint): void {
    this.pending.delete(fingerprint);
    this.spent += amount;
    this.unknownFingerprints.delete(fingerprint);
    this.paidFingerprints.add(fingerprint);
  }

  markUnknown(fingerprint: string, amount: bigint): void {
    // Count it against the budget until proven otherwise.
    this.pending.delete(fingerprint);
    this.spent += amount;
    this.unknownFingerprints.add(fingerprint);
  }

  get spentLovelace(): bigint {
    return this.spent;
  }
}

/**
 * Invoice payouts after approval: at most one per invoice, ever. ADA payouts spend the buyer
 * wallet, so they are capped per payout and per session (fiat runs on the CashXChain sandbox).
 */
export class PayoutLedger {
  private paid = new Set<string>();
  private unknown = new Set<string>();
  // In flight: fingerprint -> lovelace held (0n for fiat).
  private pending = new Map<string, bigint>();
  private spent = 0n;

  constructor(private readonly limits: { maxLovelace: bigint; budgetLovelace: bigint }) {}

  reserve(fingerprint: string, currency: string, amountMinor: number): { ok: true } | { ok: false; reason: string } {
    if (this.unknown.has(fingerprint)) {
      return { ok: false, reason: "an earlier payout for this invoice has an unknown outcome; check its reference before paying again" };
    }
    if (this.paid.has(fingerprint)) return { ok: false, reason: "this invoice is already paid out" };
    if (this.pending.has(fingerprint)) return { ok: false, reason: "a payout for this invoice is already in progress" };
    let lovelace = 0n;
    if (currency === "ADA") {
      lovelace = BigInt(amountMinor);
      if (lovelace > this.limits.maxLovelace) return { ok: false, reason: "amount is above the ADA payout cap" };
      const held = [...this.pending.values()].reduce((sum, a) => sum + a, this.spent);
      if (held + lovelace > this.limits.budgetLovelace) return { ok: false, reason: "ADA payout budget exhausted" };
    }
    this.pending.set(fingerprint, lovelace);
    return { ok: true };
  }

  /** Nothing was sent: the invoice may be approved again. */
  release(fingerprint: string): void {
    this.pending.delete(fingerprint);
  }

  markPaid(fingerprint: string): void {
    this.spent += this.pending.get(fingerprint) ?? 0n;
    this.pending.delete(fingerprint);
    this.paid.add(fingerprint);
  }

  /** May have been sent: counts against the budget and locks the invoice. */
  markUnknown(fingerprint: string): void {
    this.spent += this.pending.get(fingerprint) ?? 0n;
    this.pending.delete(fingerprint);
    this.unknown.add(fingerprint);
  }

  get spentLovelace(): bigint {
    return this.spent;
  }
}

/** Cheap local checks before spending anything on the paid report. */
export function precheck(invoice: Invoice): { ok: true } | { ok: false; reason: string } {
  if (!invoice.iban && !invoice.routingNumber && !invoice.cardanoAddress) {
    return { ok: false, reason: "no account identifier (IBAN, routing number or Cardano address) extracted" };
  }
  return { ok: true };
}
