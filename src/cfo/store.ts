import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { AgentLimits, Autonomy, PolicyDecision, Rail } from "./policy.js";

// Row shapes follow web/src/dashboard/types.ts (the dashboard's API contract).

export type ConnectionKind = "cardano_agent_wallet" | "cardano_wallet" | "evm_wallet" | "cashxchain" | "bank";
export type Access = "read" | "read_write";
export type DocumentKind = "invoice" | "receipt" | "bank_statement" | "contract" | "payroll" | "tax" | "other";
export type PaymentStatus = "pending_approval" | "approved" | "executing" | "executed" | "rejected" | "failed" | "blocked";

export interface Workspace {
  id: string;
  name: string;
  baseCurrency: "USD";
  autonomy: Autonomy;
  limits: AgentLimits;
  createdAt: string;
}

export interface Balance {
  asset: string;
  amount: string;
  usdMinor?: number;
}

export interface ConnectionRow {
  id: string;
  kind: ConnectionKind;
  label: string;
  network: string;
  address?: string;
  access: Access;
  balances: Balance[];
  error?: string;
  refreshedAt?: string;
  createdAt: string;
}

export interface DocumentRow {
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
  issueDate?: string;
  dueDate?: string;
  category?: string;
  extracted?: Record<string, unknown>;
  error?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  counterparty?: string;
  category: string;
  amountMinor: number;
  currency: string;
  usdMinor: number;
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

export interface BudgetRow {
  id: string;
  name: string;
  category: string;
  limitUsdMinor: number;
  createdAt: string;
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
  policy: PolicyDecision;
  runId?: string;
  txHash?: string;
  explorerUrl?: string;
  reference?: string;
  error?: string;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;
}

export interface Activity {
  id: string;
  at: string;
  actor: "user" | "agent" | "system";
  action: string;
  detail: string;
  ref?: { type: string; id: string };
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Anthropic API content blocks for this turn, replayed to the model. */
  content: unknown[];
  attachments?: Array<{ documentId: string; filename: string }>;
  tools?: Array<{ name: string; summary: string }>;
  createdAt: string;
}

type Row = Record<string, SQLInputValue>;
const now = () => new Date().toISOString();
const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export const DEFAULT_LIMITS: AgentLimits = { perPaymentUsdMinor: 50_000, monthlyUsdMinor: 500_000, knownPayeesOnly: true };

/** Data access for one SQLite database. Every query is scoped by workspace id. */
export class Store {
  constructor(readonly db: DatabaseSync) {}

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  // Workspaces -----------------------------------------------------------------------------

  workspaceForUser(userId: string, defaultName: string): Workspace {
    const row = this.get("SELECT * FROM workspaces WHERE owner_user_id = ?", userId);
    if (row) return toWorkspace(row);
    const id = randomUUID();
    this.run(
      "INSERT INTO workspaces (id, owner_user_id, name, autonomy, per_payment_usd_minor, monthly_usd_minor, known_payees_only, created_at) VALUES (?, ?, ?, 'guarded', ?, ?, 1, ?)",
      id,
      userId,
      defaultName,
      DEFAULT_LIMITS.perPaymentUsdMinor,
      DEFAULT_LIMITS.monthlyUsdMinor,
      now(),
    );
    return toWorkspace(this.get("SELECT * FROM workspaces WHERE id = ?", id)!);
  }

  workspace(id: string): Workspace | undefined {
    const row = this.get("SELECT * FROM workspaces WHERE id = ?", id);
    return row ? toWorkspace(row) : undefined;
  }

  updateWorkspace(id: string, patch: { name?: string; autonomy?: Autonomy; limits?: Partial<AgentLimits> }): Workspace {
    const ws = this.workspace(id)!;
    const limits = { ...ws.limits, ...patch.limits };
    this.run(
      "UPDATE workspaces SET name = ?, autonomy = ?, per_payment_usd_minor = ?, monthly_usd_minor = ?, known_payees_only = ? WHERE id = ?",
      patch.name ?? ws.name,
      patch.autonomy ?? ws.autonomy,
      limits.perPaymentUsdMinor,
      limits.monthlyUsdMinor,
      limits.knownPayeesOnly ? 1 : 0,
      id,
    );
    return this.workspace(id)!;
  }

  // Connections ----------------------------------------------------------------------------

  connections(ws: string): ConnectionRow[] {
    return this.all("SELECT * FROM connections WHERE workspace_id = ? ORDER BY created_at", ws).map(toConnection);
  }

  connection(ws: string, id: string): ConnectionRow | undefined {
    const row = this.get("SELECT * FROM connections WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? toConnection(row) : undefined;
  }

  addConnection(ws: string, c: { kind: ConnectionKind; label: string; network: string; address?: string; access: Access }): ConnectionRow {
    const id = randomUUID();
    this.run(
      "INSERT INTO connections (id, workspace_id, kind, label, network, address, access, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      ws,
      c.kind,
      c.label,
      c.network,
      c.address ?? null,
      c.access,
      now(),
    );
    return this.connection(ws, id)!;
  }

  updateConnection(ws: string, id: string, patch: { label?: string; access?: Access; balances?: Balance[]; error?: string | null }): void {
    const c = this.connection(ws, id);
    if (!c) return;
    const refreshed = patch.balances !== undefined || patch.error !== undefined;
    this.run(
      "UPDATE connections SET label = ?, access = ?, balances_json = ?, error = ?, refreshed_at = ? WHERE workspace_id = ? AND id = ?",
      patch.label ?? c.label,
      patch.access ?? c.access,
      JSON.stringify(patch.balances ?? c.balances),
      patch.error === undefined ? (c.error ?? null) : patch.error,
      refreshed ? now() : (c.refreshedAt ?? null),
      ws,
      id,
    );
  }

  deleteConnection(ws: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM connections WHERE workspace_id = ? AND id = ?").run(ws, id).changes) > 0;
  }

  // Documents ------------------------------------------------------------------------------

  addDocument(ws: string, d: { filename: string; mimeType: string; data: Uint8Array; source: "upload" | "chat" }): DocumentRow {
    const id = randomUUID();
    this.run(
      "INSERT INTO documents (id, workspace_id, filename, mime_type, size, source, status, data, created_at) VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)",
      id,
      ws,
      d.filename,
      d.mimeType,
      d.data.byteLength,
      d.source,
      d.data,
      now(),
    );
    return this.document(ws, id)!;
  }

  documents(ws: string): DocumentRow[] {
    return this.all("SELECT * FROM documents WHERE workspace_id = ? ORDER BY created_at DESC", ws).map(toDocument);
  }

  document(ws: string, id: string): DocumentRow | undefined {
    const row = this.get("SELECT * FROM documents WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? toDocument(row) : undefined;
  }

  documentFile(ws: string, id: string): { mimeType: string; filename: string; data: Uint8Array } | undefined {
    const row = this.get("SELECT mime_type, filename, data FROM documents WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? { mimeType: String(row.mime_type), filename: String(row.filename), data: row.data as Uint8Array } : undefined;
  }

  completeDocument(
    ws: string,
    id: string,
    d: Pick<DocumentRow, "kind" | "title" | "summary" | "counterparty" | "amountMinor" | "currency" | "issueDate" | "dueDate" | "category" | "extracted">,
  ): void {
    this.run(
      `UPDATE documents SET status = 'processed', kind = ?, title = ?, summary = ?, counterparty = ?, amount_minor = ?, currency = ?,
         issue_date = ?, due_date = ?, category = ?, extracted_json = ?, error = NULL WHERE workspace_id = ? AND id = ?`,
      d.kind ?? null,
      d.title ?? null,
      d.summary ?? null,
      d.counterparty ?? null,
      d.amountMinor ?? null,
      d.currency ?? null,
      d.issueDate ?? null,
      d.dueDate ?? null,
      d.category ?? null,
      JSON.stringify(d.extracted ?? {}),
      ws,
      id,
    );
  }

  failDocument(ws: string, id: string, error: string): void {
    this.run("UPDATE documents SET status = 'failed', error = ? WHERE workspace_id = ? AND id = ?", error, ws, id);
  }

  deleteDocument(ws: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM documents WHERE workspace_id = ? AND id = ?").run(ws, id).changes) > 0;
  }

  // Transactions ---------------------------------------------------------------------------

  addTransaction(ws: string, t: Omit<Transaction, "id"> & { paymentId?: string }): Transaction {
    const id = randomUUID();
    this.run(
      `INSERT INTO transactions (id, workspace_id, date, description, counterparty, category, amount_minor, currency, usd_minor, source, document_id, payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ws,
      t.date,
      t.description,
      t.counterparty ?? null,
      t.category,
      t.amountMinor,
      t.currency,
      t.usdMinor,
      t.source,
      t.documentId ?? null,
      t.paymentId ?? null,
    );
    return { id, ...t };
  }

  /** `from`/`to` are inclusive YYYY-MM-DD bounds. */
  transactions(ws: string, range: { from?: string; to?: string } = {}): Transaction[] {
    return this.all(
      "SELECT * FROM transactions WHERE workspace_id = ? AND date >= ? AND date <= ? ORDER BY date DESC",
      ws,
      range.from ?? "0000-00-00",
      range.to ?? "9999-99-99",
    ).map(toTransaction);
  }

  transactionsForDocument(ws: string, documentId: string): Transaction[] {
    return this.all("SELECT * FROM transactions WHERE workspace_id = ? AND document_id = ? ORDER BY date", ws, documentId).map(toTransaction);
  }

  deleteTransactionsForDocument(ws: string, documentId: string): void {
    this.run("DELETE FROM transactions WHERE workspace_id = ? AND document_id = ?", ws, documentId);
  }

  // Payees ---------------------------------------------------------------------------------

  payees(ws: string): Payee[] {
    return this.all("SELECT * FROM payees WHERE workspace_id = ? ORDER BY name", ws).map(toPayee);
  }

  payee(ws: string, id: string): Payee | undefined {
    const row = this.get("SELECT * FROM payees WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? toPayee(row) : undefined;
  }

  savePayee(ws: string, p: PayeeInput, id?: string): Payee {
    const values = [p.name, p.country ?? null, p.iban ?? null, p.bic ?? null, p.routingNumber ?? null, p.accountNumber ?? null, p.accountType ?? null, p.cardanoAddress ?? null];
    if (id) {
      this.run(
        "UPDATE payees SET name = ?, country = ?, iban = ?, bic = ?, routing_number = ?, account_number = ?, account_type = ?, cardano_address = ? WHERE workspace_id = ? AND id = ?",
        ...values,
        ws,
        id,
      );
      return this.payee(ws, id)!;
    }
    const newId = randomUUID();
    this.run(
      "INSERT INTO payees (id, workspace_id, name, country, iban, bic, routing_number, account_number, account_type, cardano_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      newId,
      ws,
      ...values,
      now(),
    );
    return this.payee(ws, newId)!;
  }

  deletePayee(ws: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM payees WHERE workspace_id = ? AND id = ?").run(ws, id).changes) > 0;
  }

  // Budgets --------------------------------------------------------------------------------

  budgets(ws: string): BudgetRow[] {
    return this.all("SELECT * FROM budgets WHERE workspace_id = ? ORDER BY created_at", ws).map(toBudget);
  }

  budget(ws: string, id: string): BudgetRow | undefined {
    const row = this.get("SELECT * FROM budgets WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? toBudget(row) : undefined;
  }

  saveBudget(ws: string, b: { name: string; category: string; limitUsdMinor: number }, id?: string): BudgetRow {
    if (id) {
      this.run("UPDATE budgets SET name = ?, category = ?, limit_usd_minor = ? WHERE workspace_id = ? AND id = ?", b.name, b.category, b.limitUsdMinor, ws, id);
      return this.budget(ws, id)!;
    }
    const newId = randomUUID();
    this.run("INSERT INTO budgets (id, workspace_id, name, category, limit_usd_minor, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId, ws, b.name, b.category, b.limitUsdMinor, now());
    return this.budget(ws, newId)!;
  }

  deleteBudget(ws: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM budgets WHERE workspace_id = ? AND id = ?").run(ws, id).changes) > 0;
  }

  // Payments -------------------------------------------------------------------------------

  addPayment(ws: string, p: Omit<Payment, "id" | "createdAt">): Payment {
    const id = randomUUID();
    this.run(
      `INSERT INTO payments (id, workspace_id, payee_id, payee_name, amount_minor, currency, usd_minor, rail, reason, document_id, status, requested_by, policy_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ws,
      p.payeeId ?? null,
      p.payeeName,
      p.amountMinor,
      p.currency,
      p.usdMinor,
      p.rail,
      p.reason,
      p.documentId ?? null,
      p.status,
      p.requestedBy,
      JSON.stringify(p.policy),
      now(),
    );
    return this.payment(ws, id)!;
  }

  payments(ws: string): Payment[] {
    return this.all("SELECT * FROM payments WHERE workspace_id = ? ORDER BY created_at DESC", ws).map(toPayment);
  }

  payment(ws: string, id: string): Payment | undefined {
    const row = this.get("SELECT * FROM payments WHERE workspace_id = ? AND id = ?", ws, id);
    return row ? toPayment(row) : undefined;
  }

  updatePayment(ws: string, id: string, patch: Partial<Pick<Payment, "status" | "policy" | "runId" | "txHash" | "explorerUrl" | "reference" | "error" | "decidedAt" | "executedAt">>): Payment {
    const p = this.payment(ws, id)!;
    const next = { ...p, ...patch };
    this.run(
      `UPDATE payments SET status = ?, policy_json = ?, run_id = ?, tx_hash = ?, explorer_url = ?, reference = ?, error = ?, decided_at = ?, executed_at = ?
       WHERE workspace_id = ? AND id = ?`,
      next.status,
      JSON.stringify(next.policy),
      next.runId ?? null,
      next.txHash ?? null,
      next.explorerUrl ?? null,
      next.reference ?? null,
      next.error ?? null,
      next.decidedAt ?? null,
      next.executedAt ?? null,
      ws,
      id,
    );
    return this.payment(ws, id)!;
  }

  /** USD cents of payments the agent executed on its own (no human decision) since `since`. */
  agentExecutedSince(ws: string, since: string): number {
    const row = this.get(
      "SELECT COALESCE(SUM(usd_minor), 0) AS total FROM payments WHERE workspace_id = ? AND requested_by = 'agent' AND decided_at IS NULL AND status IN ('executing', 'executed') AND executed_at >= ?",
      ws,
      since,
    );
    return Number(row?.total ?? 0);
  }

  // Activity -------------------------------------------------------------------------------

  log(ws: string, actor: Activity["actor"], action: string, detail: string, ref?: { type: string; id: string }): void {
    this.run(
      "INSERT INTO activity (id, workspace_id, at, actor, action, detail, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      randomUUID(),
      ws,
      now(),
      actor,
      action,
      detail,
      ref?.type ?? null,
      ref?.id ?? null,
    );
  }

  activity(ws: string, limit = 100): Activity[] {
    return this.all("SELECT * FROM activity WHERE workspace_id = ? ORDER BY at DESC LIMIT ?", ws, limit).map(r => ({
      id: String(r.id),
      at: String(r.at),
      actor: r.actor as Activity["actor"],
      action: String(r.action),
      detail: String(r.detail),
      ...(r.ref_type ? { ref: { type: String(r.ref_type), id: String(r.ref_id) } } : {}),
    }));
  }

  // Chats ----------------------------------------------------------------------------------

  chats(ws: string): ChatSummary[] {
    return this.all("SELECT id, title, updated_at FROM chats WHERE workspace_id = ? ORDER BY updated_at DESC", ws).map(r => ({
      id: String(r.id),
      title: String(r.title),
      updatedAt: String(r.updated_at),
    }));
  }

  chat(ws: string, id: string): ChatSummary | undefined {
    const r = this.get("SELECT id, title, updated_at FROM chats WHERE workspace_id = ? AND id = ?", ws, id);
    return r ? { id: String(r.id), title: String(r.title), updatedAt: String(r.updated_at) } : undefined;
  }

  createChat(ws: string, title = "New chat"): ChatSummary {
    const id = randomUUID();
    const at = now();
    this.run("INSERT INTO chats (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, ws, title, at, at);
    return { id, title, updatedAt: at };
  }

  renameChat(ws: string, id: string, title: string): void {
    this.run("UPDATE chats SET title = ? WHERE workspace_id = ? AND id = ?", title, ws, id);
  }

  deleteChat(ws: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM chats WHERE workspace_id = ? AND id = ?").run(ws, id).changes) > 0;
  }

  messages(chatId: string): StoredMessage[] {
    return this.all("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY seq", chatId).map(r => ({
      id: String(r.id),
      role: r.role as StoredMessage["role"],
      text: String(r.text),
      content: json<unknown[]>(r.content_json, []),
      ...(r.attachments_json ? { attachments: json(r.attachments_json, []) } : {}),
      ...(r.tools_json ? { tools: json(r.tools_json, []) } : {}),
      createdAt: String(r.created_at),
    }));
  }

  addMessage(chatId: string, m: Omit<StoredMessage, "id" | "createdAt">): StoredMessage {
    const id = randomUUID();
    const at = now();
    const seq = Number(this.get("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM chat_messages WHERE chat_id = ?", chatId)!.n);
    this.run(
      "INSERT INTO chat_messages (id, chat_id, seq, role, text, content_json, attachments_json, tools_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      chatId,
      seq,
      m.role,
      m.text,
      JSON.stringify(m.content),
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.tools ? JSON.stringify(m.tools) : null,
      at,
    );
    this.run("UPDATE chats SET updated_at = ? WHERE id = ?", at, chatId);
    return { id, createdAt: at, ...m };
  }

  // AI usage (cost guard) ------------------------------------------------------------------

  /** Counts one model call for today; false once the daily limit is reached (nothing counted). */
  takeAiCall(ws: string, dailyLimit: number): boolean {
    const day = now().slice(0, 10);
    const used = Number(this.get("SELECT calls FROM ai_usage WHERE workspace_id = ? AND day = ?", ws, day)?.calls ?? 0);
    if (used >= dailyLimit) return false;
    this.run(
      "INSERT INTO ai_usage (workspace_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (workspace_id, day) DO UPDATE SET calls = calls + 1",
      ws,
      day,
    );
    return true;
  }
}

function toWorkspace(r: Row): Workspace {
  return {
    id: String(r.id),
    name: String(r.name),
    baseCurrency: "USD",
    autonomy: r.autonomy as Autonomy,
    limits: {
      perPaymentUsdMinor: Number(r.per_payment_usd_minor),
      monthlyUsdMinor: Number(r.monthly_usd_minor),
      knownPayeesOnly: Number(r.known_payees_only) === 1,
    },
    createdAt: String(r.created_at),
  };
}

function toConnection(r: Row): ConnectionRow {
  return {
    id: String(r.id),
    kind: r.kind as ConnectionKind,
    label: String(r.label),
    network: String(r.network),
    address: opt(r.address as string | null),
    access: r.access as Access,
    balances: json<Balance[]>(r.balances_json, []),
    error: opt(r.error as string | null),
    refreshedAt: opt(r.refreshed_at as string | null),
    createdAt: String(r.created_at),
  };
}

function toDocument(r: Row): DocumentRow {
  return {
    id: String(r.id),
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    size: Number(r.size),
    source: r.source as DocumentRow["source"],
    status: r.status as DocumentRow["status"],
    kind: opt(r.kind as DocumentKind | null),
    title: opt(r.title as string | null),
    summary: opt(r.summary as string | null),
    counterparty: opt(r.counterparty as string | null),
    amountMinor: r.amount_minor === null ? undefined : Number(r.amount_minor),
    currency: opt(r.currency as string | null),
    issueDate: opt(r.issue_date as string | null),
    dueDate: opt(r.due_date as string | null),
    category: opt(r.category as string | null),
    extracted: r.extracted_json ? json<Record<string, unknown>>(r.extracted_json, {}) : undefined,
    error: opt(r.error as string | null),
    createdAt: String(r.created_at),
  };
}

function toTransaction(r: Row): Transaction {
  return {
    id: String(r.id),
    date: String(r.date),
    description: String(r.description),
    counterparty: opt(r.counterparty as string | null),
    category: String(r.category),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    usdMinor: Number(r.usd_minor),
    source: r.source as Transaction["source"],
    documentId: opt(r.document_id as string | null),
  };
}

function toPayee(r: Row): Payee {
  return {
    id: String(r.id),
    name: String(r.name),
    country: opt(r.country as string | null),
    iban: opt(r.iban as string | null),
    bic: opt(r.bic as string | null),
    routingNumber: opt(r.routing_number as string | null),
    accountNumber: opt(r.account_number as string | null),
    accountType: opt(r.account_type as Payee["accountType"] | null),
    cardanoAddress: opt(r.cardano_address as string | null),
    createdAt: String(r.created_at),
  };
}

function toBudget(r: Row): BudgetRow {
  return { id: String(r.id), name: String(r.name), category: String(r.category), limitUsdMinor: Number(r.limit_usd_minor), createdAt: String(r.created_at) };
}

function toPayment(r: Row): Payment {
  return {
    id: String(r.id),
    payeeName: String(r.payee_name),
    payeeId: opt(r.payee_id as string | null),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    usdMinor: Number(r.usd_minor),
    rail: r.rail as Rail,
    reason: String(r.reason),
    documentId: opt(r.document_id as string | null),
    status: r.status as PaymentStatus,
    requestedBy: r.requested_by as Payment["requestedBy"],
    policy: json<PolicyDecision>(r.policy_json, { decision: "blocked", checks: [] }),
    runId: opt(r.run_id as string | null),
    txHash: opt(r.tx_hash as string | null),
    explorerUrl: opt(r.explorer_url as string | null),
    reference: opt(r.reference as string | null),
    error: opt(r.error as string | null),
    createdAt: String(r.created_at),
    decidedAt: opt(r.decided_at as string | null),
    executedAt: opt(r.executed_at as string | null),
  };
}
