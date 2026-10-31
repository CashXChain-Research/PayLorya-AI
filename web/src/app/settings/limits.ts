import type { Budget, BudgetUsage } from "../../../../src/contracts.js";
import { $, ada, esc, exponent, money, tada } from "../../shared/dom.js";
import { reducedMotion } from "../../shared/nav.js";
import { getBalances, getBudget, putBudget, type BudgetState, type BudgetUpdate } from "../api.js";
import { approvalsDisabled, emitPaymentChange, withOperatorToken } from "../approval.js";
import { health } from "../health.js";
import { I, callout } from "../ui.js";
import { fiatCurrencies } from "../wallets.js";

// The server's spending limits (GET/PUT /api/budget): editable by the operator, bounded by hardMax.
// Lovelace values are decimal strings, fiat values minor units; the form shows tADA and major units.

type Sec = "checks" | "ada" | "fiat";
interface Field {
  id: string;
  sec: Sec;
  key: keyof Budget;
  /** fiatBudgetMinor rows: the currency of the row. */
  cur?: string;
  label: string;
  unit: string;
  /** Decimals of the major unit shown in the field (tADA 6, EUR 2, counts 0). */
  decimals: number;
  /** "ADA" or a fiat currency for amounts; "" for the currency-less fiat fields and counts. */
  currency: string;
  used?: (u: BudgetUsage) => number;
  note?: string;
}

const LOVELACE: ReadonlySet<keyof Budget> = new Set<keyof Budget>(["checkBudgetLovelace", "cardanoPayoutMaxLovelace", "cardanoBudgetLovelace"]);

let state: BudgetState | undefined;
let accounts: Array<{ currency: string }> = [];
let fields: Field[] = [];
/** Text typed but not saved, per field id (kept across refreshes). */
const drafts = new Map<string, string>();
let saving = false;

/** Raw value in a budget: a lovelace string, minor units or a count. */
function get(f: Field, b: Budget): string | number {
  if (f.key === "fiatBudgetMinor") return b.fiatBudgetMinor[f.cur!] ?? b.fiatBudgetDefaultMinor;
  return b[f.key] as string | number;
}

/** Writes a changed value into the update: lovelace as a string, the rest as numbers. */
function put(f: Field, u: BudgetUpdate, minor: string, s: BudgetState): void {
  if (f.key === "fiatBudgetMinor") {
    // The whole map goes back, so the server may replace or merge it.
    u.fiatBudgetMinor = { ...s.budget.fiatBudgetMinor, ...u.fiatBudgetMinor, [f.cur!]: Number(minor) };
  } else if (LOVELACE.has(f.key)) {
    (u as Record<string, unknown>)[f.key] = minor;
  } else {
    (u as Record<string, unknown>)[f.key] = Number(minor);
  }
}

function fieldsFor(s: BudgetState): Field[] {
  const ada = { unit: "tADA", decimals: 6, currency: "ADA" };
  const fiat = fiatCurrencies(accounts, s.budget, s.usage).map((c): Field => ({
    id: `fiat-${c}`, sec: "fiat", key: "fiatBudgetMinor", cur: c, label: `${c} budget`, unit: c, decimals: exponent(c), currency: c,
    used: u => u.fiatPaidMinor[c] ?? 0,
  }));
  return [
    { id: "checks", sec: "checks", key: "checkBudgetLovelace", label: "Session budget", ...ada, used: u => Number(u.checkSpentLovelace) },
    { id: "ada-max", sec: "ada", key: "cardanoPayoutMaxLovelace", label: "Largest payout", ...ada, note: "Per invoice" },
    { id: "ada-budget", sec: "ada", key: "cardanoBudgetLovelace", label: "Session budget", ...ada, used: u => Number(u.cardanoPaidLovelace) },
    { id: "fiat-max", sec: "fiat", key: "fiatPayoutMaxMinor", label: "Largest payout", unit: "per payout", decimals: 2, currency: "", note: "In the invoice currency" },
    ...fiat,
    { id: "fiat-default", sec: "fiat", key: "fiatBudgetDefaultMinor", label: "Other currencies", unit: "each", decimals: 2, currency: "", note: "For any currency not listed" },
    { id: "fiat-count", sec: "fiat", key: "fiatPayoutsPerSession", label: "Payouts per session", unit: "payouts", decimals: 0, currency: "", used: u => u.fiatPayouts },
  ];
}

/** "2.5" -> "2500000" (6 decimals), exactly, without floating point. Undefined when not a valid amount. */
export function toMinor(raw: string, decimals: number): { minor?: string; error?: string } {
  let t = raw.trim().replace(/\s/g, "");
  t = /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  if (!t) return { error: "Enter a value." };
  if (t.startsWith("-")) return { error: "Must be 0 or more." };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return { error: decimals ? "Enter a number, e.g. 25 or 25.5." : "Enter a whole number." };
  const [int = "", frac = ""] = t.split(".");
  if (frac.length > decimals) return { error: decimals ? `At most ${decimals} decimals.` : "Enter a whole number." };
  const minor = `${int}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  if (!Number.isSafeInteger(Number(minor))) return { error: "That number is too large." };
  return { minor };
}

/** "2500000" (6 decimals) -> "2.5"; with cents, "1500050" -> "15000.50" and "1000000" -> "10000". */
export function fromMinor(minor: string | number, decimals: number, cents = false): string {
  const s = String(minor);
  if (!decimals || !/^\d+$/.test(s)) return s;
  const padded = s.padStart(decimals + 1, "0");
  const raw = padded.slice(-decimals);
  const frac = /^0+$/.test(raw) ? "" : cents ? raw : raw.replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
}

/** The field's value as shown in its input. */
const shown = (f: Field, b: Budget): string => fromMinor(get(f, b), f.decimals, f.currency !== "ADA");

const show = (f: Field, minor: number): string =>
  f.currency === "ADA" ? `${tada(minor)} tADA`
  : f.currency ? money(minor, f.currency)
  : (minor / 10 ** f.decimals).toLocaleString("en-US", { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals });

const rowHtml = (f: Field): string => `<div class="bud" id="br-${f.id}">
    <div class="bud-top">
      <label for="bf-${f.id}">${esc(f.label)}</label>
      <div class="bud-in"><input id="bf-${f.id}" data-bud="${f.id}" type="text" inputmode="${f.decimals ? "decimal" : "numeric"}" autocomplete="off" spellcheck="false" aria-describedby="bh-${f.id}"><span class="unit">${esc(f.unit)}</span></div>
    </div>
    ${f.used ? `<div class="meter"><i id="bm-${f.id}"></i></div>` : ""}
    <p class="bud-hint" id="bh-${f.id}"></p>
  </div>`;

const SK = `<span class="sk" style="width:100%;height:64px;border-radius:16px"></span>`;

export const limitsHtml = (): string => `<div id="bud-msg"></div>
    <div class="bud-grid">
      <div class="bud-col">
        <div class="lim-sec"><h3>Verification checks</h3><p class="lim-ro" id="lim-price"></p><div class="bud-rows" data-sec="checks">${SK}</div></div>
        <div class="lim-sec"><h3>Crypto payouts · Cardano</h3><div class="bud-rows" data-sec="ada">${SK}</div></div>
      </div>
      <div class="bud-col">
        <div class="lim-sec"><h3>Fiat payouts · CashXChain</h3><div class="bud-rows" data-sec="fiat">${SK}</div></div>
      </div>
    </div>
    <div class="bud-foot">
      <p class="bud-status" id="bud-status" role="status" aria-live="polite"></p>
      <div class="bud-actions">
        <button class="btn ghost sm" type="button" id="bud-undo" hidden>Discard</button>
        <button class="btn primary sm" type="button" id="bud-save" disabled>Save budget</button>
      </div>
    </div>
    <p class="lim-line" id="lim-token" hidden>${I.lock}<span></span></p>
    <p class="set-note">${I.lock}<span>Server-wide for this session, for every browser using this agent. Saving asks for the operator token once per tab; the hard maximums bound every value.</span></p>`;

interface Check {
  minor?: string;
  error?: string;
  changed: boolean;
}

function check(f: Field): Check {
  const current = String(get(f, state!.budget));
  const text = drafts.get(f.id);
  if (text === undefined) return { minor: current, changed: false };
  const r = toMinor(text, f.decimals);
  return r.minor === undefined ? { error: r.error ?? "Invalid value.", changed: true } : { minor: r.minor, changed: r.minor !== current };
}

function hint(f: Field, c: Check): [string, string] {
  if (c.error) return [c.error, "bad"];
  const s = state!;
  const hard = Number(get(f, s.hardMax));
  const value = Number(c.minor);
  const used = f.used?.(s.usage);
  const max = `hard max ${show(f, hard)}`;
  if (value > hard) return [`Above the ${max}: the server will refuse it.`, "warn"];
  if (used !== undefined && value < used) return [`Below what is already used (${show(f, used)}): further payouts stop.`, "warn"];
  const parts = [used !== undefined ? `${show(f, used)} used` : f.note ?? "", max].filter(Boolean);
  return [`${parts.join(" · ")}${c.changed ? " · not saved" : ""}`, c.changed ? "dirty" : ""];
}

function updateRow(f: Field): void {
  const input = $<HTMLInputElement>(`bf-${f.id}`);
  const c = check(f);
  if (!drafts.has(f.id) && document.activeElement !== input) input.value = shown(f, state!.budget);
  const [text, cls] = hint(f, c);
  const el = $(`bh-${f.id}`);
  el.textContent = text;
  el.className = `bud-hint${cls ? ` ${cls}` : ""}`;
  input.closest(".bud-in")!.classList.toggle("bad", cls === "bad");
  input.setAttribute("aria-invalid", String(cls === "bad"));
  const used = f.used?.(state!.usage);
  if (used !== undefined) {
    const limit = Number(c.minor ?? get(f, state!.budget));
    const ratio = limit > 0 ? Math.min(1, used / limit) : used > 0 ? 1 : 0;
    const bar = $(`bm-${f.id}`);
    bar.style.width = `${(ratio * 100).toFixed(1)}%`;
    bar.classList.toggle("hi", ratio >= 0.8);
  }
}

function updateFoot(): void {
  const checks = fields.map(check);
  const bad = checks.some(c => c.error);
  const changed = checks.some(c => c.changed);
  const off = approvalsDisabled();
  $<HTMLButtonElement>("bud-save").disabled = !state || saving || bad || !changed || off;
  $<HTMLButtonElement>("bud-save").classList.toggle("loading", saving);
  $("bud-undo").hidden = !changed || saving;
}

function status(text: string, cls = ""): void {
  const el = $("bud-status");
  el.textContent = text;
  el.className = `bud-status${cls ? ` ${cls}` : ""}`;
}

/** Draws the rows (only when the set of fields changed, so typing is never interrupted) and their values. */
function render(): void {
  if (!state) return;
  fields = fieldsFor(state);
  for (const sec of ["checks", "ada", "fiat"] as const) {
    const host = document.querySelector<HTMLElement>(`#view-settings .bud-rows[data-sec="${sec}"]`)!;
    const mine = fields.filter(f => f.sec === sec);
    const sig = mine.map(f => f.id).join(",");
    if (host.dataset.sig !== sig) {
      host.dataset.sig = sig;
      host.innerHTML = mine.map(rowHtml).join("");
    }
  }
  for (const f of fields) updateRow(f);
  updateFoot();
}

/** GET /api/budget (and the account currencies from /api/balances); keeps unsaved edits. */
export async function loadBudget(): Promise<void> {
  const [res, bal] = await Promise.all([getBudget(), getBalances()]);
  if (bal.ok) accounts = bal.data.cashxchain.accounts;
  if (!res.ok) {
    const why = res.status === 0 ? "The agent could not be reached." : `${res.error}.`;
    if (!state) $("bud-msg").innerHTML = callout("warn", "Budget not loaded", `${esc(why)} <button class="m-link" type="button" id="bud-retry">Try again</button>`);
    return;
  }
  $("bud-msg").innerHTML = "";
  state = res.data;
  render();
}

async function save(): Promise<void> {
  if (!state || saving) return;
  const update: BudgetUpdate = {};
  for (const f of fields) {
    const c = check(f);
    if (c.error) return render();
    if (c.changed && c.minor !== undefined) put(f, update, c.minor, state);
  }
  if (!Object.keys(update).length) return;
  saving = true;
  status("Saving…");
  updateFoot();
  const res = await withOperatorToken("Changing the budget needs the operator token of this deployment.", token => putBudget(update, token));
  saving = false;
  for (const f of fields) $(`br-${f.id}`).classList.remove("err");
  if (res.ok) {
    state = res.data;
    drafts.clear();
    render();
    status("Saved. The new limits apply from the next payment.", "ok");
    emitPaymentChange();
    return;
  }
  updateFoot();
  if (res.status === 400) {
    // Point at the changed field the server named, when it did.
    for (const f of fields) if (check(f).changed && res.error.includes(f.key)) $(`br-${f.id}`).classList.add("err");
    status(`Not saved: ${res.error}`, "bad");
  } else if (res.status === 0) status(res.error, "");
  else if (res.status === 401) status("The operator token was not accepted. Nothing was changed.", "bad");
  else if (res.status === 503) status("Approvals are switched off on this server (no operator token), so the budget can't be changed. Nothing was changed.", "bad");
  else status(`Not saved: ${res.error}.`, "bad");
}

/** Typing, Save and Discard on the budget form. */
export function initBudget(): void {
  const view = $("view-settings");
  view.addEventListener("input", e => {
    const input = e.target as HTMLInputElement;
    const f = fields.find(x => x.id === input.dataset?.bud);
    if (!f || !state) return;
    const current = shown(f, state.budget);
    if (input.value.trim() === current) drafts.delete(f.id);
    else drafts.set(f.id, input.value);
    status("");
    $(`br-${f.id}`).classList.remove("err");
    updateRow(f);
    updateFoot();
  });
  view.addEventListener("focusout", e => {
    const input = e.target as HTMLInputElement;
    const f = fields.find(x => x.id === input.dataset?.bud);
    if (f && state) updateRow(f);
  });
  view.addEventListener("keydown", e => {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter" && input.dataset?.bud) void save();
  });
  view.addEventListener("click", e => {
    if ((e.target as Element).closest("#bud-retry")) void loadBudget();
  });
  $("bud-save").addEventListener("click", () => void save());
  $("bud-undo").addEventListener("click", () => {
    drafts.clear();
    for (const input of view.querySelectorAll<HTMLInputElement>(".bud input")) input.blur();
    status("");
    render();
  });
}

/** Read-only lines from /api/health: the check price and the token state. */
export function updateLimits(): void {
  const h = health;
  $("lim-price").textContent = h.priceLovelace
    ? `${ada(h.priceLovelace)} per check, offers above ${ada(h.maxPriceLovelace)} refused. Set in the server configuration.`
    : h.status ? "" : "Agent offline.";
  const line = $("lim-token");
  line.hidden = !approvalsDisabled();
  line.querySelector("span")!.textContent = "Approvals are switched off on this server (no operator token): the budget is read-only here";
  if (state) updateFoot();
}

/** Refills the meters from zero (each visit to the view). */
export function replayMeters(): void {
  if (reducedMotion()) return;
  for (const bar of document.querySelectorAll<HTMLElement>("#view-settings .bud .meter i")) {
    const width = bar.style.width;
    bar.style.transition = "none";
    bar.style.width = "0";
    void bar.offsetWidth;
    bar.style.transition = "";
    bar.style.width = width;
  }
}
