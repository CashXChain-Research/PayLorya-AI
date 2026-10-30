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
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export type CheckStatus = "pass" | "fail" | "warn" | "skip";
export type DataSource = "deterministic" | "demo-fixture" | "cxc-sandbox";

export interface ReadinessCheck {
  id: "account" | "corridor" | "required_fields" | "duplicate" | "amount" | "quote" | "iban_country" | "bic_country" | "currency" | "reference";
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
  executable: false;
  invoiceId: string;
  supplier: string;
  amountMinor: number;
  currency: string;
  routeQuote?: RouteQuote;
  note: string;
}
