import { z } from "zod";
import type { PayoutRouteKind } from "./payout.js";

// ISO 4217 minor-unit exponents for the currencies we accept. Anything else is rejected.
export const CURRENCY_EXPONENT: Record<string, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  AED: 2,
  PLN: 2,
  SEK: 2,
  JPY: 0,
  // Crypto invoices paid on Cardano Preprod: minor unit is lovelace (testnet ADA).
  ADA: 6,
};

export const InvoiceSchema = z.object({
  id: z.string().min(1).max(64),
  supplier: z.string().min(1).max(140),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/, "ISO-3166-1 alpha-2"),
  currency: z.string().refine(c => c in CURRENCY_EXPONENT, "unsupported ISO-4217 currency"),
  amountMinor: z.number().int().positive(),
  reference: z.string().max(140).optional(),
  iban: z.string().max(34).optional(),
  bic: z.string().max(11).optional(),
  routingNumber: z.string().max(9).optional(),
  accountNumber: z.string().max(34).optional(),
  // Checked and compared against vendor master data; never used as the payout destination.
  cardanoAddress: z.string().max(128).optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export type CheckStatus = "pass" | "fail" | "warn" | "skip";
export type DataSource = "deterministic" | "demo-fixture" | "cxc-sandbox";

export interface ReadinessCheck {
  id: "account" | "corridor" | "required_fields" | "duplicate" | "amount" | "quote";
  status: CheckStatus;
  message: string;
  source: DataSource;
}

export interface RouteQuote {
  rail: string;
  payoutCurrency: string;
  payoutAmountMinor: number;
  feeUsd: string;
  fxRate: string;
  etaHours: number;
  source: DataSource;
  label: string;
}

export type Verdict = "ready_for_review" | "needs_info" | "blocked";

export interface ReadinessReport {
  requestId: string;
  invoiceFingerprint: string;
  verdict: Verdict;
  checks: ReadinessCheck[];
  routeQuote?: RouteQuote;
  source: DataSource;
  payoutExecuted: false;
  disclaimer: string;
  generatedAt: string;
}

export interface PaymentProof {
  network: "cardano:preprod";
  buyerAddress: string;
  sellerAddress: string;
  asset: string;
  amount: string;
  transactionHash: string;
  explorerUrl: string;
  settledAt: string;
}

export interface PaymentDraft {
  status: "awaiting_human_approval";
  /** True when master data names the vendor and its payout route is configured: Approve then pays. */
  executable: boolean;
  invoiceId: string;
  supplier: string;
  amountMinor: number;
  currency: string;
  routeQuote?: RouteQuote;
  /** Destination from vendor master data, never from the invoice. */
  payout?: { route: PayoutRouteKind; vendorId: string; payee: string };
  /** Why Approve cannot pay: vendor unknown, payment details differ, or route not configured. */
  blockedReason?: string;
  note: string;
}
