import { $, ada, tada } from "../../shared/dom.js";
import { approvalsDisabled, ensureOperatorToken } from "../approval.js";
import { health, loadHealth } from "../health.js";
import { currentRoute, onRoute } from "../router.js";
import { I, toast } from "../ui.js";
import { autoNeedsToken, onAutoChange } from "./auto-state.js";
import { runAutopilot } from "./autopilot.js";
import { initBudget, limitsHtml, loadBudget, replayMeters, updateLimits } from "./limits.js";
import { DEFAULT_SETTINGS, getSettings, onSettings, saveSettings, type AgentSettings } from "./store.js";

const icon = (body: string, size = 20): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  doc: icon(`<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>`),
  check: icon(`<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/><path d="M8.6 12.2l2.4 2.4 4.4-4.6"/>`),
  coin: icon(`<circle cx="12" cy="12" r="9"/><path d="M12 6.8l4.5 2.6v5.2L12 17.2l-4.5-2.6V9.4z"/>`),
  bank: icon(`<path d="M3.5 9.5 12 4.5l8.5 5"/><path d="M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 20h17"/>`),
  device: icon(`<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16.5V20"/>`, 16),
  minus: icon(`<path d="M6.5 12h11"/>`, 16),
  plus: icon(`<path d="M12 6.5v11M6.5 12h11"/>`, 16),
  key: icon(`<circle cx="8" cy="15" r="4"/><path d="M10.9 12.1 19 4M15.5 7.5l2.5 2.5M13.5 9.5l1.8 1.8"/>`, 18),
};

type Toggle = "buyChecks" | "payCardano" | "payCashxchain";
type Group = "perm" | "appr";
interface Perm {
  id: string;
  key?: Toggle;
  icon: string;
  tone: "brand" | "accent";
  title: string;
  tag: string;
  off?: string;
}
const PERMS: Perm[] = [
  { id: "read", icon: IC.doc, tone: "brand", title: "Read invoices", tag: "Claude" },
  { id: "checks", key: "buyChecks", icon: IC.check, tone: "accent", title: "Buy verification checks", tag: "x402 on Cardano", off: "While off, new invoices are not sent to the agent." },
  { id: "ada", key: "payCardano", icon: IC.coin, tone: "brand", title: "Pay crypto invoices", tag: "tADA on Cardano Preprod", off: "While off, crypto drafts wait in the Inbox and cannot be approved." },
  { id: "fiat", key: "payCashxchain", icon: IC.bank, tone: "accent", title: "Pay fiat invoices", tag: "CashXChain", off: "While off, fiat drafts wait in the Inbox and cannot be approved." },
];

type AmountKey = "autoMaxTada" | "autoMaxFiat";
interface Field {
  id: string;
  key: AmountKey;
  label: string;
  unit: string;
  step: number;
  digits: number;
}
const FIELDS: Field[] = [
  { id: "tada", key: "autoMaxTada", label: "Crypto invoices up to", unit: "tADA", step: 1, digits: 6 },
  { id: "fiat", key: "autoMaxFiat", label: "Fiat invoices up to", unit: "EUR · USD", step: 50, digits: 2 },
];

const NOTE = {
  ask: "Every payout waits for your click in the Inbox.",
  auto: "Payouts up to these amounts are approved for you. Anything larger still waits for your click.",
};

const fmt = (v: number, digits: number): string => String(Number(v.toFixed(digits)));
const fmtCap = (v: number, digits: number): string => v.toLocaleString("en-US", { maximumFractionDigits: digits });

/** Amounts as typed: "5", "2.5", "2,5" or "1,000". Undefined unless a number of 0 or more. */
export function parseAmount(raw: string): number | undefined {
  let t = raw.trim().replace(/\s/g, "");
  t = /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function rowHtml(p: Perm): string {
  const sw = p.key
    ? `<button class="switch" type="button" role="switch" id="sw-${p.id}" aria-checked="false" aria-labelledby="t-${p.id}" aria-describedby="d-${p.id}"><span class="knob"></span></button>`
    : `<button class="switch locked" type="button" role="switch" aria-checked="true" aria-disabled="true" aria-labelledby="t-${p.id}" aria-describedby="d-${p.id}" title="Always on"><span class="knob">${I.lock}</span></button>`;
  return `<div class="set-row${p.key ? "" : " locked"}" id="row-${p.id}"${p.key ? ` data-key="${p.key}"` : ""}>
      <span class="set-ic ${p.tone}">${p.icon}</span>
      <div class="set-txt">
        <div class="set-title"><b id="t-${p.id}">${p.title}</b><span class="set-tag">${p.tag}</span></div>
        <p class="set-desc" id="d-${p.id}"></p>
        ${p.id === "fiat" ? `<span class="set-state" id="fiat-state"></span>` : ""}
        ${p.off ? `<div class="set-off"><div><p>${p.off}</p></div></div>` : ""}
      </div>
      ${sw}
    </div>`;
}

const fieldHtml = (f: Field): string => `<div class="amt">
    <label for="amt-${f.id}">${f.label}</label>
    <div class="stepper" id="st-${f.id}">
      <button class="step" type="button" data-field="${f.id}" data-dir="-1" aria-label="Lower the ${f.unit === "tADA" ? "crypto" : "fiat"} limit by ${f.step}">${IC.minus}</button>
      <input id="amt-${f.id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="h-${f.id}">
      <span class="unit" aria-hidden="true">${f.unit}</span>
      <button class="step" type="button" data-field="${f.id}" data-dir="1" aria-label="Raise the ${f.unit === "tADA" ? "crypto" : "fiat"} limit by ${f.step}">${IC.plus}</button>
    </div>
    <p class="amt-hint" id="h-${f.id}"></p>
  </div>`;

const head = (id: string, title: string, saved?: Group, sub = ""): string =>
  `<div class="set-head"><h2 id="${id}">${title}</h2>${sub ? `<span class="set-sub">${sub}</span>` : ""}${saved ? `<span class="saved" data-saved="${saved}" aria-hidden="true">${I.check} Saved</span>` : ""}</div>`;

function html(): string {
  return `<header class="page-head"><h1>Agent settings</h1><p>Decide what your AI CFO may do on its own.</p></header>
    <div class="set-grid">
      <div class="set-col">
        <section class="set-group" aria-labelledby="sg-perm">
          ${head("sg-perm", "Permissions", "perm")}
          <div class="set-card" id="set-perms">${PERMS.map(rowHtml).join("")}</div>
        </section>
      </div>
      <div class="set-col">
        <section class="set-group" aria-labelledby="sg-appr">
          ${head("sg-appr", "Approvals", "appr")}
          <div class="set-card set-pad">
            <div class="seg" id="seg" role="radiogroup" aria-labelledby="sg-appr" data-on="ask">
              <span class="seg-thumb" aria-hidden="true"></span>
              <button type="button" role="radio" data-mode="ask" aria-checked="true" aria-label="Ask me every time">Ask me<span class="seg-more">&nbsp;every time</span></button>
              <button type="button" role="radio" data-mode="auto" aria-checked="false" aria-label="Auto-approve small payouts">Auto-approve<span class="seg-more">&nbsp;small payouts</span></button>
            </div>
            <p class="seg-note" id="seg-note">${NOTE.ask}</p>
            <div class="callout c-warn" id="appr-off" hidden>${I.alert}<div><b>Approvals are switched off on this server</b>The operator has not set APPROVE_TOKEN yet, so nothing can be approved, by you or automatically. Fix: <code>npx wrangler secret put APPROVE_TOKEN</code>, then redeploy.</div></div>
            <div class="auto-fold" id="auto-fold"><div><div class="auto-in">
              <div class="amt-grid">${FIELDS.map(fieldHtml).join("")}</div>
              <div class="token-hint" id="token-hint" hidden>
                <span class="th-ic">${IC.key}</span>
                <p>This deployment needs the operator token. Enter it once to let auto-approve run.</p>
                <button class="btn ghost sm" type="button" id="token-btn">Enter token</button>
              </div>
              <p class="set-note">${I.shieldSm}<span>Applied by this browser while the app is open. Payouts still go only to verified payees and stay within the server's caps.</span></p>
            </div></div></div>
          </div>
        </section>
      </div>
      <section class="set-group set-wide" aria-labelledby="sg-lim">
        ${head("sg-lim", "Budget", undefined, "server-wide, needs the operator token")}
        <div class="set-card set-pad">${limitsHtml()}</div>
      </section>
      <div class="set-foot">
        <span class="sf-ic">${IC.device}</span>
        <p><b>Stored in this browser</b><span>Applied on top of the operator's hard limits.</span></p>
        <button class="btn ghost sm" type="button" id="set-reset">Reset to defaults</button>
      </div>
    </div>
    <span class="set-sr" role="status" id="set-live"></span>`;
}

const savedTimers = new Map<string, number>();
function flash(group: Group): void {
  const el = document.querySelector<HTMLElement>(`[data-saved="${group}"]`);
  if (el) {
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(savedTimers.get(group));
    savedTimers.set(group, window.setTimeout(() => el.classList.remove("show"), 1600));
  }
  const live = $("set-live");
  live.textContent = "";
  window.setTimeout(() => (live.textContent = "Saved"), 60);
}

function save(patch: Partial<AgentSettings>, group: Group): void {
  saveSettings({ ...getSettings(), ...patch });
  flash(group);
}

/** Server cap for a field in major units, when the server reports one. */
function cap(f: Field): number | undefined {
  if (f.id === "tada") return health.payoutMaxLovelace ? Number(health.payoutMaxLovelace) / 1e6 : undefined;
  return health.fiatPayoutMaxMinor != null ? health.fiatPayoutMaxMinor / 100 : undefined;
}

function showHint(f: Field, value: number | undefined): void {
  const el = $(`h-${f.id}`);
  const max = cap(f);
  const capText = max === undefined ? "" : `${fmtCap(max, f.digits)}${f.id === "tada" ? " tADA" : ""}`;
  let text: string;
  let cls = "";
  if (value === undefined) [text, cls] = ["Enter an amount of 0 or more.", "bad"];
  else if (max !== undefined && value > max) [text, cls] = [`Above the server cap of ${capText}. Larger payouts are still refused.`, "warn"];
  else if (value === 0) text = "0 keeps every one of these payouts waiting for you.";
  else if (f.id === "tada") text = max === undefined ? "Per invoice, in tADA." : `Per invoice. Server cap ${capText}.`;
  else text = max === undefined ? "Same amount in any currency." : `Same amount in any currency. Server cap ${capText} per payout.`;
  el.textContent = text;
  el.className = `amt-hint${cls ? ` ${cls}` : ""}`;
  $(`st-${f.id}`).classList.toggle("bad", cls === "bad");
  $(`amt-${f.id}`).setAttribute("aria-invalid", String(cls === "bad"));
  const minus = $(`st-${f.id}`).querySelector<HTMLButtonElement>('[data-dir="-1"]')!;
  minus.disabled = (value ?? 0) <= 0;
}

function commit(f: Field, value: number): void {
  const v = Number(value.toFixed(f.digits));
  if (getSettings()[f.key] !== v) save({ [f.key]: v }, "appr");
}

const equal = (a: AgentSettings, b: Readonly<AgentSettings>): boolean =>
  (Object.keys(b) as Array<keyof AgentSettings>).every(k => a[k] === b[k]);

/** Controls from the stored settings (also after a reset or a change elsewhere). */
function sync(): void {
  const s = getSettings();
  for (const p of PERMS) {
    if (!p.key) continue;
    $(`sw-${p.id}`).setAttribute("aria-checked", String(s[p.key]));
    $(`row-${p.id}`).classList.toggle("is-off", !s[p.key]);
  }
  const seg = $("seg");
  seg.dataset.on = s.approval;
  for (const radio of seg.querySelectorAll<HTMLButtonElement>("[role=radio]")) {
    const on = radio.dataset.mode === s.approval;
    radio.setAttribute("aria-checked", String(on));
    radio.tabIndex = on ? 0 : -1;
  }
  $("seg-note").textContent = NOTE[s.approval];
  const fold = $("auto-fold");
  fold.classList.toggle("open", s.approval === "auto");
  fold.inert = s.approval !== "auto";
  for (const f of FIELDS) {
    const input = $<HTMLInputElement>(`amt-${f.id}`);
    if (document.activeElement === input) continue;
    input.value = fmt(s[f.key], f.digits);
    showHint(f, s[f.key]);
  }
  $<HTMLButtonElement>("set-reset").disabled = equal(s, DEFAULT_SETTINGS);
  serverState();
}

/** Copy that depends on /api/health: live prices, sandbox state, token, caps. */
function live(): void {
  const h = health;
  $("d-read").innerHTML = `<span class="set-sr">Always on. </span>Claude only extracts fields. It never sees the wallet.`;
  $("d-checks").textContent = h.priceLovelace
    ? `${ada(h.priceLovelace)} per check, up to ${ada(h.maxPriceLovelace)}, ${ada(h.sessionBudgetLovelace)} per session.`
    : "Pays per check via x402, within the server's price cap and session budget.";
  $("d-ada").textContent = h.payoutMaxLovelace
    ? `Sends tADA to verified Cardano wallets after approval, up to ${tada(h.payoutMaxLovelace)} tADA per invoice.`
    : "Sends tADA to verified Cardano wallets after approval.";
  $("d-fiat").textContent = "Pays verified bank accounts through CashXChain after approval.";
  const sandbox = h.cashxchain?.ready === true;
  const state = $("fiat-state");
  state.className = `set-state ${sandbox ? "ok" : "sim"}`;
  state.innerHTML = `<i></i>${sandbox ? "Sandbox connected" : "Simulated: no sandbox key"}`;
  for (const f of FIELDS) {
    const input = $<HTMLInputElement>(`amt-${f.id}`);
    showHint(f, document.activeElement === input ? parseAmount(input.value) : getSettings()[f.key]);
  }
  serverState();
  updateLimits();
}

function serverState(): void {
  $("appr-off").hidden = !approvalsDisabled();
  $("token-hint").hidden = !autoNeedsToken();
}

function wire(): void {
  $("set-perms").addEventListener("click", e => {
    const row = (e.target as Element).closest<HTMLElement>(".set-row");
    if (!row) return;
    const key = row.dataset.key as Toggle | undefined;
    if (key) {
      save({ [key]: !getSettings()[key] }, "perm");
      return;
    }
    // Locked: a small shake says "always on".
    const sw = row.querySelector<HTMLElement>(".switch")!;
    sw.classList.remove("nope");
    void sw.offsetWidth;
    sw.classList.add("nope");
  });

  const seg = $("seg");
  const pick = (mode: AgentSettings["approval"]): void => {
    if (getSettings().approval !== mode) save({ approval: mode }, "appr");
  };
  seg.addEventListener("click", e => {
    const radio = (e.target as Element).closest<HTMLElement>("[role=radio]");
    if (radio?.dataset.mode === "ask" || radio?.dataset.mode === "auto") pick(radio.dataset.mode);
  });
  seg.addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const mode = e.key === "ArrowLeft" || e.key === "ArrowUp" ? "ask" : "auto";
    pick(mode);
    seg.querySelector<HTMLElement>(`[data-mode="${mode}"]`)?.focus();
  });

  for (const f of FIELDS) {
    const input = $<HTMLInputElement>(`amt-${f.id}`);
    let timer: number | undefined;
    input.addEventListener("input", () => {
      const v = parseAmount(input.value);
      showHint(f, v);
      clearTimeout(timer);
      if (v !== undefined) timer = window.setTimeout(() => commit(f, v), 400);
    });
    input.addEventListener("blur", () => {
      clearTimeout(timer);
      const v = parseAmount(input.value);
      if (v !== undefined) commit(f, v);
      input.value = fmt(getSettings()[f.key], f.digits);
      showHint(f, getSettings()[f.key]);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") input.blur();
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      step(f, e.key === "ArrowUp" ? 1 : -1);
    });
  }
  $("auto-fold").addEventListener("click", e => {
    const button = (e.target as Element).closest<HTMLButtonElement>(".step");
    const f = FIELDS.find(x => x.id === button?.dataset.field);
    if (button && f) step(f, Number(button.dataset.dir));
  });

  $("token-btn").addEventListener("click", async () => {
    if (!(await ensureOperatorToken())) return;
    serverState();
    toast("Operator token kept for this tab. Auto-approve is running.");
    void runAutopilot();
  });

  $("set-reset").addEventListener("click", () => {
    saveSettings({ ...DEFAULT_SETTINGS });
    flash("perm");
    flash("appr");
    toast("Agent settings are back to the defaults.");
  });
}

function step(f: Field, dir: number): void {
  const input = $<HTMLInputElement>(`amt-${f.id}`);
  const current = parseAmount(input.value) ?? getSettings()[f.key];
  const next = Math.max(0, Number((current + dir * f.step).toFixed(f.digits)));
  input.value = fmt(next, f.digits);
  showHint(f, next);
  commit(f, next);
}

let refreshTimer: number | undefined;
/** Fresh /api/health while the view is open; meters refill on every visit. */
function enter(): void {
  live();
  replayMeters();
  const refresh = async (): Promise<void> => {
    await Promise.all([loadHealth(), loadBudget()]);
    if (currentRoute().view !== "settings") return;
    live();
    refreshTimer = window.setTimeout(() => void refresh(), 8000);
  };
  clearTimeout(refreshTimer);
  void refresh();
}

/** Renders the Agent settings view into #view-settings. */
export function initSettings(): void {
  const view = $("view-settings");
  view.innerHTML = html();
  wire();
  initBudget();
  sync();
  live();
  onSettings(sync);
  onAutoChange(() => serverState());
  onRoute(route => {
    if (route.view === "settings") enter();
    else clearTimeout(refreshTimer);
  });
}

