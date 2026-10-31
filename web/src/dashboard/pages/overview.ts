// Overview: Ask box, a "Today" strip, what needs you (approvals + invoices due soon), one cash card
// with tabs (forecast, in/out, categories), then budgets and cash by connection.
import { esc } from "../../shared/dom.js";
import { get } from "../api.js";
import { categoryBars, forecastChart, inOutChart, mountChart } from "../charts.js";
import { askCfo, type Ctx, state } from "../state.js";
import type { DocumentSummary, Forecast, Me, Overview, Payment } from "../types.js";
import { amount, AUTONOMY, avatar, balance, date, daysUntil, dueLabel, empty, icon, monthLabel, sk, skCard, usd } from "../ui.js";
import { decide } from "./payments.js";

const SUGGEST = ["Summarise my spending this month", "Which invoices are due in the next 14 days?", "Forecast my cash for the next 90 days"];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function budgetRow(b: Overview["budgets"][number]): string {
  const pct = b.limitUsdMinor ? (b.spentUsdMinor / b.limitUsdMinor) * 100 : 0;
  const over = pct > 100;
  const warn = !over && pct >= 85;
  return `<li class="bud ${over ? "over" : warn ? "warn" : ""}">
    <div class="bud-top"><b>${esc(b.name)}</b><span>${esc(usd(b.spentUsdMinor, { cents: false }))} <em>of ${esc(usd(b.limitUsdMinor, { cents: false }))}</em></span></div>
    <div class="meter"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
    <div class="bud-sub"><span>${b.category.toLowerCase() === b.name.toLowerCase() ? "" : esc(b.category)}</span>${over ? `<span class="over-l">${icon("alert", 12, 2.4)}${esc(usd(b.spentUsdMinor - b.limitUsdMinor, { cents: false }))} over</span>` : `<span>${Math.round(pct)}% used</span>`}</div>
  </li>`;
}

/** Open invoices due within this many days (or overdue) count as "needs you". */
const DUE_SOON_DAYS = 14;

function dueItem(d: DocumentSummary): string {
  const due = dueLabel(d.dueDate);
  return `<li><a href="/app/documents/${esc(d.id)}"><div><b>${esc(d.counterparty || d.title || d.filename)}</b><span>${esc(d.title || d.filename)}</span></div><div class="due-r"><b>${esc(amount(d.amountMinor, d.currency))}</b><span class="pill ${due.tone}">${esc(due.text)}</span></div></a></li>`;
}

const needsText = (n: number): string => (n ? `${n} thing${n === 1 ? " needs" : "s need"} you.` : "Nothing needs you right now.");

const CAUGHT_UP = `<div class="attn-empty">${empty({ icon: "shieldCheck", title: "All caught up", text: `Nothing to approve and no invoices due in the next ${DUE_SOON_DAYS} days.` })}</div>`;

function approvalItem(p: Payment): string {
  return `<li class="ap" data-row="${esc(p.id)}">
    ${avatar(p.payeeName)}
    <a class="ap-who" href="/app/payments?id=${esc(p.id)}"><b>${esc(p.payeeName)}</b><span>${esc(p.reason)}</span></a>
    <div class="ap-amt"><b>${esc(amount(p.amountMinor, p.currency))}</b><span>${p.requestedBy === "agent" ? "Agent" : "You"} · ${esc(p.rail === "cardano_preprod" ? "Preprod testnet" : p.rail === "cashxchain" ? "Sandbox" : "Manual")}</span></div>
    <span class="decide"><button type="button" class="btn ghost xs" data-act="reject" data-pid="${esc(p.id)}" aria-label="Reject payment to ${esc(p.payeeName)}">${icon("x", 14, 2.4)}</button><button type="button" class="btn primary xs" data-act="approve" data-pid="${esc(p.id)}">${icon("check", 14, 2.6)}Approve</button></span>
  </li>`;
}

export async function renderOverview(view: HTMLElement, ctx: Ctx): Promise<void> {
  const name = state.me?.user.name?.split(" ")[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  view.innerHTML = `
  <header class="page-head"><div class="page-title"><h1>${esc(greeting())}${name ? `, ${esc(name)}` : ""}</h1><p>${esc(today)} · <span id="ov-needs">Here is where your business stands.</span></p></div>
    <div class="page-actions"><a class="btn ghost sm" href="/app/documents">${icon("upload", 16)}Upload</a><span id="ov-agent"></span></div></header>
  <form class="ask reveal" id="ask">
    <span class="ask-ic">${icon("sparkle", 20)}</span>
    <input id="ask-in" name="q" autocomplete="off" placeholder="Ask your AI CFO anything about your money…" aria-label="Ask your AI CFO">
    <button class="btn primary sm" type="submit">Ask${icon("arrowRight", 15, 2.2)}</button>
    <div class="ask-chips">${SUGGEST.map(s => `<button type="button" class="opt" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
  </form>
  <div id="ov-body">
    <section class="today">${Array.from({ length: 3 }, () => `<div class="today-item">${sk("50%", 12)}<div style="height:10px"></div>${sk("70%", 24)}</div>`).join("")}</section>
    <section class="ov-grid">${skCard(340)}${skCard(340)}</section>
  </div>`;

  const form = view.querySelector<HTMLFormElement>("#ask")!;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const q = (view.querySelector<HTMLInputElement>("#ask-in")!.value || "").trim();
    if (q) askCfo(q);
    else view.querySelector<HTMLInputElement>("#ask-in")!.focus();
  });
  for (const b of view.querySelectorAll<HTMLButtonElement>("[data-q]")) b.addEventListener("click", () => askCfo(b.dataset.q!));

  if (!name) {
    void get<Me>("/api/v1/me", true)
      .then(me => {
        const first = me.user.name?.split(" ")[0];
        const h1 = view.querySelector(".page-head h1");
        if (first && h1 && ctx.alive()) h1.textContent = `${greeting()}, ${first}`;
      })
      .catch(() => undefined);
  }
  const [ov, fc] = await Promise.all([get<Overview>("/api/v1/overview"), get<Forecast>("/api/v1/forecast?days=90", true).catch(() => null)]);
  if (!ctx.alive()) return;
  const body = view.querySelector<HTMLElement>("#ov-body")!;
  const isNew = ov.cash.connections.length === 0 && ov.documents.total === 0;
  const a = ov.agent;
  const thisMonth = ov.monthly[ov.monthly.length - 1];
  const spendTotal = ov.spendByCategory.reduce((s, r) => s + r.usdMinor, 0);
  const approvalsUsd = ov.approvals.payments.reduce((s, p) => s + p.usdMinor, 0);
  const dueSoon = ov.payables.upcoming.filter(d => {
    const n = daysUntil(d.dueDate);
    return n != null && n <= DUE_SOON_DAYS;
  });
  let needs = ov.approvals.count + dueSoon.length;
  const nextDue = ov.payables.upcoming.find(d => d.dueDate);

  view.querySelector("#ov-needs")!.textContent = needsText(needs);
  const usedPct = a.limits.monthlyUsdMinor ? Math.min(100, (a.executedThisMonthUsdMinor / a.limits.monthlyUsdMinor) * 100) : 0;
  view.querySelector("#ov-agent")!.outerHTML = `<a class="agent-chip a-${a.autonomy}" href="/app/agent" title="What your agent may do on its own"><i></i><b>${esc(AUTONOMY[a.autonomy].name)}</b><span>${
    a.autonomy === "read_only" ? "drafts only" : `${esc(usd(a.executedThisMonthUsdMinor, { cents: false }))} of ${esc(usd(a.limits.monthlyUsdMinor, { cents: false }))}`
  }</span>${a.autonomy === "read_only" ? "" : `<span class="chip-meter ${usedPct >= 90 ? "hot" : ""}"><i style="width:${usedPct.toFixed(1)}%"></i></span>`}</a>`;

  const onboarding = isNew
    ? `<section class="card onboard reveal"><div class="onboard-head"><h2>Set up your AI CFO</h2><p class="muted">Three steps and your AI CFO has the full picture. It reads; code enforces your rules; you approve what moves.</p></div>
      <ol class="steps">
        <li><a href="/app/connections"><span class="step-n">1</span><span class="step-ic">${icon("wallet", 20)}</span><b>Connect a wallet or account</b><span>Add your Cardano agent wallet, a watch-only wallet or your CashXChain sandbox account.</span><em>Connect${icon("arrowRight", 14, 2.2)}</em></a></li>
        <li><a href="/app/documents"><span class="step-n">2</span><span class="step-ic">${icon("upload", 20)}</span><b>Upload financial documents</b><span>Invoices, receipts, bank statements, contracts. PDFs, photos, CSV.</span><em>Upload${icon("arrowRight", 14, 2.2)}</em></a></li>
        <li><a href="/app/agent"><span class="step-n">3</span><span class="step-ic">${icon("shield", 20)}</span><b>Decide what the agent may do</b><span>Start read-only. Move to guarded with limits when you are ready.</span><em>Review${icon("arrowRight", 14, 2.2)}</em></a></li>
      </ol></section>`
    : "";

  const conns = ov.cash.connections.length;
  body.innerHTML = `${onboarding}
  <section class="today reveal" aria-label="Today">
    <a class="today-item" href="/app/connections"><span class="label">${icon("wallet", 14)}Cash position</span><b>${esc(usd(ov.cash.totalUsdMinor, { cents: false }))}</b><span class="sub">${conns ? `across ${conns} connection${conns === 1 ? "" : "s"} · indicative USD` : "No connections yet"}</span></a>
    <a class="today-item ${ov.approvals.count ? "attn" : ""}" href="/app/payments" id="today-appr"><span class="label">${icon("shieldCheck", 14)}To approve</span><b>${ov.approvals.count}</b><span class="sub">${ov.approvals.count ? `${esc(usd(approvalsUsd, { cents: false }))} waiting for you` : "You're all caught up"}</span></a>
    <a class="today-item" href="/app/documents"><span class="label">${icon("calendar", 14)}Payables open</span><b>${esc(usd(ov.payables.totalUsdMinor, { cents: false }))}</b><span class="sub">${
      ov.payables.count ? `${ov.payables.count} unpaid${nextDue ? ` · next ${esc(date(nextDue.dueDate))}` : ""}` : "No open invoices"
    }</span></a>
  </section>

  <section class="ov-grid">
    <div class="card chart-card cash-card reveal" style="--d:80ms">
      <div class="card-head"><div><h2>Cash</h2><p class="muted small" id="cash-sub"></p></div>
        <div class="tabs" role="tablist" aria-label="Cash views">
          <button type="button" role="tab" data-tab="fc" aria-selected="true" aria-controls="tab-fc">Forecast</button>
          <button type="button" role="tab" data-tab="io" aria-selected="false" aria-controls="tab-io" tabindex="-1">In &amp; out</button>
          <button type="button" role="tab" data-tab="cat" aria-selected="false" aria-controls="tab-cat" tabindex="-1">By category</button>
        </div></div>
      <div class="tab-panel" id="tab-fc" role="tabpanel">
        ${fc ? `<div class="fc-legend"><span class="lg-in">Inflow</span><span class="lg-out">Outflow</span></div>` : ""}
        <div class="chart-wrap"><div class="chart" id="fc-chart"></div></div>
        ${fc && fc.events.length ? `<ul class="events">${fc.events.slice(0, 4).map(e => `<li>${e.documentId ? `<a href="/app/documents/${esc(e.documentId)}">` : "<span>"}<em class="${e.usdMinor < 0 ? "out" : "in"}"></em><span class="ev-d">${esc(date(e.date))}</span><span class="ev-l">${esc(e.label)}</span><b>${esc(usd(e.usdMinor, { sign: true, cents: false }))}</b>${e.documentId ? "</a>" : "</span>"}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="tab-panel" id="tab-io" role="tabpanel" hidden>
        <div class="fc-legend"><span class="lg-bin">In</span><span class="lg-bout">Out</span></div>
        <div class="chart" id="io-chart"></div>
      </div>
      <div class="tab-panel" id="tab-cat" role="tabpanel" hidden>
        ${ov.spendByCategory.length ? categoryBars(ov.spendByCategory) : empty({ icon: "budget", title: "No spending this month", text: "Upload receipts and statements and the agent categorises them for you." })}
        <a class="link-sm cat-more" href="/app/budgets">Budgets &amp; categories${icon("chevron", 14)}</a>
      </div>
    </div>
    <div class="card attn-card reveal" style="--d:120ms">
      <div class="card-head"><h2>Needs your attention</h2><a class="link-sm" href="/app/payments">All payments${icon("chevron", 14)}</a></div>
      <div id="ov-attn">${needs ? "" : CAUGHT_UP}
        ${ov.approvals.payments.length ? `<div class="attn-group" id="attn-appr"><div class="attn-label">To approve</div><ul class="ap-list" id="ov-appr">${ov.approvals.payments.slice(0, 4).map(approvalItem).join("")}</ul></div>` : ""}
        ${dueSoon.length ? `<div class="attn-group"><div class="attn-label">Due in the next ${DUE_SOON_DAYS} days</div><ul class="due-list">${dueSoon.slice(0, 4).map(dueItem).join("")}</ul></div>` : ""}
      </div>
    </div>
  </section>

  <section class="ov-grid even">
    <div class="card reveal">
      <div class="card-head"><h2>Budgets</h2><a class="link-sm" href="/app/budgets">Plan${icon("chevron", 14)}</a></div>
      ${ov.budgets.length ? `<ul class="bud-list">${ov.budgets.slice(0, 4).map(budgetRow).join("")}</ul>` : empty({ icon: "budget", title: "No budgets yet", text: "Set monthly limits per category. The agent warns you before you go over.", action: `<a class="btn ghost sm" href="/app/budgets">${icon("plus", 15, 2.4)}Create a budget</a>` })}
    </div>
    <div class="card reveal">
      <div class="card-head"><h2>Cash by connection</h2><a class="link-sm" href="/app/connections">Manage${icon("chevron", 14)}</a></div>
      ${conns ? `<ul class="conn-mini">${ov.cash.connections.map(c => `<li><span class="cm-ic">${icon("wallet", 16)}</span><div><b>${esc(c.label)}</b><span>${c.balances.map(b => esc(balance(b))).join(" · ") || "No balance"}</span></div><b class="num">${esc(usd(c.usdMinor, { cents: false }))}</b></li>`).join("")}</ul>` : empty({ icon: "link", title: "Connect your first wallet", text: "Your AI CFO needs at least one connection to see your cash.", action: `<a class="btn primary sm" href="/app/connections">${icon("plus", 15, 2.4)}Add connection</a>` })}
    </div>
  </section>
  ${ov.documents.processing ? `<p class="fine center">${icon("clock", 13)} ${ov.documents.processing} document${ov.documents.processing === 1 ? " is" : "s are"} still being read. Figures update when ${ov.documents.processing === 1 ? "it is" : "they are"} done.</p>` : ""}`;

  // Cash card: one card, three views. Charts mount the first time their tab is shown (they need a width).
  const net = thisMonth ? thisMonth.inUsdMinor - thisMonth.outUsdMinor : 0;
  const SUBS: Record<string, string> = {
    fc: `Next ${fc?.days ?? 90} days from balances and open invoices`,
    io: `Last 6 months, indicative USD${thisMonth ? ` · ${esc(monthLabel(thisMonth.month, true))} net <b class="${net < 0 ? "neg" : "pos"}">${esc(usd(net, { sign: true, cents: false }))}</b>` : ""}`,
    cat: `This month · ${esc(usd(spendTotal, { cents: false }))} out`,
  };
  const cashSub = view.querySelector<HTMLElement>("#cash-sub")!;
  const mounted = new Set<string>();
  const mount = (key: string) => {
    if (mounted.has(key)) return;
    mounted.add(key);
    if (key === "fc") {
      const fcEl = view.querySelector<HTMLElement>("#fc-chart")!;
      if (fc) {
        const c = forecastChart(fc);
        ctx.onCleanup(mountChart(fcEl, c.draw, c.wire));
      } else fcEl.innerHTML = `<div class="chart-empty">Forecast unavailable right now.</div>`;
    } else if (key === "io") ctx.onCleanup(mountChart(view.querySelector<HTMLElement>("#io-chart")!, inOutChart(ov.monthly)));
  };
  const tabs = [...view.querySelectorAll<HTMLButtonElement>(".cash-card [role=tab]")];
  const show = (key: string, focus = false) => {
    for (const t of tabs) {
      const on = t.dataset.tab === key;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      view.querySelector<HTMLElement>(`#tab-${t.dataset.tab}`)!.hidden = !on;
      if (on && focus) t.focus();
    }
    cashSub.innerHTML = SUBS[key] ?? "";
    mount(key);
  };
  for (const t of tabs) {
    t.addEventListener("click", () => show(t.dataset.tab!));
    t.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const i = tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1);
      show(tabs[(i + tabs.length) % tabs.length]!.dataset.tab!, true);
    });
  }
  show("fc");

  // Approve / reject straight from the attention list.
  const appr = view.querySelector<HTMLElement>("#ov-appr");
  let waiting = ov.approvals.count;
  appr?.addEventListener("click", async e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>(".ap")!;
    for (const b of row.querySelectorAll("button")) b.disabled = true;
    btn.classList.add("loading");
    try {
      await decide(btn.dataset.pid!, btn.dataset.act as "approve" | "reject");
      waiting = Math.max(0, waiting - 1);
      needs = Math.max(0, needs - 1);
      view.querySelector("#ov-needs")!.textContent = needsText(needs);
      const tile = view.querySelector<HTMLElement>("#today-appr");
      if (tile) {
        tile.querySelector("b")!.textContent = String(waiting);
        if (!waiting) {
          tile.classList.remove("attn");
          tile.querySelector(".sub")!.textContent = "You're all caught up";
        }
      }
      row.classList.add("leaving");
      window.setTimeout(() => {
        row.remove();
        if (appr.querySelector(".ap")) return;
        if (waiting) {
          // More were waiting than fit on the overview.
          appr.innerHTML = `<li class="list-empty"><a class="link-sm" href="/app/payments">${waiting} more waiting${icon("chevron", 14)}</a></li>`;
          return;
        }
        view.querySelector("#attn-appr")?.remove();
        const box = view.querySelector<HTMLElement>("#ov-attn")!;
        if (!box.querySelector(".attn-group")) box.innerHTML = CAUGHT_UP;
      }, 280);
    } catch {
      for (const b of row.querySelectorAll("button")) b.disabled = false;
      btn.classList.remove("loading");
    }
  });
}
