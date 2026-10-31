import { toUsdMinor } from "./fx.js";
import type { BudgetRow, DocumentRow, Store } from "./store.js";

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
export function budgetsWithSpend(store: Store, ws: string): Budget[] {
  const month = monthOf(today());
  const spend = new Map<string, number>();
  for (const t of store.transactions(ws, { from: `${month}-01`, to: `${month}-31` })) {
    if (t.usdMinor < 0) spend.set(t.category, (spend.get(t.category) ?? 0) - t.usdMinor);
  }
  return store.budgets(ws).map(b => ({ ...b, spentUsdMinor: spend.get(b.category) ?? 0 }));
}

/** Invoices with a direction, not yet paid through the CFO. */
export function openInvoices(store: Store, ws: string, direction: "money_out" | "money_in"): DocumentRow[] {
  const paid = new Set(store.payments(ws).filter(p => p.status === "executed" || p.status === "executing").map(p => p.documentId));
  return store
    .documents(ws)
    .filter(d => d.status === "processed" && d.kind === "invoice" && d.amountMinor && d.currency && !paid.has(d.id))
    .filter(d => (d.extracted?.direction ?? "money_out") === direction)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

export function cashPosition(store: Store, ws: string) {
  const connections = store.connections(ws).map(c => ({
    id: c.id,
    label: c.label,
    usdMinor: c.balances.reduce((sum, b) => sum + (b.usdMinor ?? 0), 0),
    balances: c.balances,
  }));
  return { totalUsdMinor: connections.reduce((sum, c) => sum + c.usdMinor, 0), connections };
}

export function overview(store: Store, ws: string) {
  const workspace = store.workspace(ws)!;
  const month = monthOf(today());
  const months = monthsBack(6);
  const txs = store.transactions(ws, { from: `${months[0]}-01` });

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

  const payables = openInvoices(store, ws, "money_out");
  const pending = store.payments(ws).filter(p => p.status === "pending_approval");
  const docs = store.documents(ws);
  return {
    workspace,
    cash: cashPosition(store, ws),
    payables: {
      count: payables.length,
      totalUsdMinor: payables.reduce((sum, d) => sum + toUsdMinor(d.amountMinor!, d.currency!), 0),
      upcoming: payables.slice(0, 8),
    },
    approvals: { count: pending.length, payments: pending.slice(0, 8) },
    spendByCategory: [...byCategory].map(([category, usdMinor]) => ({ category, usdMinor })).sort((a, b) => b.usdMinor - a.usdMinor),
    monthly: [...monthly.values()],
    budgets: budgetsWithSpend(store, ws),
    agent: {
      autonomy: workspace.autonomy,
      executedThisMonthUsdMinor: store.agentExecutedSince(ws, `${month}-01T00:00:00.000Z`),
      limits: workspace.limits,
    },
    documents: { total: docs.length, processing: docs.filter(d => d.status === "processing").length },
  };
}

/**
 * Cash forecast: today's connected balances, minus open payables on their due dates, plus open
 * receivables. Overdue items land today. Deterministic; no model involved.
 */
export function forecast(store: Store, ws: string, days: number) {
  const start = today();
  const end = addDays(start, days);
  const events: Array<{ date: string; label: string; usdMinor: number; documentId?: string }> = [];
  for (const [direction, sign] of [["money_out", -1], ["money_in", 1]] as const) {
    for (const d of openInvoices(store, ws, direction)) {
      const date = !d.dueDate || d.dueDate < start ? start : d.dueDate;
      if (date > end) continue;
      events.push({ date, label: `${sign < 0 ? "Pay" : "Receive"} ${d.counterparty ?? d.title ?? d.filename}`, usdMinor: sign * toUsdMinor(d.amountMinor!, d.currency!), documentId: d.id });
    }
  }
  for (const p of store.payments(ws).filter(p => p.status === "pending_approval" && !p.documentId)) {
    events.push({ date: start, label: `Pending payment to ${p.payeeName}`, usdMinor: -p.usdMinor });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const startUsdMinor = cashPosition(store, ws).totalUsdMinor;
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
