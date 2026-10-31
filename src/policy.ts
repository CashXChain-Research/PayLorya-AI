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

  /** `what` names the purchase in refusals: the report fee, or the invoice payout. */
  constructor(
    private readonly policy: SpendPolicy,
    private readonly what = "report",
  ) {}

  canPay(fingerprint: string, amount: bigint): { ok: true } | { ok: false; reason: string } {
    if (this.unknownFingerprints.has(fingerprint)) {
      return { ok: false, reason: "previous payment for this invoice has unknown settlement; resolve before paying again" };
    }
    if (this.paidFingerprints.has(fingerprint)) return { ok: false, reason: `${this.what} for this invoice already paid` };
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

/** Cheap local checks before spending anything on the paid report. */
export function precheck(invoice: Invoice): { ok: true } | { ok: false; reason: string } {
  if (invoice.currency === "ADA" ? !invoice.cardanoAddress : !invoice.iban && !invoice.routingNumber) {
    return { ok: false, reason: "no account identifier (IBAN, routing number or Cardano address) extracted" };
  }
  return { ok: true };
}
