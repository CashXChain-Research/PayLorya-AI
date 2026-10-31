import type { Invoice } from "./types.js";

// Where an approved invoice is paid. Chosen from vendor master data, never from invoice text.
export type PayoutRouteKind = "cardano" | "cashxchain";

export interface Vendor {
  id: string;
  name: string;
  /** Other supplier names the extraction may produce for this vendor. */
  aliases?: string[];
  route: PayoutRouteKind;
  country: string;
  currency: string;
  /** cardano route: Preprod bech32 address that receives the payout. */
  cardanoAddress?: string;
  /** cashxchain route: the bank account registered for this vendor. */
  bank?: { iban?: string; bic?: string; routingNumber?: string; accountNumber?: string };
}

export interface PayoutRequest {
  runId: string;
  /** Stable per invoice: a retry with the same key must never pay twice. */
  idempotencyKey: string;
  invoice: Invoice;
  vendor: Vendor;
  /** Minor units of `currency` (lovelace for ADA). */
  amountMinor: number;
  currency: string;
}

export interface PayoutResult {
  route: PayoutRouteKind;
  status: "settled" | "submitted";
  /** Cardano tx hash, or the CashXChain payout id. */
  reference: string;
  explorerUrl?: string;
  /** True when the rail behind the route is simulated (the CashXChain sandbox bank). */
  simulated: boolean;
  completedAt: string;
}

/** Nothing was sent: the invoice may be unlocked and approved again. */
export class PayoutRefusedError extends Error {}

/** Something may have been sent: the invoice stays locked until a human checks `reference`. */
export class PayoutUnknownError extends Error {
  constructor(
    message: string,
    readonly reference?: string,
  ) {
    super(message);
  }
}

/**
 * One way to pay an approved invoice. `pay` resolves only when the payout is confirmed or accepted
 * by the rail, throws PayoutRefusedError when nothing left, and PayoutUnknownError (or anything else,
 * which the agent treats the same) when the outcome is unclear.
 */
export interface PayoutRoute {
  readonly kind: PayoutRouteKind;
  pay(request: PayoutRequest): Promise<PayoutResult>;
}
