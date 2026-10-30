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

  constructor(private readonly policy: SpendPolicy) {}

  canPay(fingerprint: string, amount: bigint): { ok: true } | { ok: false; reason: string } {
    if (this.unknownFingerprints.has(fingerprint)) {
      return { ok: false, reason: "previous payment for this invoice has unknown settlement; resolve before paying again" };
    }
    if (this.paidFingerprints.has(fingerprint)) return { ok: false, reason: "report for this invoice already paid" };
    if (this.spent + amount > this.policy.sessionBudgetLovelace) return { ok: false, reason: "session budget exhausted" };
    return { ok: true };
  }

  markPaid(fingerprint: string, amount: bigint): void {
    this.spent += amount;
    this.unknownFingerprints.delete(fingerprint);
    this.paidFingerprints.add(fingerprint);
  }

  markUnknown(fingerprint: string, amount: bigint): void {
    // Count it against the budget until proven otherwise.
    this.spent += amount;
    this.unknownFingerprints.add(fingerprint);
  }

  get spentLovelace(): bigint {
    return this.spent;
  }
}

/** Cheap local checks before spending anything on the paid report. */
export function precheck(invoice: Invoice): { ok: true } | { ok: false; reason: string } {
  if (!invoice.iban && !invoice.routingNumber) {
    return { ok: false, reason: "no account identifier (IBAN or routing number) extracted" };
  }
  return { ok: true };
}
