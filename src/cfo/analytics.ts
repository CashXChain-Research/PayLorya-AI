import { toUsdMinor } from "./fx.js";
import type { BudgetRow, ConnectionRow, DocumentRow, Payment, Store, Transaction } from "./store.js";

const today = () => new Date().toISOString().slice(0, 10);
const monthOf = (date: string) => date.slice(0, 7);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthsBack(n: number): string[] {
  const d = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

export interface Budget extends BudgetRow {
  spentUsdMinor: number;
}

/** Budgets with this month's spend (money out in the budget's category). */
export async function budgetsWithSpend(store: Store, ws: string): Promise<Budget[]> {
  const month = monthOf(today());
  const [txs, budgets] = await Promise.all([store.transactions(ws, { from: `${month}-01`, to: `${month}-31` }), store.budgets(ws)]);
  return withSpend(budgets, txs);
}

function withSpend(budgets: BudgetRow[], txs: Transaction[]): Budget[] {
  const month = monthOf(today());
  const spend = new Map<string, number>();
  for (const t of txs) {
    if (monthOf(t.date) === month && t.usdMinor < 0) spend.set(t.category, (spend.get(t.category) ?? 0) - t.usdMinor);
  }
  return budgets.map(b => ({ ...b, spentUsdMinor: spend.get(b.category) ?? 0 }));
}

/** Invoices with a direction, not yet paid through the CFO. */
export async function openInvoices(store: Store, ws: string, direction: "money_out" | "money_in"): Promise<DocumentRow[]> {
  const [docs, payments] = await Promise.all([store.documents(ws), store.payments(ws)]);
  return unpaid(docs, payments, direction);
}

function unpaid(docs: DocumentRow[], payments: Payment[], direction: "money_out" | "money_in"): DocumentRow[] {
  const paid = new Set(payments.filter(p => p.status === "executed" || p.status === "executing").map(p => p.documentId));
  return docs
    .filter(d => d.status === "processed" && d.kind === "invoice" && d.amountMinor && d.currency && !paid.has(d.id))
    .filter(d => (d.extracted?.direction ?? "money_out") === direction)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

function cash(connections: ConnectionRow[]) {
  const rows = connections.map(c => ({
    id: c.id,
    label: c.label,
    usdMinor: c.balances.reduce((sum, b) => sum + (b.usdMinor ?? 0), 0),
    balances: c.balances,
  }));
  return { totalUsdMinor: rows.reduce((sum, c) => sum + c.usdMinor, 0), connections: rows };
}

export async function cashPosition(store: Store, ws: string) {
  return cash(await store.connections(ws));
}

/** Everything the overview needs, loaded in parallel: one database round trip of latency, not ten. */
async function snapshot(store: Store, ws: string) {
  const months = monthsBack(6);
  const [workspace, txs, payments, docs, connections, budgets, executed] = await Promise.all([
    store.workspace(ws),
    store.transactions(ws, { from: `${months[0]}-01` }),
    store.payments(ws),
    store.documents(ws),
    store.connections(ws),
    store.budgets(ws),
    store.agentExecutedSince(ws, `${monthOf(today())}-01T00:00:00.000Z`),
  ]);
  return { months, workspace: workspace!, txs, payments, docs, connections, budgets, executed };
}

export async function overview(store: Store, ws: string) {
  const { months, workspace, txs, payments, docs, connections, budgets, executed } = await snapshot(store, ws);
  const month = monthOf(today());

  const byCategory = new Map<string, number>();
  const monthly = new Map(months.map(m => [m, { month: m, inUsdMinor: 0, outUsdMinor: 0 }]));
  for (const t of txs) {
    const m = monthly.get(monthOf(t.date));
    if (m) {
      if (t.usdMinor >= 0) m.inUsdMinor += t.usdMinor;
      else m.outUsdMinor -= t.usdMinor;
    }
    if (monthOf(t.date) === month && t.usdMinor < 0) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - t.usdMinor);
  }

  const payables = unpaid(docs, payments, "money_out");
  const pending = payments.filter(p => p.status === "pending_approval");
  return {
    workspace,
    cash: cash(connections),
    payables: {
      count: payables.length,
      totalUsdMinor: payables.reduce((sum, d) => sum + toUsdMinor(d.amountMinor!, d.currency!), 0),
      upcoming: payables.slice(0, 8),
    },
    approvals: { count: pending.length, payments: pending.slice(0, 8) },
    spendByCategory: [...byCategory].map(([category, usdMinor]) => ({ category, usdMinor })).sort((a, b) => b.usdMinor - a.usdMinor),
    monthly: [...monthly.values()],
    budgets: withSpend(budgets, txs),
    agent: { autonomy: workspace.autonomy, executedThisMonthUsdMinor: executed, limits: workspace.limits },
    documents: { total: docs.length, processing: docs.filter(d => d.status === "processing").length },
  };
}

/**
 * Cash forecast: today's connected balances, minus open payables on their due dates, plus open
 * receivables. Overdue items land today. Deterministic; no model involved.
 */
export async function forecast(store: Store, ws: string, days: number) {
  const [docs, payments, connections] = await Promise.all([store.documents(ws), store.payments(ws), store.connections(ws)]);
  const start = today();
  const end = addDays(start, days);
  const events: Array<{ date: string; label: string; usdMinor: number; documentId?: string }> = [];
  for (const [direction, sign] of [["money_out", -1], ["money_in", 1]] as const) {
    for (const d of unpaid(docs, payments, direction)) {
      const date = !d.dueDate || d.dueDate < start ? start : d.dueDate;
      if (date > end) continue;
      events.push({ date, label: `${sign < 0 ? "Pay" : "Receive"} ${d.counterparty ?? d.title ?? d.filename}`, usdMinor: sign * toUsdMinor(d.amountMinor!, d.currency!), documentId: d.id });
    }
  }
  for (const p of payments.filter(p => p.status === "pending_approval" && !p.documentId)) {
    events.push({ date: start, label: `Pending payment to ${p.payeeName}`, usdMinor: -p.usdMinor });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const startUsdMinor = cash(connections).totalUsdMinor;
  const points: Array<{ date: string; balanceUsdMinor: number }> = [];
  let balance = startUsdMinor;
  let i = 0;
  for (let day = 0; day <= days; day++) {
    const date = addDays(start, day);
    while (i < events.length && events[i]!.date === date) balance += events[i++]!.usdMinor;
    points.push({ date, balanceUsdMinor: balance });
  }
  return { days, startUsdMinor, points, events };
}
