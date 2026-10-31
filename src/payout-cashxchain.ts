import { createHash } from "node:crypto";
import { CashXChainClient, CxcApiError, type CxcAccountInput, type CxcBeneficiaryInput, type CxcPayout } from "./cashxchain.js";
import type { FiatPayoutClient, FiatPayoutRequest } from "./payout.js";
import type { VerifiedPayee } from "./routing.js";
import { CURRENCY_EXPONENT, type Invoice } from "./types.js";

/** Nothing was sent to CashXChain's rail: safe to approve again after fixing the cause. */
export class PayoutRefusedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** The payout may exist. Lock the invoice and check `payoutId` (if any) before paying again. */
export class PayoutUnknownError extends Error {
  constructor(message: string, readonly payoutId?: string) {
    super(message);
  }
}

// Production rails take at most 18 characters; the sandbox does not check.
const REFERENCE_MAX = 18;
// The only 4xx codes that prove no payout exists under the key. CashXChain's payout handler runs
// the corridor and plan-limit checks only for a first attempt (a replay skips them), and a funds
// refusal is recorded so that a replay answers 200 `failed` instead. Every other 4xx can come from
// the checks a replay re-runs before it finds the stored payout (verification, account hold,
// beneficiary and account ownership, payee name), so it may hide a payout that already settled,
// e.g. one sent before a restart.
const NOTHING_UNDER_KEY = new Set(["corridor_unsupported", "plan_limit_exceeded", "insufficient_balance"]);

export interface CashXChainPayoutOptions {
  pollIntervalMs?: number;
  pollAttempts?: number;
}

/**
 * Fiat payouts on the CashXChain sandbox money API (`/v1/banking/*`, docs.cashxchain.com/docs/api).
 * Beneficiary name and bank details come only from the verified payee record, never the invoice.
 * Sandbox only: the client's base URL is fixed and config refuses live keys.
 */
export class CashXChainPayoutRoute implements FiatPayoutClient {
  readonly simulated = false;
  readonly label = "CashXChain sandbox payout (test ledger, no real money)";
  private readonly pollIntervalMs: number;
  private readonly pollAttempts: number;

  constructor(
    private readonly client: CashXChainClient,
    opts: CashXChainPayoutOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
    this.pollAttempts = opts.pollAttempts ?? 10;
  }

  /** Lets the agent release the hold and offer Approve again: nothing reached CashXChain's rail. */
  isDefinitiveRejection(error: unknown): boolean {
    return error instanceof PayoutRefusedError;
  }

  async payout({ idempotencyKey, invoice, payee }: FiatPayoutRequest): Promise<{ reference: string }> {
    // Everything before the payout POST sends nothing: any failure here is a refusal.
    const { sourceAccountId, beneficiaryId } = await refuseOnError(() => this.prepare(invoice, payee));
    const body = {
      source_account_id: sourceAccountId,
      beneficiary_id: beneficiaryId,
      amount: toDecimal(invoice.amountMinor, invoice.currency),
      currency: invoice.currency,
      // Exactly payoutKey's normalized id (src/routing.ts), upper-cased afterwards: every id variant
      // that maps to one key sends one body (else 409 idempotency_key_reuse).
      reference: invoice.id.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase().slice(0, REFERENCE_MAX),
    };

    let payout: CxcPayout;
    try {
      // Same key and body replays the payout as it is now; it never sends a second one.
      payout = await this.client.createPayout(body, idempotencyKey);
    } catch (error) {
      if (error instanceof CxcApiError && error.status >= 400 && error.status < 500 && NOTHING_UNDER_KEY.has(error.code ?? "")) {
        throw new PayoutRefusedError(error.code ?? `http_${error.status}`, error.message);
      }
      throw new PayoutUnknownError(error instanceof Error ? error.message : String(error));
    }

    for (let i = 0; ; i++) {
      switch (payout.status) {
        case "settled":
          return { reference: payout.id };
        case "submitted":
        case "processing":
          if (i >= this.pollAttempts) return { reference: payout.id }; // accepted, still in flight
          break;
        case "created": // recorded, outcome not known yet (also a replay of an unclear first attempt)
          if (i >= this.pollAttempts) throw new PayoutUnknownError(`CashXChain payout ${payout.id} is still created`, payout.id);
          break;
        // Final and documented as "did not happen" / "stopped before execution". This is also how a
        // replay of a key refused for insufficient_balance answers (200, status failed).
        case "failed":
        case "cancelled":
          throw new PayoutRefusedError(payout.status, `CashXChain payout ${payout.id} is ${payout.status}; nothing was paid`);
        default: // returned (settled, then sent back) or anything unknown: a human checks
          throw new PayoutUnknownError(`CashXChain payout ${payout.id} is ${payout.status}`, payout.id);
      }
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      try {
        payout = await this.client.getPayout(payout.id);
      } catch (error) {
        throw new PayoutUnknownError(error instanceof Error ? error.message : String(error), payout.id);
      }
    }
  }

  private async prepare(invoice: Invoice, payee: VerifiedPayee): Promise<{ sourceAccountId: string; beneficiaryId: string }> {
    const target = beneficiaryTarget(payee);
    if (!target) throw new PayoutRefusedError("no_bank_account", `verified payee ${payee.name} has no bank account on record`);

    const { accounts } = await this.client.listAccounts();
    const source = accounts.find(a => a.currency === invoice.currency && a.status === "active");
    if (!source) {
      throw new PayoutRefusedError("no_source_account", `no active ${invoice.currency} account in the CashXChain sandbox`);
    }

    const beneficiary: CxcBeneficiaryInput = {
      beneficiary_type: "business",
      name: payee.name,
      currency: invoice.currency,
      country_code: target.country,
      account: target.account,
      ...(payee.accountType ? { corridor_fields: { account_type: payee.accountType } } : {}),
    };
    // Same payee details, same key: the sandbox returns the beneficiary it already registered.
    const key = `agentpay-ben-${createHash("sha256").update(JSON.stringify(beneficiary)).digest("hex").slice(0, 32)}`;
    const { id } = await this.client.createBeneficiary(beneficiary, key);
    return { sourceAccountId: source.id, beneficiaryId: id };
  }
}

async function refuseOnError<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof PayoutRefusedError) throw error;
    if (error instanceof CxcApiError) throw new PayoutRefusedError(error.code ?? `http_${error.status}`, error.message);
    throw new PayoutRefusedError("unreachable", error instanceof Error ? error.message : String(error));
  }
}

/** Account and bank country from the verified record: IBAN (country from its prefix) or US ABA. */
export function beneficiaryTarget(payee: VerifiedPayee): { account: CxcAccountInput; country: string } | undefined {
  if (payee.iban) {
    return { account: { scheme: "iban", iban: payee.iban, ...(payee.bic ? { bic: payee.bic } : {}) }, country: payee.iban.slice(0, 2) };
  }
  if (payee.routingNumber && payee.accountNumber) {
    return { account: { scheme: "us_routing", routing_number: payee.routingNumber, account_number: payee.accountNumber }, country: "US" };
  }
  return undefined;
}

/** Integer minor units to the decimal string CashXChain expects, with the currency's decimals. */
export function toDecimal(amountMinor: number, currency: string): string {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === undefined) throw new PayoutRefusedError("unsupported_currency", `unsupported currency ${currency}`);
  if (exp === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exp + 1, "0");
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}
