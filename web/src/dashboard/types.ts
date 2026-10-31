// API contract between the dashboard (/app) and the server (/api/v1/*). The server's responses
// match these shapes; keep both sides in sync. All endpoints need a session cookie (Better Auth)
// and answer 401 { error } without one. Money: integer minor units plus an ISO-4217 currency;
// reporting totals are USD minor units (cents), converted with indicative FX rates.

export type Autonomy = "read_only" | "guarded" | "full";

export interface AgentLimits {
  /** Largest single payment the agent may execute on its own (guarded mode), USD cents. */
  perPaymentUsdMinor: number;
  /** Total the agent may execute on its own per calendar month (guarded mode), USD cents. */
  monthlyUsdMinor: number;
  /** Guarded and full mode: only pay payees saved in the payee directory. */
  knownPayeesOnly: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  baseCurrency: "USD";
  autonomy: Autonomy;
  limits: AgentLimits;
  createdAt: string;
}

export interface Me {
  user: { id: string; name: string; email: string };
  workspace: Workspace;
}

/** PATCH /api/v1/workspace. Switching to "full" requires confirm: "FULL ACCESS". */
export interface WorkspacePatch {
  name?: string;
  autonomy?: Autonomy;
  limits?: Partial<AgentLimits>;
  confirm?: string;
}

export type ConnectionKind = "cardano_agent_wallet" | "cardano_wallet" | "evm_wallet" | "cashxchain" | "bank";
export type Access = "read" | "read_write";

export interface Balance {
  asset: string; // "tADA", "ETH", "USD", "EUR", ...
  amount: string; // decimal string in the asset's major unit
  usdMinor?: number; // indicative
}

export interface Connection {
  id: string;
  kind: ConnectionKind;
  label: string;
  network: string; // "cardano:preprod", "ethereum", "cashxchain:sandbox", "bank"
  address?: string;
  access: Access;
  /** What the provider supports at all; write is false for watch-only kinds. */
  supports: { read: boolean; write: boolean };
  status: "active" | "error" | "coming_soon";
  balances: Balance[];
  error?: string;
  createdAt: string;
}

/** POST /api/v1/connections. GET /api/v1/connections/catalog lists what can be added. */
export interface ConnectionCreate {
  kind: ConnectionKind;
  label?: string;
  address?: string; // cardano_wallet (addr_test1...), evm_wallet (0x...)
  access?: Access;
}

export interface CatalogEntry {
  kind: ConnectionKind;
  name: string;
  description: string;
  supports: { read: boolean; write: boolean };
  available: boolean; // false: shown as "coming soon"
  needsAddress: boolean;
}

export type DocumentKind = "invoice" | "receipt" | "bank_statement" | "contract" | "payroll" | "tax" | "other";

export interface DocumentSummary {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  source: "upload" | "chat";
  status: "processing" | "processed" | "failed";
  kind?: DocumentKind;
  title?: string;
  summary?: string;
  counterparty?: string;
  amountMinor?: number;
  currency?: string;
  issueDate?: string; // YYYY-MM-DD
  dueDate?: string;
  category?: string;
  error?: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  /** Everything the model extracted (line items, payment details, ...), for display only. */
  extracted?: Record<string, unknown>;
  transactions: Transaction[];
  payments: Payment[];
}

/** POST /api/v1/documents: one file per request, base64 body (max 15 MB file). */
export interface DocumentUpload {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  counterparty?: string;
  category: string;
  amountMinor: number; // negative = money out
  currency: string;
  usdMinor: number; // indicative
  source: "document" | "payment" | "manual";
  documentId?: string;
}

export interface Payee {
  id: string;
  name: string;
  country?: string;
  iban?: string;
  bic?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: "checking" | "savings";
  cardanoAddress?: string;
  createdAt: string;
}
export type PayeeInput = Omit<Payee, "id" | "createdAt">;

export interface Budget {
  id: string;
  name: string;
  category: string;
  limitUsdMinor: number; // per calendar month
  spentUsdMinor: number; // this month, computed
  createdAt: string;
}
export interface BudgetInput {
  name: string;
  category: string;
  limitUsdMinor: number;
}

export type PaymentStatus = "pending_approval" | "approved" | "executing" | "executed" | "rejected" | "failed" | "blocked";
export type Rail = "cardano_preprod" | "cashxchain" | "manual";

export interface PolicyCheck {
  id: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export interface Payment {
  id: string;
  payeeName: string;
  payeeId?: string;
  amountMinor: number;
  currency: string;
  usdMinor: number;
  rail: Rail;
  reason: string;
  documentId?: string;
  status: PaymentStatus;
  requestedBy: "agent" | "user";
  /** auto: the agent may execute it alone; approval: a human must approve; blocked: nobody can. */
  policy: { decision: "auto" | "approval" | "blocked"; checks: PolicyCheck[] };
  runId?: string;
  txHash?: string;
  explorerUrl?: string;
  reference?: string;
  error?: string;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;
}

/** POST /api/v1/payments (user-drafted). Agent drafts arrive through the chat. */
export interface PaymentCreate {
  payeeId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  documentId?: string;
}

export interface Activity {
  id: string;
  at: string;
  actor: "user" | "agent" | "system";
  action: string; // short verb phrase, e.g. "uploaded document", "drafted payment"
  detail: string;
  ref?: { type: "document" | "payment" | "budget" | "connection" | "chat" | "payee" | "workspace"; id: string };
}

export interface Overview {
  workspace: Workspace;
  cash: { totalUsdMinor: number; connections: Array<{ id: string; label: string; usdMinor: number; balances: Balance[] }> };
  payables: { count: number; totalUsdMinor: number; upcoming: DocumentSummary[] };
  approvals: { count: number; payments: Payment[] };
  spendByCategory: Array<{ category: string; usdMinor: number }>; // this month, money out
  monthly: Array<{ month: string; inUsdMinor: number; outUsdMinor: number }>; // last 6 months, YYYY-MM
  budgets: Budget[];
  agent: { autonomy: Autonomy; executedThisMonthUsdMinor: number; limits: AgentLimits };
  documents: { total: number; processing: number };
}

export interface Forecast {
  days: number;
  startUsdMinor: number;
  points: Array<{ date: string; balanceUsdMinor: number }>;
  events: Array<{ date: string; label: string; usdMinor: number; documentId?: string }>;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Array<{ documentId: string; filename: string }>;
  tools?: Array<{ name: string; summary: string }>;
  createdAt: string;
}

/**
 * POST /api/v1/chats/:id/messages { text, attachments?: DocumentUpload[] } answers with a
 * text/event-stream. Each SSE event has `event: <type>` and JSON `data`.
 */
export type ChatEvent =
  | { type: "user"; message: ChatMessage } // the stored user message (attachments resolved)
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "done"; summary: string }
  | { type: "done"; message: ChatMessage } // the stored assistant message
  | { type: "error"; message: string };
