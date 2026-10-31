import { $, esc, money } from "../shared/dom.js";
import { listRuns, type RunSummary } from "./api.js";
import { HELD } from "./stages.js";
import { clock, countTo, initials, pill, tone } from "./ui.js";

let selected: () => string | null = () => null;
let lastHtml = "";
let firstLoad = true;
const seen = new Set<string>();

/** pick runs when an inbox row is clicked; selectedId marks the open run. */
export function initList(pick: (id: string) => void, selectedId: () => string | null): void {
  selected = selectedId;
  $("list").addEventListener("click", e => {
    const row = (e.target as Element).closest<HTMLElement>("li[data-id]");
    if (row?.dataset.id) pick(row.dataset.id);
  });
}

const rowHtml = (r: RunSummary): string => `<li data-id="${esc(r.id)}" class="${r.id === selected() ? "sel" : ""}">
      <span class="av ${tone(r.supplier)}">${esc(r.supplier ? initials(r.supplier) : "…")}</span>
      <span class="who-line"><b>${esc(r.supplier || "Reading invoice…")}</b><span>${esc(r.invoiceId || r.id.slice(0, 8))} · ${esc(clock(r.createdAt))}</span></span>
      <span class="amt-col"><b>${esc(money(r.amountMinor, r.currency))}</b>${pill(r.state, r.payoutStatus)}</span>
    </li>`;

/** Inbox and session counters. Re-renders only when the markup changed; new rows rise in. */
export async function loadList(): Promise<void> {
  let runs: RunSummary[];
  try {
    runs = await listRuns();
  } catch {
    return;
  }
  if (!Array.isArray(runs)) return;
  const held = runs.filter(r => HELD.includes(r.state)).length;
  countTo($("k-total"), runs.length);
  $("k-total-sub").textContent = held ? `${held} held by the CFO` : "this session";
  countTo($("k-ready"), runs.filter(r => r.state === "DRAFT_READY").length);
  countTo($("k-paid"), runs.filter(r => r.state === "EXECUTED").length);
  $("k-count").textContent = runs.length ? String(runs.length) : "";

  const html = runs.map(rowHtml).join("");
  if (html === lastHtml) return;
  lastHtml = html;
  const list = $("list");
  list.innerHTML = html || `<li class="empty">No invoices yet.</li>`;
  for (const li of list.querySelectorAll<HTMLElement>("li[data-id]")) {
    const id = li.dataset.id!;
    if (!firstLoad && !seen.has(id)) li.classList.add("enter");
    seen.add(id);
  }
  firstLoad = false;
}
