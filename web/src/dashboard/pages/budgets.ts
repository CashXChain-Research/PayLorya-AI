// Budgets & planning: monthly budgets per category, this month's transactions by category, forecast.
import { esc } from "../../shared/dom.js";
import { del, get, patch, post } from "../api.js";
import { forecastChart, mountChart } from "../charts.js";
import type { Ctx } from "../state.js";
import type { Budget, BudgetInput, Forecast, Transaction } from "../types.js";
import { amount, confirmDialog, date, dialog, empty, fieldError, icon, monthLabel, pageHead, sk, skCard, skLines, toast, toMinor, usd, val } from "../ui.js";

const DEFAULT_CATEGORIES = ["Software", "Payroll", "Rent", "Marketing", "Travel", "Hosting", "Contractors", "Office", "Legal & accounting", "Taxes"];

async function budgetDialog(existing: Budget | null, categories: string[]): Promise<Budget | null> {
  let saved: Budget | null = null;
  const cats = [...new Set([...categories, ...DEFAULT_CATEGORIES])].sort();
  await dialog({
    title: existing ? "Edit budget" : "New budget",
    submit: existing ? "Save budget" : "Create budget",
    body: `<div class="field"><label for="b-name">Name</label><input id="b-name" name="name" value="${esc(existing?.name ?? "")}" placeholder="Software subscriptions" autocomplete="off"></div>
      <div class="grid2">
        <div class="field"><label for="b-cat">Category</label><input id="b-cat" name="category" list="b-cats" value="${esc(existing?.category ?? "")}" placeholder="Software" autocomplete="off"><datalist id="b-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="field"><label for="b-limit">Monthly limit (USD)</label><div class="affix"><span>$</span><input id="b-limit" name="limit" inputmode="decimal" value="${existing ? existing.limitUsdMinor / 100 : ""}" placeholder="2,000"></div></div>
      </div>
      <p class="fine">Spending is matched by transaction category. The AI CFO warns you before a payment would push a budget over.</p>`,
    onSubmit: async form => {
      const name = val(form, "name");
      const category = val(form, "category");
      const limitUsdMinor = toMinor(val(form, "limit"), "USD");
      if (!name) return fieldError(form, "name", "Give the budget a name.");
      if (!category) return fieldError(form, "category", "Choose a category.");
      if (!Number.isFinite(limitUsdMinor) || limitUsdMinor <= 0) return fieldError(form, "limit", "Enter a monthly limit above zero.");
      const body: BudgetInput = { name, category, limitUsdMinor };
      saved = existing ? await patch<Budget>(`/api/v1/budgets/${encodeURIComponent(existing.id)}`, body) : await post<Budget>("/api/v1/budgets", body);
      toast(existing ? "Budget saved" : "Budget created", "ok");
      return true;
    },
  });
  return saved;
}

function budgetCard(b: Budget, i: number): string {
  const pct = b.limitUsdMinor ? (b.spentUsdMinor / b.limitUsdMinor) * 100 : 0;
  const over = pct > 100;
  const warn = !over && pct >= 85;
  const left = b.limitUsdMinor - b.spentUsdMinor;
  return `<article class="card bud-card reveal ${over ? "over" : warn ? "warn" : ""}" style="--d:${i * 40}ms">
    <div class="bc-head"><div><h3>${esc(b.name)}</h3>${b.category.toLowerCase() === b.name.toLowerCase() ? `<span class="muted small">Monthly budget</span>` : `<span class="cat">${esc(b.category)}</span>`}</div>
      <div class="bc-act"><button class="icon-btn" type="button" data-edit="${esc(b.id)}" aria-label="Edit ${esc(b.name)}">${icon("edit", 16)}</button><button class="icon-btn danger-h" type="button" data-del="${esc(b.id)}" aria-label="Delete ${esc(b.name)}">${icon("trash", 16)}</button></div></div>
    <div class="bc-num"><b>${esc(usd(b.spentUsdMinor, { cents: false }))}</b><span>of ${esc(usd(b.limitUsdMinor, { cents: false }))} this month</span></div>
    <div class="meter lg"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
    <div class="bc-foot">${over ? `<span class="over-l">${icon("alert", 13, 2.4)}Over budget by ${esc(usd(-left, { cents: false }))}</span>` : warn ? `<span class="warn-l">${icon("alert", 13, 2.4)}${Math.round(pct)}% used · ${esc(usd(left, { cents: false }))} left</span>` : `<span>${Math.round(pct)}% used</span><span>${esc(usd(left, { cents: false }))} left</span>`}</div>
  </article>`;
}

export async function renderBudgets(view: HTMLElement, ctx: Ctx): Promise<void> {
  const now = new Date();
  let month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = month;
  let budgets: Budget[] = [];
  let txs: Transaction[] = [];

  view.innerHTML = `${pageHead("Budgets & planning", "Monthly limits per category, where the money went, and where your cash is heading.", `<button class="btn primary sm" type="button" id="b-new">${icon("plus", 16, 2.4)}New budget</button>`)}
    <section class="stat-row" id="b-stats">${Array.from({ length: 3 }, () => `<div class="stat-card">${sk("50%", 12)}<div style="height:10px"></div>${sk("60%", 26)}</div>`).join("")}</section>
    <section class="bud-grid" id="b-grid">${skCard(160)}${skCard(160)}${skCard(160)}</section>
    <section class="card chart-card"><div class="card-head"><div><h2>Cash forecast</h2><p class="muted small">Next 90 days · indicative USD</p></div><div class="fc-legend"><span class="lg-in">Inflow</span><span class="lg-out">Outflow</span></div></div><div class="chart-wrap"><div class="chart" id="b-fc">${sk("100%", 240, 14)}</div></div></section>
    <section class="card">
      <div class="card-head"><div><h2>Transactions by category</h2><p class="muted small" id="tx-sub">&nbsp;</p></div>
        <div class="month-nav"><button class="icon-btn" type="button" id="m-prev" aria-label="Previous month">${icon("chevronLeft", 16)}</button><b id="m-label"></b><button class="icon-btn" type="button" id="m-next" aria-label="Next month">${icon("chevron", 16)}</button></div></div>
      <div id="tx-groups">${skLines(5)}</div>
    </section>`;

  const paintBudgets = () => {
    const grid = view.querySelector<HTMLElement>("#b-grid")!;
    const total = budgets.reduce((a, b) => a + b.limitUsdMinor, 0);
    const spent = budgets.reduce((a, b) => a + b.spentUsdMinor, 0);
    const over = budgets.filter(b => b.spentUsdMinor > b.limitUsdMinor);
    view.querySelector("#b-stats")!.innerHTML = `
      <div class="stat-card"><span class="label">Budgeted this month</span><b>${esc(usd(total, { cents: false }))}</b><span class="sub">${budgets.length} budget${budgets.length === 1 ? "" : "s"}</span></div>
      <div class="stat-card"><span class="label">Spent against budgets</span><b>${esc(usd(spent, { cents: false }))}</b><div class="meter ${spent > total ? "hot" : ""}"><i style="width:${total ? Math.min(100, (spent / total) * 100).toFixed(1) : 0}%"></i></div></div>
      <div class="stat-card ${over.length ? "attn-bad" : ""}"><span class="label">Over budget</span><b>${over.length}</b><span class="sub">${over.length ? esc(over.map(b => b.name).join(", ")) : "Everything on track"}</span></div>`;
    grid.innerHTML = budgets.length
      ? budgets.map(budgetCard).join("")
      : `<div class="card wide-empty">${empty({ icon: "budget", title: "No budgets yet", text: "Set a monthly limit per category. Your AI CFO tracks spending against it and warns before a payment would go over.", action: `<button class="btn primary sm" type="button" data-new>${icon("plus", 15, 2.4)}Create your first budget</button>` })}</div>`;
  };

  const paintTx = () => {
    view.querySelector("#m-label")!.textContent = monthLabel(month, true);
    (view.querySelector("#m-next") as HTMLButtonElement).disabled = month >= thisMonth;
    const el = view.querySelector<HTMLElement>("#tx-groups")!;
    const out = txs.filter(t => t.usdMinor < 0).reduce((a, t) => a - t.usdMinor, 0);
    const inn = txs.filter(t => t.usdMinor > 0).reduce((a, t) => a + t.usdMinor, 0);
    view.querySelector("#tx-sub")!.innerHTML = txs.length ? `${txs.length} transactions · <b class="pos">${esc(usd(inn, { sign: true, cents: false }))}</b> in · <b>${esc(usd(-out, { cents: false }))}</b> out` : "No transactions";
    if (!txs.length) {
      el.innerHTML = empty({ icon: "activity", title: `Nothing recorded in ${monthLabel(month, true)}`, text: "Transactions come from processed documents, payments and connected accounts." });
      return;
    }
    const groups = new Map<string, Transaction[]>();
    for (const t of txs) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
    const budgetBy = new Map(budgets.map(b => [b.category.toLowerCase(), b]));
    const sorted = [...groups.entries()].sort((a, b) => a[1].reduce((s, t) => s + t.usdMinor, 0) - b[1].reduce((s, t) => s + t.usdMinor, 0));
    el.innerHTML = `<div class="tx-groups">${sorted
      .map(([cat, list]) => {
        const sum = list.reduce((s, t) => s + t.usdMinor, 0);
        const b = budgetBy.get(cat.toLowerCase());
        return `<details class="txg"${sorted.length <= 3 ? " open" : ""}><summary><span class="chev">${icon("chevron", 14)}</span><b>${esc(cat)}</b><em>${list.length}</em>${b && month === thisMonth ? `<span class="pill ${b.spentUsdMinor > b.limitUsdMinor ? "t-bad" : "t-neutral"}">Budget ${esc(usd(b.limitUsdMinor, { cents: false }))}</span>` : ""}<span class="txg-sum ${sum > 0 ? "pos" : ""}">${esc(usd(sum, { sign: sum > 0 }))}</span></summary>
          <ul>${list
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(
              t => `<li><span class="tx-d">${esc(date(t.date))}</span><span class="tx-desc"><b>${esc(t.description)}</b>${t.counterparty ? `<span>${esc(t.counterparty)}</span>` : ""}</span>${t.documentId ? `<a class="tx-doc" href="/app/documents/${esc(t.documentId)}" title="Open source document">${icon("doc", 14)}</a>` : `<span class="tx-src">${esc(t.source)}</span>`}<span class="tx-amt ${t.amountMinor > 0 ? "pos" : ""}">${esc(amount(t.amountMinor, t.currency))}${t.currency !== "USD" ? `<em>≈ ${esc(usd(t.usdMinor))}</em>` : ""}</span></li>`,
            )
            .join("")}</ul></details>`;
      })
      .join("")}</div>`;
  };

  const loadTx = async () => {
    view.querySelector<HTMLElement>("#tx-groups")!.innerHTML = skLines(4);
    txs = await get<Transaction[]>(`/api/v1/transactions?month=${month}`);
    if (!ctx.alive()) return;
    paintTx();
  };
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y!, m! - 1 + n, 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    void loadTx().catch(() => undefined);
  };
  view.querySelector("#m-prev")!.addEventListener("click", () => shift(-1));
  view.querySelector("#m-next")!.addEventListener("click", () => shift(1));

  const categories = () => [...new Set([...txs.map(t => t.category), ...budgets.map(b => b.category)])];
  view.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    if (t.closest("#b-new, [data-new]")) {
      const b = await budgetDialog(null, categories());
      if (b && ctx.alive()) {
        budgets.push(b);
        paintBudgets();
      }
    }
    const ed = t.closest<HTMLElement>("[data-edit]");
    if (ed) {
      const cur = budgets.find(b => b.id === ed.dataset.edit);
      const b = cur && (await budgetDialog(cur, categories()));
      if (b && ctx.alive()) {
        budgets = budgets.map(x => (x.id === b.id ? b : x));
        paintBudgets();
      }
    }
    const dl = t.closest<HTMLElement>("[data-del]");
    if (dl) {
      const cur = budgets.find(b => b.id === dl.dataset.del);
      if (!cur || !(await confirmDialog("Delete budget?", `“${cur.name}” will be removed. Transactions are not affected.`, "Delete", true))) return;
      try {
        await del(`/api/v1/budgets/${encodeURIComponent(cur.id)}`);
        budgets = budgets.filter(b => b.id !== cur.id);
        paintBudgets();
        toast("Budget deleted", "ok");
      } catch {
        // toast shown
      }
    }
  });

  const [b, , fc] = await Promise.all([get<Budget[]>("/api/v1/budgets"), loadTx(), get<Forecast>("/api/v1/forecast?days=90", true).catch(() => null)]);
  if (!ctx.alive()) return;
  budgets = b;
  paintBudgets();
  paintTx();
  const fcEl = view.querySelector<HTMLElement>("#b-fc")!;
  if (fc) {
    const c = forecastChart(fc, 240);
    ctx.onCleanup(mountChart(fcEl, c.draw, c.wire));
  } else fcEl.innerHTML = `<div class="chart-empty">Forecast unavailable right now.</div>`;
}
