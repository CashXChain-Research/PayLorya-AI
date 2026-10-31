import { $, tada } from "../../shared/dom.js";
import { reducedMotion } from "../../shared/nav.js";
import { approvalsDisabled, tokenRequired } from "../approval.js";
import { health } from "../health.js";
import { I, countTo } from "../ui.js";

// Read-only tiles from /api/health: only the operator changes these (server configuration).
interface Tile {
  id: string;
  label: string;
  wide?: boolean;
  meter?: boolean;
}
const SECTIONS: Array<{ id: string; title: string; tiles: Tile[] }> = [
  {
    id: "x402",
    title: "Verification checks",
    tiles: [
      { id: "price", label: "Price per check" },
      { id: "cap", label: "Price cap" },
      { id: "session", label: "Session budget", wide: true, meter: true },
    ],
  },
  {
    id: "ada",
    title: "Crypto payouts · Cardano",
    tiles: [
      { id: "pmax", label: "Per invoice" },
      { id: "pbudget", label: "Payout budget", meter: true },
    ],
  },
  {
    id: "fiat",
    title: "Fiat payouts · CashXChain",
    tiles: [
      { id: "fmax", label: "Per payout" },
      { id: "fcount", label: "Payouts this session", meter: true },
    ],
  },
];

const tileHtml = (t: Tile): string => `<div class="tile${t.wide ? " wide" : ""}">
    <span class="lab">${t.label}</span>
    <span class="val"><b id="ln-${t.id}">–</b><small id="lu-${t.id}"></small></span>
    ${t.meter ? `<div class="meter"><i id="lm-${t.id}"></i></div>` : ""}
    <span class="cap" id="lc-${t.id}"></span>
  </div>`;

export const limitsHtml = (): string =>
  `${SECTIONS.map(s => `<div class="lim-sec" id="lim-${s.id}"><h3>${s.title}</h3><div class="tiles">${s.tiles.map(tileHtml).join("")}</div></div>`).join("")}
    <p class="lim-line" id="lim-token" hidden>${I.lock}<span></span></p>
    <p class="set-note">${I.lock}<span>Changed only in the server configuration.</span></p>`;

const lovelace = (v: number): string => tada(v);
const fiat = (minor: number): string => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tile(id: string, value: number | undefined, format: (v: number) => string, unit: string, caption: string): void {
  const num = $(`ln-${id}`);
  if (value === undefined || !Number.isFinite(value)) {
    num.textContent = "–";
    delete num.dataset.v;
  } else {
    countTo(num, value, format);
  }
  $(`lu-${id}`).textContent = value === undefined ? "" : unit;
  $(`lc-${id}`).textContent = caption;
}

function meter(id: string, used: number, total: number): void {
  const bar = $(`lm-${id}`);
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  bar.style.width = `${(ratio * 100).toFixed(1)}%`;
  bar.classList.toggle("hi", ratio >= 0.8);
}

const num = (v: string | number | undefined): number | undefined => (v === undefined || v === "" ? undefined : Number(v));

export function updateLimits(): void {
  const h = health;
  const off = !h.status;
  const price = num(h.priceLovelace);
  const maxPrice = num(h.maxPriceLovelace);
  const spent = num(h.spentLovelace) ?? 0;
  const budget = num(h.sessionBudgetLovelace);
  tile("price", price, lovelace, " tADA", off ? "Agent offline" : "Per request, via x402");
  tile("cap", maxPrice, lovelace, " tADA", off ? "Agent offline" : "Higher offers refused");
  tile("session", budget === undefined ? undefined : spent, lovelace, budget === undefined ? "" : ` / ${tada(budget)} tADA`,
    budget === undefined ? "Agent offline" : `${tada(Math.max(0, budget - spent))} tADA left this session`);
  meter("session", spent, budget ?? 0);

  const payMax = num(h.payoutMaxLovelace);
  const paid = num(h.paidOutLovelace) ?? 0;
  const payBudget = num(h.payoutBudgetLovelace);
  tile("pmax", payMax, lovelace, " tADA", off ? "Agent offline" : "Largest single payout");
  tile("pbudget", payBudget === undefined ? undefined : paid, lovelace, payBudget === undefined ? "" : ` / ${tada(payBudget)} tADA`,
    payBudget === undefined ? "Agent offline" : `${tada(Math.max(0, payBudget - paid))} tADA left`);
  meter("pbudget", paid, payBudget ?? 0);

  // Fiat caps are optional in /api/health (older servers): the section shows only when reported.
  const fiatMax = h.fiatPayoutMaxMinor;
  const perSession = h.fiatPayoutsPerSession;
  $("lim-fiat").hidden = fiatMax == null && perSession == null;
  tile("fmax", fiatMax, fiat, "", "In the invoice currency");
  const used = h.fiatPayoutsUsed ?? 0;
  tile("fcount", perSession == null ? undefined : used, v => String(Math.round(v)), perSession == null ? "" : ` / ${perSession}`,
    perSession == null ? "Not reported" : `${Math.max(0, perSession - used)} left`);
  meter("fcount", used, perSession ?? 0);

  const line = $("lim-token");
  line.hidden = !tokenRequired() && !approvalsDisabled();
  line.querySelector("span")!.textContent = approvalsDisabled() ? "Approvals are switched off on this server" : "Approvals need the operator token";
}

/** Refills the meters from zero (each visit to the view). */
export function replayMeters(): void {
  if (reducedMotion()) return;
  for (const bar of document.querySelectorAll<HTMLElement>("#view-settings .tile .meter i")) {
    const width = bar.style.width;
    bar.style.transition = "none";
    bar.style.width = "0";
    void bar.offsetWidth;
    bar.style.transition = "";
    bar.style.width = width;
  }
}
