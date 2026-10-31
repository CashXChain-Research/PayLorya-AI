import { z } from "zod";

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
  // Cardano test ADA (tADA on Preprod). Minor unit is lovelace.
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
  // Payee wallet printed on the invoice. Data only: it is paid only if it equals the verified payee record.
  cardanoAddress: z.string().max(120).optional(),
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

export type PayoutRail = "cxc_fiat" | "cardano_preprod";

export interface RouteCheck {
  id: "payee" | "account" | "rail" | "limit" | "wallet";
  status: CheckStatus;
  message: string;
}

/**
 * Deterministic payout route. `destination` always comes from the verified payee record,
 * never from invoice text.
 */
export interface RouteDecision {
  status: "selected" | "unavailable" | "blocked";
  rail?: PayoutRail;
  payee?: string;
  destination?: string;
  checks: RouteCheck[];
  reason: string;
}

export interface PaymentDraft {
  status: "awaiting_human_approval";
  /** True only when a payout route was selected; execution still needs human approval. */
  executable: boolean;
  invoiceId: string;
  supplier: string;
  amountMinor: number;
  currency: string;
  routeQuote?: RouteQuote;
  route: RouteDecision;
  note: string;
}

export interface PayoutResult {
  rail: PayoutRail;
  /** confirmed/submitted: real Preprod tx. simulated: no money moved. unknown: signed, outcome unclear. */
  status: "confirmed" | "submitted" | "simulated" | "unknown";
  simulated: boolean;
  amountMinor: number;
  currency: string;
  destination: string;
  reference?: string;
  explorerUrl?: string;
  label: string;
  executedAt: string;
}
