import type { Budget, BudgetUsage } from "../../../src/contracts.js";
import { $, ada, amountText, decimalMoney, decimalText, esc, money, short, tada } from "../shared/dom.js";
import { getBalances, type Balances } from "./api.js";
import { onPaymentChange } from "./approval.js";
import { currentRoute, onRoute } from "./router.js";
import { I, addrHtml, bindAddr } from "./ui.js";

// What the agent can pay from and how much budget is left: GET /api/balances, at a glance.

const icon = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  wallet: icon(`<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9a2 2 0 0 0-2-2H6"/><path d="M16.5 13.5h.01"/>`),
  coin: icon(`<circle cx="12" cy="12" r="9"/><path d="M12 6.8l4.5 2.6v5.2L12 17.2l-4.5-2.6V9.4z"/>`),
  arrow: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
};

const REFRESH_MS = 15_000;

/** Fiat currencies with a budget line: accounts first, then any the budget or usage names. */
export function fiatCurrencies(accounts: Array<{ currency: string }>, budget: Budget, usage: BudgetUsage): string[] {
  const out: string[] = [];
  const add = (c: string) => {
    if (c && c !== "ADA" && !out.includes(c)) out.push(c);
  };
  for (const a of accounts) add(a.currency);
  for (const c of [...Object.keys(budget.fiatBudgetMinor), ...Object.keys(usage.fiatPaidMinor)].sort()) add(c);
  return out;
}

function meter(label: string, used: number, limit: number, value: string, sub = ""): string {
  const ratio = limit > 0 ? Math.min(1, used / limit) : used > 0 ? 1 : 0;
  return `<div class="wal-m">
      <div class="wal-m-top"><span>${esc(label)}</span><b>${value}</b></div>
      <div class="meter"><i class="${ratio >= 0.8 ? "hi" : ""}" style="width:${(ratio * 100).toFixed(1)}%"></i></div>
      ${sub ? `<span class="wal-m-sub">${sub}</span>` : ""}
    </div>`;
}

/** Wallets, accounts and budget meters (the Assistant panel and the chat card). */
export function balancesHtml(b: Balances): string {
  const c = b.cardano;
  const x = b.cashxchain;
  const budget = b.budget;
  const usage = b.usage;
  const wallet = `<div class="wal-row">
      <span class="wal-ic brand">${IC.coin}</span>
      <div class="wal-who"><b>Agent wallet</b><span class="wal-sub">${c.address ? "test ADA" : "Not set"}</span></div>
      <span class="wal-amt">${c.balanceLovelace !== undefined ? `${esc(tada(c.balanceLovelace))}<small>tADA</small>` : `<span class="wal-sub" title="${esc(c.error)}">${c.error ? "Unavailable" : "–"}</span>`}</span>
      ${c.address ? `<div class="wal-addr">${addrHtml(c.address)}</div>` : ""}
    </div>`;
  const accounts = x.accounts.length
    ? x.accounts.map(a => `<div class="wal-row">
        <span class="wal-ic accent cur">${esc(a.currency)}</span>
        <div class="wal-who"><b>${esc(a.name || `${a.currency} account`)}</b><span class="wal-sub mono" title="${esc(a.id)}">${esc(short(a.id))}${a.status && a.status !== "active" ? ` · ${esc(a.status)}` : ""}</span></div>
        <span class="wal-amt">${a.available !== undefined ? esc(decimalText(a.available, a.currency)) : "–"}<small>${esc(a.currency)}</small></span>
      </div>`).join("")
    : `<p class="wal-empty">${x.simulated ? "Fiat payouts run as a labeled simulation: no sandbox key, no money moves." : x.error ? `Accounts unavailable: ${esc(x.error)}` : "No accounts yet."}</p>`;
  const fiat = fiatCurrencies(x.accounts, budget, usage).map(cur => {
    const limit = budget.fiatBudgetMinor[cur] ?? budget.fiatBudgetDefaultMinor;
    const used = usage.fiatPaidMinor[cur] ?? 0;
    return meter(`${cur} payouts`, used, limit, `${esc(amountText(used, cur))} <small>/ ${esc(money(limit, cur))}</small>`);
  });
  const checks = Number(usage.checkSpentLovelace);
  const checkBudget = Number(budget.checkBudgetLovelace);
  const paid = Number(usage.cardanoPaidLovelace);
  const payBudget = Number(budget.cardanoBudgetLovelace);
  return `<div class="wal-sec">
      <h3>Cardano Preprod</h3>${wallet}
    </div>
    <div class="wal-sec">
      <h3>CashXChain ${x.simulated ? `<span class="sim">simulated</span>` : x.ready ? `<span class="wal-tag">sandbox</span>` : ""}</h3>${accounts}
      ${x.error && x.accounts.length ? `<p class="wal-empty">${esc(x.error)}</p>` : ""}
    </div>
    <div class="wal-sec">
      <h3>Budget this session</h3>
      ${meter("Verification checks", checks, checkBudget, `${esc(tada(checks))} <small>/ ${esc(ada(checkBudget))}</small>`)}
      ${meter("Cardano payouts", paid, payBudget, `${esc(tada(paid))} <small>/ ${esc(ada(payBudget))}</small>`, `up to ${esc(ada(budget.cardanoPayoutMaxLovelace))} each`)}
      ${fiat.join("")}
      ${meter("Fiat payouts", usage.fiatPayouts, budget.fiatPayoutsPerSession, `${usage.fiatPayouts} <small>/ ${budget.fiatPayoutsPerSession}</small>`, `up to ${esc(amountText(budget.fiatPayoutMaxMinor, "EUR"))} each, in the invoice currency`)}
    </div>`;
}

/** One-line summary for the collapsed strip: "1,234.5 tADA · EUR 12,500.00". */
function summary(b: Balances): string {
  const parts = [b.cardano.balanceLovelace !== undefined ? ada(b.cardano.balanceLovelace) : ""];
  if (b.cashxchain.simulated) parts.push("fiat simulated");
  for (const a of b.cashxchain.accounts) parts.push(decimalMoney(a.available, a.currency));
  return parts.filter(Boolean).join(" · ");
}

/** Chat card for the show_balances action. */
export async function balancesCard(): Promise<string> {
  const res = await getBalances();
  if (!res.ok) return `I couldn't load the wallets and budgets: ${esc(res.error)}.`;
  return `<div class="wal wal-card"><div class="wal-head"><h2>Wallets and budget</h2><a class="m-link" href="#/settings">Edit budget ${IC.arrow}</a></div>${balancesHtml(res.data)}</div>`;
}

let panel: HTMLElement | undefined;
let timer: number | undefined;
let loading = false;

async function refresh(): Promise<void> {
  if (!panel || loading) return;
  loading = true;
  const btn = panel.querySelector<HTMLButtonElement>("[data-wal-refresh]");
  btn?.classList.add("spin");
  const res = await getBalances();
  loading = false;
  btn?.classList.remove("spin");
  const body = $("wal-content");
  if (!res.ok) {
    // An older server without /api/balances: no panel at all.
    panel.hidden = res.status === 404;
    if (!body.dataset.sig) body.innerHTML = `<p class="wal-empty">Couldn't load the wallets: ${esc(res.error)}.</p>`;
    $("wal-sum").textContent = "unavailable";
    return;
  }
  panel.hidden = false;
  const html = balancesHtml(res.data);
  // Keep an expanded address expanded: redraw only when something changed.
  if (body.dataset.sig !== html) {
    body.dataset.sig = html;
    body.innerHTML = html;
  }
  $("wal-sum").textContent = summary(res.data);
}

function schedule(): void {
  clearTimeout(timer);
  if (currentRoute().view !== "assistant" || document.hidden) return;
  timer = window.setTimeout(() => void refresh().then(schedule), REFRESH_MS);
}

/** The Assistant's wallets and budget panel: a side column on wide screens, a fold above the chat on narrow ones. */
export function initWalletPanel(host: HTMLElement): void {
  panel = host;
  host.innerHTML = `<button class="wal-strip" type="button" id="wal-toggle" aria-expanded="false" aria-controls="wal-body">
      <span class="wal-ic brand">${IC.wallet}</span><b>Wallets and budget</b><span class="wal-sum" id="wal-sum"></span>${I.chev}
    </button>
    <div class="wal-body" id="wal-body">
      <div class="wal-head"><h2 id="wal-h">Wallets and budget</h2><button class="wal-btn" type="button" data-wal-refresh aria-label="Refresh balances" title="Refresh">${I.refresh}</button></div>
      <div id="wal-content"><span class="sk" style="width:60%"></span><span class="sk" style="width:85%;margin-top:12px"></span><span class="sk" style="width:70%;margin-top:12px"></span></div>
      <a class="m-link wal-edit" href="#/settings">Edit budget in Agent settings ${IC.arrow}</a>
    </div>`;
  host.setAttribute("aria-labelledby", "wal-h");
  bindAddr(host);
  $("wal-toggle").addEventListener("click", () => {
    const open = host.classList.toggle("open");
    $("wal-toggle").setAttribute("aria-expanded", String(open));
  });
  host.querySelector("[data-wal-refresh]")!.addEventListener("click", () => void refresh());
  onRoute(route => {
    if (route.view === "assistant") void refresh().then(schedule);
    else clearTimeout(timer);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentRoute().view === "assistant") void refresh().then(schedule);
    else clearTimeout(timer);
  });
  // Right after a decision, and again once a payout had time to settle.
  onPaymentChange(() => {
    void refresh();
    window.setTimeout(() => void refresh(), 4000);
  });
}
