import { createHash } from "node:crypto";
import { CashXChainClient, CxcApiError, type CxcAccountInput, type CxcBeneficiaryInput, type CxcPayout } from "./cashxchain.js";
import type { FiatPayoutClient } from "./payout.js";
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

export interface CashXChainPayoutOptions {
  pollIntervalMs?: number;
  pollAttempts?: number;
}

/**
 * Fiat payouts on the CashXChain sandbox money API (`/v1/banking/*`, docs.cashxchain.com/docs/api).
 * The destination is the verified payee account the router selected, never the invoice text.
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

  async payout({ idempotencyKey, invoice, destination }: { idempotencyKey: string; invoice: Invoice; destination: string }): Promise<{ reference: string }> {
    // Everything before the payout POST sends nothing: any failure here is a refusal.
    const { sourceAccountId, beneficiaryId } = await refuseOnError(() => this.prepare(invoice, destination));
    const body = {
      source_account_id: sourceAccountId,
      beneficiary_id: beneficiaryId,
      amount: toDecimal(invoice.amountMinor, invoice.currency),
      currency: invoice.currency,
      reference: invoice.id.slice(0, REFERENCE_MAX),
    };

    let payout: CxcPayout;
    try {
      // Same key and body replays the payout as it is now; it never sends a second one.
      payout = await this.client.createPayout(body, idempotencyKey);
    } catch (error) {
      if (error instanceof CxcApiError && error.status >= 400 && error.status < 500) {
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
        default: // failed, cancelled, returned: final, but treated as unclear until a human checks
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

  private async prepare(invoice: Invoice, destination: string): Promise<{ sourceAccountId: string; beneficiaryId: string }> {
    const account = accountFromDestination(destination);
    if (!account) throw new PayoutRefusedError("unsupported_destination", `cannot pay destination format "${destination}"`);

    const { accounts } = await this.client.listAccounts();
    const source = accounts.find(a => a.currency === invoice.currency && a.status === "active");
    if (!source) {
      throw new PayoutRefusedError("no_source_account", `no active ${invoice.currency} account in the CashXChain sandbox`);
    }

    const beneficiary: CxcBeneficiaryInput = {
      beneficiary_type: "business",
      name: invoice.supplier,
      currency: invoice.currency,
      country_code: invoice.destinationCountry,
      account,
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

/** The router's destination: a bare IBAN, or "ABA <routing> / <account>" (src/routing.ts). */
export function accountFromDestination(destination: string): CxcAccountInput | undefined {
  const aba = /^ABA (\d{9}) \/ ([A-Za-z0-9]+)$/.exec(destination);
  if (aba) return { scheme: "us_routing", routing_number: aba[1]!, account_number: aba[2]! };
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(destination)) return { scheme: "iban", iban: destination };
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
