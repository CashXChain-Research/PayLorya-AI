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
  // US accounts: the CashXChain USD/US corridor requires it. Only ever copied from the invoice.
  accountType: z.enum(["checking", "savings"]).optional(),
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

/** A payout quote from the CashXChain sandbox (`POST /v1/banking/payouts/quote`). Sandbox pricing. */
export interface CxcRouteQuote {
  source: "cxc-sandbox";
  label: string;
  /** Rails the corridor offers (`GET /v1/banking/corridors`); CashXChain picks one at payout. */
  rails: string[];
  payoutCurrency: string;
  payoutAmount: string;
  sourceCurrency: string;
  /** Leaves the payer's account, fee included. */
  sourceAmount: string;
  fee: string;
  /** Units of payoutCurrency per unit of sourceCurrency. */
  rate: string;
}

export type Verdict = "ready_for_review" | "needs_info" | "blocked";

export interface ReadinessReport {
  requestId: string;
  invoiceFingerprint: string;
  verdict: Verdict;
  checks: ReadinessCheck[];
  routeQuote?: RouteQuote;
  /** Set instead of routeQuote when the report was priced on the CashXChain sandbox. */
  cxcQuote?: CxcRouteQuote;
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

/** A CashXChain sandbox payout prepared before approval. Nothing in here moved money. */
export interface CxcPayoutPlan {
  environment: "sandbox";
  sourceAccountId: string;
  beneficiaryId: string;
  scheme: string;
  /** Source account holds another currency; the sandbox rail converts at its own rate. */
  crossCurrency: boolean;
  /** Decimal string sent to CashXChain, e.g. "624.00". */
  amount: string;
  currency: string;
  reference: string;
  payeeCheck: { outcome: string; mayPay: boolean; check?: string };
  quote: { sourceAmount: string; sourceCurrency: string; fee: string; rate: string; simulated: boolean };
  available?: string;
  sufficientFunds?: boolean;
  preparedAt: string;
}

export interface PaymentDraft {
  status: "awaiting_human_approval";
  /** True only when a CashXChain sandbox payout was prepared; approval then executes it. */
  executable: boolean;
  invoiceId: string;
  supplier: string;
  amountMinor: number;
  currency: string;
  routeQuote?: RouteQuote;
  cashxchain?: CxcPayoutPlan;
  /** Why the draft cannot be executed (CashXChain not configured or unavailable). */
  blockedReason?: string;
  note: string;
}

/** The CashXChain payout of a run, after human approval. */
export interface PayoutRecord {
  environment: "sandbox";
  /** Derived from the invoice fingerprint and attempt, so a retry or restart cannot pay twice. */
  idempotencyKey: string;
  attempt: number;
  /** Set when this key is bound to a payout that will never pay (failed, or refused after recording). */
  retryWithNewKey?: boolean;
  approvedAt: string;
  id?: string;
  status?: string;
  amount?: string;
  currency?: string;
  createdAt?: string;
  submittedAt?: string;
  settledAt?: string;
  requestId?: string;
  error?: { httpStatus?: number; code?: string; message: string };
}
