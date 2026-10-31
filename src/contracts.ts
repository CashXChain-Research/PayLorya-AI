// HTTP contracts for the payment confirmation window, wallets, budgets and the chat.
// Shared by src/server.ts and the browser (web/src imports these as types only).
import type { RunState } from "./runs.js";
import type { PayoutRail, ReadinessCheck } from "./types.js";

/** Amount in minor units of `currency` (ADA: lovelace, 6 decimals; EUR/USD: cents). */
export interface Money {
  minor: number;
  currency: string;
}

/**
 * GET /api/runs/:id/preview: everything the human sees before confirming a payout. Built from the
 * verified payee record and server state only, never from model text. Moves nothing.
 */
export interface PaymentPreview {
  runId: string;
  state: RunState;
  /** True only when POST /api/runs/:id/approve would start the payout now. */
  payable: boolean;
  /** Why it is not payable (route, budget, approvals switched off). Empty when payable. */
  blockers: string[];
  /** Payable, but worth a look (e.g. the CashXChain account holds less than the amount). */
  warnings: string[];
  invoice: { id: string; supplier: string; reference?: string; destinationCountry: string; amount: Money };
  /** Name of the verified payee record that decides the destination. */
  payee?: string;
  rail?: PayoutRail;
  railLabel: string;
  amount: Money;
  from?: PaymentSource;
  to?: PaymentDestination;
  /** CashXChain quote for this payout, when the API returned one. */
  fee?: { amount: string; currency: string; simulated: boolean };
  budget: BudgetLine;
  /** The paid x402 readiness check this payout rests on. */
  check: { verdict: string; txHash?: string; explorerUrl?: string; priceLovelace?: string; checks: ReadinessCheck[] };
  /** Fiat only: the key CashXChain sees; one payout per key, a retry replays it. */
  idempotencyKey?: string;
  approvals: "operator-token" | "disabled";
}

export type PaymentSource =
  | { kind: "cardano_wallet"; address: string; network: "cardano:preprod"; balanceLovelace?: string }
  | { kind: "cxc_account"; accountId: string; currency: string; name?: string; available?: string }
  | { kind: "simulated"; label: string };

export type PaymentDestination =
  | { kind: "cardano_address"; address: string }
  | { kind: "iban"; iban: string; bic?: string }
  | { kind: "us_account"; routingNumber: string; accountNumber: string; accountType?: string };

/** One budget as it applies to one payment: used and limit before it, and what is left after it. */
export interface BudgetLine {
  label: string;
  currency: string;
  usedMinor: number;
  limitMinor: number;
  /** Used after this payment, if it goes through. */
  afterMinor: number;
  perPaymentMaxMinor: number;
  /** Fiat only: payouts counted against the session limit, and that limit. */
  payouts?: { used: number; limit: number };
}

/**
 * Spending limits the operator can change at runtime (GET/PUT /api/budget). Lovelace values are
 * decimal strings. Start values come from the environment; HARD_MAX in src/budget.ts bounds them.
 */
export interface Budget {
  /** x402 readiness checks, total per server session. */
  checkBudgetLovelace: string;
  /** tADA invoice payouts: largest single payout and total per session. */
  cardanoPayoutMaxLovelace: string;
  cardanoBudgetLovelace: string;
  /** Fiat payouts via CashXChain: largest single payout (invoice currency, minor units). */
  fiatPayoutMaxMinor: number;
  /** Fiat total per currency and session; currencies not listed use fiatBudgetDefaultMinor. */
  fiatBudgetMinor: Record<string, number>;
  fiatBudgetDefaultMinor: number;
  fiatPayoutsPerSession: number;
}

export interface BudgetUsage {
  checkSpentLovelace: string;
  cardanoPaidLovelace: string;
  /** Fiat sent or possibly sent, per currency (a definitive refusal frees its amount). */
  fiatPaidMinor: Record<string, number>;
  fiatPayouts: number;
}

/** GET /api/budget, and the answer to a successful PUT. */
export interface BudgetState {
  budget: Budget;
  usage: BudgetUsage;
  hardMax: Budget;
}

/** PUT /api/budget body: any subset; omitted fields stay. Needs the operator token. */
export type BudgetUpdate = Partial<Budget>;

/** GET /api/balances: what the agent can pay from, at a glance. */
export interface Balances {
  cardano: { address: string; network: "cardano:preprod"; balanceLovelace?: string; error?: string };
  cashxchain: {
    ready: boolean;
    /** True when fiat payouts run as a labeled simulation (no CASHXCHAIN_API_KEY). */
    simulated: boolean;
    accounts: Array<{ id: string; currency: string; status: string; name?: string; available?: string }>;
    error?: string;
  };
  budget: Budget;
  usage: BudgetUsage;
}

/** POST /api/chat body. Text turns only, oldest first; the last one is the user's. */
export interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/** What the browser should do after a chat reply. The model can ask; only a human confirms. */
export type ChatAction =
  | { type: "confirm_payment"; runId: string }
  | { type: "run_started"; runId: string }
  | { type: "open_run"; runId: string }
  | { type: "show_balances" };

/** POST /api/chat answer. 503 when no model is configured: the browser falls back to its rules. */
export interface ChatResponse {
  reply: string;
  actions: ChatAction[];
  /** Names of the functions the model called, in order (shown as small chips). */
  tools: string[];
}
