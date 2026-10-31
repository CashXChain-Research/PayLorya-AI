// Overview: cash, approvals, payables, spend, in/out, budgets, forecast, agent status, Ask box.
import { esc } from "../../shared/dom.js";
import { get } from "../api.js";
import { categoryBars, forecastChart, inOutChart, mountChart } from "../charts.js";
import { askCfo, type Ctx, state } from "../state.js";
import type { Forecast, Me, Overview, Payment } from "../types.js";
import { amount, AUTONOMY, avatar, balance, date, dueLabel, empty, icon, monthLabel, sk, skCard, usd } from "../ui.js";
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
  <header class="page-head"><div class="page-title"><h1>${esc(greeting())}${name ? `, ${esc(name)}` : ""}</h1><p>${esc(today)} · Here is where your business stands.</p></div>
    <div class="page-actions"><a class="btn ghost sm" href="/app/documents">${icon("upload", 16)}Upload</a><a class="btn ghost sm" href="/app/payments">${icon("pay", 16)}Payments</a></div></header>
  <form class="ask reveal" id="ask">
    <span class="ask-ic">${icon("sparkle", 20)}</span>
    <input id="ask-in" name="q" autocomplete="off" placeholder="Ask your AI CFO anything about your money…" aria-label="Ask your AI CFO">
    <button class="btn primary sm" type="submit">Ask${icon("arrowRight", 15, 2.2)}</button>
    <div class="ask-chips">${SUGGEST.map(s => `<button type="button" class="opt" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
  </form>
  <div id="ov-body">
    <section class="kpis">${Array.from({ length: 4 }, () => `<div class="stat-card">${sk("50%", 12)}<div style="height:12px"></div>${sk("70%", 28)}<div style="height:10px"></div>${sk("40%", 11)}</div>`).join("")}</section>
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
  const usedPct = a.limits.monthlyUsdMinor ? Math.min(100, (a.executedThisMonthUsdMinor / a.limits.monthlyUsdMinor) * 100) : 0;
  const thisMonth = ov.monthly[ov.monthly.length - 1];
  const spendTotal = ov.spendByCategory.reduce((s, r) => s + r.usdMinor, 0);

  const onboarding = isNew
    ? `<section class="card onboard reveal"><div class="onboard-head"><h2>Set up your AI CFO</h2><p class="muted">Three steps and your AI CFO has the full picture. It reads; code enforces your rules; you approve what moves.</p></div>
      <ol class="steps">
        <li><a href="/app/connections"><span class="step-n">1</span><span class="step-ic">${icon("wallet", 20)}</span><b>Connect a wallet or account</b><span>Add your Cardano agent wallet, a watch-only wallet or your CashXChain sandbox account.</span><em>Connect${icon("arrowRight", 14, 2.2)}</em></a></li>
        <li><a href="/app/documents"><span class="step-n">2</span><span class="step-ic">${icon("upload", 20)}</span><b>Upload financial documents</b><span>Invoices, receipts, bank statements, contracts. PDFs, photos, CSV.</span><em>Upload${icon("arrowRight", 14, 2.2)}</em></a></li>
        <li><a href="/app/agent"><span class="step-n">3</span><span class="step-ic">${icon("shield", 20)}</span><b>Decide what the agent may do</b><span>Start read-only. Move to guarded with limits when you are ready.</span><em>Review${icon("arrowRight", 14, 2.2)}</em></a></li>
      </ol></section>`
    : "";

  body.innerHTML = `${onboarding}
  <section class="kpis">
    <a class="stat-card reveal" href="/app/connections" style="--d:40ms"><span class="label">${icon("wallet", 14)}Cash position</span><b>${esc(usd(ov.cash.totalUsdMinor))}</b><span class="sub">${ov.cash.connections.length ? `across ${ov.cash.connections.length} connection${ov.cash.connections.length === 1 ? "" : "s"} · indicative USD` : "No connections yet"}</span></a>
    <a class="stat-card reveal ${ov.approvals.count ? "attn" : ""}" href="/app/payments" style="--d:80ms"><span class="label">${icon("shieldCheck", 14)}Approvals waiting</span><b>${ov.approvals.count}</b><span class="sub">${ov.approvals.count ? `${esc(usd(ov.approvals.payments.reduce((s, p) => s + p.usdMinor, 0)))} needs your decision` : "You're all caught up"}</span></a>
    <a class="stat-card reveal" href="/app/documents" style="--d:120ms"><span class="label">${icon("calendar", 14)}Payables open</span><b>${esc(usd(ov.payables.totalUsdMinor))}</b><span class="sub">${ov.payables.count} unpaid invoice${ov.payables.count === 1 ? "" : "s"}</span></a>
    <a class="stat-card agent-kpi reveal a-${a.autonomy}" href="/app/agent" style="--d:160ms"><span class="label">${icon("bot", 14)}Agent<span class="pill ${AUTONOMY[a.autonomy].tone}">${AUTONOMY[a.autonomy].name}</span></span>
      <b>${esc(usd(a.executedThisMonthUsdMinor, { cents: false }))}<small> of ${esc(usd(a.limits.monthlyUsdMinor, { cents: false }))}</small></b>
      <div class="meter ${usedPct >= 90 ? "hot" : ""}"><i style="width:${usedPct.toFixed(1)}%"></i></div>
      <span class="sub">${a.autonomy === "read_only" ? "Drafts only. Executes nothing on its own." : `executed on its own this month · max ${esc(usd(a.limits.perPaymentUsdMinor, { cents: false }))} per payment`}</span></a>
  </section>

  <section class="ov-grid">
    <div class="card chart-card reveal" style="--d:120ms">
      <div class="card-head"><div><h2>Cash forecast</h2><p class="muted small">Next ${fc?.days ?? 90} days from connected balances and open invoices</p></div>
        ${fc ? `<div class="fc-legend"><span class="lg-in">Inflow</span><span class="lg-out">Outflow</span></div>` : ""}</div>
      <div class="chart-wrap"><div class="chart" id="fc-chart"></div></div>
      ${fc && fc.events.length ? `<ul class="events">${fc.events.slice(0, 4).map(e => `<li>${e.documentId ? `<a href="/app/documents/${esc(e.documentId)}">` : "<span>"}<em class="${e.usdMinor < 0 ? "out" : "in"}"></em><span class="ev-d">${esc(date(e.date))}</span><span class="ev-l">${esc(e.label)}</span><b>${esc(usd(e.usdMinor, { sign: true, cents: false }))}</b>${e.documentId ? "</a>" : "</span>"}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="card reveal" style="--d:160ms">
      <div class="card-head"><h2>Approvals</h2><a class="link-sm" href="/app/payments">All payments${icon("chevron", 14)}</a></div>
      <ul class="ap-list" id="ov-appr">${ov.approvals.payments.length ? ov.approvals.payments.slice(0, 5).map(approvalItem).join("") : `<li class="list-empty">${empty({ icon: "shieldCheck", title: "Nothing to approve", text: "Payments that need a human show up here with their policy checks." })}</li>`}</ul>
    </div>
  </section>

  <section class="ov-grid">
    <div class="card chart-card reveal">
      <div class="card-head"><div><h2>Money in and out</h2><p class="muted small">Last 6 months, indicative USD${thisMonth ? ` · ${esc(monthLabel(thisMonth.month, true))} net <b class="${thisMonth.inUsdMinor - thisMonth.outUsdMinor < 0 ? "neg" : "pos"}">${esc(usd(thisMonth.inUsdMinor - thisMonth.outUsdMinor, { sign: true, cents: false }))}</b>` : ""}</p></div>
        <div class="fc-legend"><span class="lg-bin">In</span><span class="lg-bout">Out</span></div></div>
      <div class="chart" id="io-chart"></div>
    </div>
    <div class="card reveal">
      <div class="card-head"><div><h2>Spend by category</h2><p class="muted small">This month · ${esc(usd(spendTotal, { cents: false }))} out</p></div><a class="link-sm" href="/app/budgets">Details${icon("chevron", 14)}</a></div>
      ${ov.spendByCategory.length ? categoryBars(ov.spendByCategory) : empty({ icon: "budget", title: "No spending this month", text: "Upload receipts and statements and the agent categorises them for you." })}
    </div>
  </section>

  <section class="ov-grid three">
    <div class="card reveal">
      <div class="card-head"><h2>Cash by connection</h2><a class="link-sm" href="/app/connections">Manage${icon("chevron", 14)}</a></div>
      ${ov.cash.connections.length ? `<ul class="conn-mini">${ov.cash.connections.map(c => `<li><span class="cm-ic">${icon("wallet", 16)}</span><div><b>${esc(c.label)}</b><span>${c.balances.map(b => esc(balance(b))).join(" · ") || "No balance"}</span></div><b class="num">${esc(usd(c.usdMinor, { cents: false }))}</b></li>`).join("")}</ul>` : empty({ icon: "link", title: "Connect your first wallet", text: "Your AI CFO needs at least one connection to see your cash.", action: `<a class="btn primary sm" href="/app/connections">${icon("plus", 15, 2.4)}Add connection</a>` })}
    </div>
    <div class="card reveal">
      <div class="card-head"><h2>Due soon</h2><span class="count">${ov.payables.count ? esc(usd(ov.payables.totalUsdMinor, { cents: false })) : ""}</span></div>
      ${ov.payables.upcoming.length ? `<ul class="due-list">${ov.payables.upcoming.slice(0, 5).map(d => {
        const due = dueLabel(d.dueDate);
        return `<li><a href="/app/documents/${esc(d.id)}"><div><b>${esc(d.counterparty || d.title || d.filename)}</b><span>${esc(d.title || d.filename)}</span></div><div class="due-r"><b>${esc(amount(d.amountMinor, d.currency))}</b><span class="pill ${due.tone}">${esc(due.text)}</span></div></a></li>`;
      }).join("")}</ul>` : empty({ icon: "doc", title: "No open invoices", text: "Upload invoices and the AI CFO tracks what is due and when.", action: `<a class="btn ghost sm" href="/app/documents">${icon("upload", 15)}Upload documents</a>` })}
    </div>
    <div class="card reveal">
      <div class="card-head"><h2>Budgets</h2><a class="link-sm" href="/app/budgets">Plan${icon("chevron", 14)}</a></div>
      ${ov.budgets.length ? `<ul class="bud-list">${ov.budgets.slice(0, 5).map(budgetRow).join("")}</ul>` : empty({ icon: "budget", title: "No budgets yet", text: "Set monthly limits per category. The agent warns you before you go over.", action: `<a class="btn ghost sm" href="/app/budgets">${icon("plus", 15, 2.4)}Create a budget</a>` })}
    </div>
  </section>
  ${ov.documents.processing ? `<p class="fine center">${icon("clock", 13)} ${ov.documents.processing} document${ov.documents.processing === 1 ? " is" : "s are"} still being read. Figures update when ${ov.documents.processing === 1 ? "it is" : "they are"} done.</p>` : ""}`;

  const fcEl = view.querySelector<HTMLElement>("#fc-chart")!;
  if (fc) {
    const c = forecastChart(fc);
    ctx.onCleanup(mountChart(fcEl, c.draw, c.wire));
  } else fcEl.innerHTML = `<div class="chart-empty">Forecast unavailable right now.</div>`;
  ctx.onCleanup(mountChart(view.querySelector<HTMLElement>("#io-chart")!, inOutChart(ov.monthly)));

  const appr = view.querySelector<HTMLElement>("#ov-appr")!;
  appr.addEventListener("click", async e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>(".ap")!;
    for (const b of row.querySelectorAll("button")) b.disabled = true;
    btn.classList.add("loading");
    try {
      await decide(btn.dataset.pid!, btn.dataset.act as "approve" | "reject");
      row.classList.add("leaving");
      window.setTimeout(() => {
        row.remove();
        if (!appr.querySelector(".ap")) appr.innerHTML = `<li class="list-empty">${empty({ icon: "shieldCheck", title: "All caught up", text: "Nothing else is waiting for your approval." })}</li>`;
      }, 280);
    } catch {
      for (const b of row.querySelectorAll("button")) b.disabled = false;
      btn.classList.remove("loading");
    }
  });
}
