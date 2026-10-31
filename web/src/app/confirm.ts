import type { BudgetLine, Money, PaymentDestination, PaymentSource } from "../../../src/contracts.js";
import { ada, amountText, decimalMoney, esc, money } from "../shared/dom.js";
import { getPreview, getRun, type PaymentPreview, type Run } from "./api.js";
import { decideRun, emitPaymentChange } from "./approval.js";
import { payoutHtml } from "./assistant/cards.js";
import { go } from "./router.js";
import { markAttempted } from "./settings/auto-state.js";
import { railBlock } from "./settings/policy.js";
import { getSettings, onSettings } from "./settings/store.js";
import { I, addrHtml, bindAddr, callout, checkList, clock, txLink } from "./ui.js";

/**
 * The payment confirmation window. Every manual approval goes through it: it shows the server's
 * preview (verified payee, source account, proof, budget) and only "Confirm and pay" approves.
 */

/** What the human did in the window. */
export type Outcome = "approved" | "rejected" | undefined;

type Phase = "loading" | "failed" | "review" | "reject" | "busy" | "progress";

interface Win {
  id: string;
  dialog: HTMLDialogElement;
  phase: Phase;
  busy?: "approve" | "reject";
  preview?: PaymentPreview;
  run?: Run;
  /** EXECUTING entries before this window's approval: a newer one is the outcome of it. */
  epoch: number;
  /** Opened on a payout that was already approved elsewhere: only follows it. */
  watching?: boolean;
  approvedAt?: string;
  error?: string;
  /** Quiet line above the buttons (cancelled token dialog, 409). */
  note?: string;
  outcome: Outcome;
  timer?: number;
  closed: boolean;
  promise: Promise<Outcome>;
  resolve: (outcome: Outcome) => void;
}

interface Pending {
  id: string;
  promise: Promise<Outcome>;
  resolve: (outcome: Outcome) => void;
}

const POLL_MS = 1500;
const SETTLED: readonly Run["state"][] = ["EXECUTED", "PAYOUT_UNKNOWN", "FAILED", "REJECTED"];
const waiting: Pending[] = [];
let win: Win | undefined;
let pumpTimer: number | undefined;

const executions = (run: Run): number => run.timeline.filter(t => t.state === "EXECUTING").length;
const settled = (w: Win, run: Run): boolean =>
  SETTLED.includes(run.state) || (run.state === "DRAFT_READY" && executions(run) > w.epoch);

/**
 * Opens the confirmation window for a run and resolves when it closes. A second call for the run
 * on screen returns the same promise; any other run waits until no dialog is open.
 */
export function confirmPayment(runId: string): Promise<Outcome> {
  if (win?.id === runId) return win.promise;
  const queued = waiting.find(p => p.id === runId);
  if (queued) return queued.promise;
  let resolve!: (outcome: Outcome) => void;
  const promise = new Promise<Outcome>(r => (resolve = r));
  waiting.push({ id: runId, promise, resolve });
  pump();
  return promise;
}

function pump(): void {
  clearTimeout(pumpTimer);
  if (win || !waiting.length) return;
  // Another modal (the operator token dialog) goes first.
  if (document.querySelector("dialog[open]")) {
    pumpTimer = window.setTimeout(pump, 400);
    return;
  }
  open(waiting.shift()!);
}

function open(next: Pending): void {
  const dialog = document.createElement("dialog");
  dialog.className = "pay-dialog";
  dialog.setAttribute("aria-labelledby", "pd-title");
  dialog.innerHTML = `<header class="pd-head"></header><div class="pd-body"></div><footer class="pd-foot"></footer><p class="pd-live set-sr" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const w: Win = { id: next.id, dialog, phase: "loading", epoch: 0, outcome: undefined, closed: false, promise: next.promise, resolve: next.resolve };
  win = w;
  bindAddr(dialog);
  dialog.addEventListener("click", e => void onClick(w, e));
  dialog.addEventListener("close", () => {
    w.closed = true;
    clearTimeout(w.timer);
    dialog.remove();
    if (win === w) win = undefined;
    w.resolve(w.outcome);
    pump();
  });
  render(w);
  dialog.showModal();
  void load(w);
}

async function load(w: Win): Promise<void> {
  w.phase = "loading";
  render(w);
  const [res, run] = await Promise.all([getPreview(w.id), getRun(w.id).catch(() => undefined)]);
  if (w.closed) return;
  if (!res.ok) {
    w.phase = "failed";
    w.error = res.status === 404 ? "The agent does not know this invoice (any more)."
      : res.status === 0 ? "The agent could not be reached."
      : `The preview could not be loaded: ${res.error}.`;
    render(w);
    return;
  }
  w.preview = res.data;
  w.run = run;
  w.epoch = run ? executions(run) : 0;
  const state = run?.state ?? res.data.state;
  // Already decided elsewhere: show where it stands instead of a preview that cannot be confirmed.
  const decided = state === "EXECUTING" || state === "EXECUTED" || state === "PAYOUT_UNKNOWN" || state === "REJECTED" || (state === "FAILED" && run && executions(run) > 0);
  if (decided && run) {
    w.watching = true;
    w.epoch = Math.max(0, executions(run) - 1);
    w.approvedAt = run.timeline.filter(t => t.state === "EXECUTING").at(-1)?.at;
    w.phase = "progress";
    render(w);
    if (!settled(w, run)) w.timer = window.setTimeout(() => void follow(w), POLL_MS);
    return;
  }
  w.phase = "review";
  render(w);
}

/** Polls the run after a decision until it settles. */
async function follow(w: Win): Promise<void> {
  clearTimeout(w.timer);
  let run: Run | undefined;
  try {
    run = await getRun(w.id);
  } catch {
    if (!w.closed) w.timer = window.setTimeout(() => void follow(w), POLL_MS);
    return;
  }
  if (w.closed) return;
  if (!run) {
    w.error = "The agent no longer knows this run (it restarted). Check the Inbox before trying again.";
    render(w);
    return;
  }
  w.run = run;
  render(w);
  if (settled(w, run)) emitPaymentChange(w.id);
  else w.timer = window.setTimeout(() => void follow(w), POLL_MS);
}

/** Why "Confirm and pay" is off, if it is (no trailing period). */
function blockOf(p: PaymentPreview): string | undefined {
  if (p.approvals === "disabled") return "Approvals are switched off on this server (no operator token configured)";
  if (p.blockers.length) return p.blockers.map(b => b.replace(/\.\s*$/, "")).join(" · ");
  if (!p.payable) return "The agent says this payout cannot start now";
  return railBlock(p.rail, getSettings());
}

async function decide(w: Win, decision: "approve" | "reject"): Promise<void> {
  const p = w.preview;
  if (!p || w.phase === "busy") return;
  if (decision === "approve" && blockOf(p)) return render(w);
  w.phase = "busy";
  w.busy = decision;
  w.note = undefined;
  render(w);
  // A click takes over from auto-approve for this draft.
  if (decision === "approve") markAttempted(w.id);
  const verb = decision === "approve" ? "approved" : "rejected";
  let res: Awaited<ReturnType<typeof decideRun>>;
  try {
    res = await decideRun(w.id, decision);
  } catch {
    res = { ok: false, error: "The agent could not be reached", status: -1 };
  }
  w.busy = undefined;
  if (w.closed) return;
  if (!res.ok) {
    if (decision === "approve" && (res.status === 0 || res.status === 401)) markAttempted(w.id, false);
    w.phase = "review";
    w.note = res.status === 0 ? res.error
      : res.status === 401 ? `The operator token was not accepted. Nothing was ${verb}; try again.`
      : res.status === 409 ? `It is no longer waiting for a decision: ${res.error}. Nothing was ${verb}.`
      : `${res.error}. Nothing was ${verb}.`;
    if (res.status === 409) {
      const note = w.note;
      await load(w);
      w.note = note;
    }
    render(w);
    return;
  }
  w.outcome = decision === "approve" ? "approved" : "rejected";
  w.approvedAt = new Date().toISOString();
  w.phase = "progress";
  render(w);
  void follow(w);
}

async function onClick(w: Win, e: MouseEvent): Promise<void> {
  const target = e.target as Element;
  // In-app links (Agent settings) leave the window.
  const link = target.closest<HTMLAnchorElement>('a[href^="#/"]');
  if (link) {
    w.dialog.close();
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-pd]");
  if (!button || button.disabled) return;
  switch (button.dataset.pd) {
    case "close":
      w.dialog.close();
      return;
    case "confirm":
      return decide(w, "approve");
    case "reject":
      w.phase = "reject";
      w.note = undefined;
      return render(w);
    case "keep":
      w.phase = "review";
      return render(w);
    case "reject-yes":
      return decide(w, "reject");
    case "inbox":
      w.dialog.close();
      go("inbox", w.id);
      return;
    case "again":
      w.outcome = undefined;
      w.watching = false;
      w.note = undefined;
      return load(w);
  }
}

// Markup

const put = (el: HTMLElement, html: string): boolean => {
  if (el.dataset.sig === html) return false;
  el.dataset.sig = html;
  el.innerHTML = html;
  return true;
};

function render(w: Win): void {
  if (w.closed) return;
  const d = w.dialog;
  const body = d.querySelector<HTMLElement>(".pd-body")!;
  const phaseWas = body.dataset.phase;
  put(d.querySelector<HTMLElement>(".pd-head")!, headHtml(w));
  const view = w.phase === "progress" ? "progress" : w.phase === "failed" || w.phase === "loading" ? w.phase : "review";
  if (put(body, bodyHtml(w)) && phaseWas !== view) body.scrollTop = 0;
  body.dataset.phase = view;
  put(d.querySelector<HTMLElement>(".pd-foot")!, footHtml(w));
  d.classList.toggle("is-busy", w.phase === "busy");
  const live = d.querySelector<HTMLElement>(".pd-live")!;
  const said = liveText(w);
  if (live.textContent !== said) live.textContent = said;
  // A re-rendered button drops focus to the body: hand it to the safe default of the new state
  // (never away from a dialog on top, like the operator token).
  const active = document.activeElement;
  if (!active || active === document.body || active === d) d.querySelector<HTMLElement>("[data-focus]")?.focus();
}

/** Short status for screen readers, said when it changes. */
function liveText(w: Win): string {
  const run = w.run;
  if (w.phase === "failed") return "No preview. Nothing was paid.";
  if (w.phase !== "progress") return "";
  if (run?.state === "REJECTED") return "Rejected. Nothing will be paid.";
  if (!run || !settled(w, run)) return "Paying.";
  if (run.state === "EXECUTED") return `${run.payout?.status === "simulated" ? "Simulated" : "Paid"}: ${money(run.payout?.amountMinor, run.payout?.currency)}.`;
  if (run.state === "DRAFT_READY") return "Payout refused. Nothing was paid.";
  return run.state === "PAYOUT_UNKNOWN" ? "Payout outcome unknown." : "Nothing was sent.";
}

function headHtml(w: Win): string {
  const p = w.preview;
  const state = w.run?.state;
  const eyebrow = w.phase === "progress"
    ? state === "REJECTED" ? "Rejected" : w.run && settled(w, w.run) ? "Payment result" : "Paying"
    : "Confirm payment";
  const title = p?.invoice.supplier || "Payment";
  return `<div class="pd-title"><span class="pd-eyebrow">${esc(eyebrow)}</span><h2 id="pd-title">${esc(title)}</h2></div>
    <button class="pd-x" type="button" data-pd="close" aria-label="Close">${I.close}</button>`;
}

function bodyHtml(w: Win): string {
  if (w.phase === "loading") {
    return `<div class="pd-loading" aria-busy="true"><span class="sk" style="width:46%;height:34px"></span><span class="sk" style="width:30%"></span><span class="sk" style="width:100%;height:96px;margin-top:10px"></span><span class="sk" style="width:80%"></span><span class="sk" style="width:64%"></span><span class="set-sr">Loading the payment preview…</span></div>`;
  }
  if (w.phase === "failed") return callout("bad", "No preview, nothing to confirm", `${esc(w.error)} Nothing was paid.`);
  if (w.phase === "progress") return progressHtml(w);
  return previewHtml(w.preview!);
}

function footHtml(w: Win): string {
  if (w.phase === "loading" || w.phase === "failed") {
    return `<div class="pd-actions"><button class="btn ghost" type="button" data-pd="close" data-focus>Close</button></div>`;
  }
  if (w.phase === "progress") return progressFoot(w);
  const p = w.preview!;
  if (w.phase === "reject") {
    return `<p class="pd-why bad">${I.alert}<span>Reject this invoice? Nothing will be paid and the draft closes for good.</span></p>
      <div class="pd-actions"><button class="btn ghost" type="button" data-pd="keep" data-focus>Keep it</button><button class="btn danger" type="button" data-pd="reject-yes">Reject invoice</button></div>`;
  }
  const busy = w.phase === "busy";
  const block = blockOf(p);
  const open = p.state === "DRAFT_READY";
  const why = block
    ? `<p class="pd-why${p.blockers.length ? " bad" : ""}" id="pd-why">${I.alert}<span>${esc(block)}.${railBlock(p.rail, getSettings()) === block ? ` <a href="#/settings">Agent settings</a>` : ""}</span></p>`
    : w.note ? `<p class="pd-why soft">${I.info}<span>${esc(w.note)}</span></p>`
    : `<p class="pd-fine">${I.shieldSm}<span>Pays exactly this, to this account. Nothing else can change it.</span></p>`;
  const loading = (act: "approve" | "reject") => (w.busy === act ? " loading" : "");
  const off = busy ? " disabled" : "";
  return `${block && w.note ? `<p class="pd-why soft">${I.info}<span>${esc(w.note)}</span></p>` : ""}${why}
    <div class="pd-actions">
      ${open ? `<button class="btn ghost pd-reject${loading("reject")}" type="button" data-pd="reject"${off}>Reject</button>` : ""}
      <span class="pd-gap"></span>
      <button class="btn ghost" type="button" data-pd="close" data-focus${off}>Not now</button>
      <button class="btn primary${loading("approve")}" type="button" data-pd="confirm"${block || busy ? " disabled" : ""}${block ? ` aria-describedby="pd-why"` : ""}>${I.lock} Confirm and pay</button>
    </div>`;
}

/** "1,250.00" and "EUR" (ADA: "2.50" and "tADA"). */
const amountParts = (m: Money): [string, string] => [amountText(m.minor, m.currency), m.currency === "ADA" ? "tADA" : m.currency];

const list = (items: string[]): string =>
  items.length === 1 ? esc(items[0]) : `<ul class="pd-list">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;

const kv = (rows: Array<[string, string] | undefined>, cls = ""): string =>
  `<dl class="pd-kv${cls ? ` ${cls}` : ""}">${rows.filter((r): r is [string, string] => Boolean(r)).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

const SIM = `<span class="sim">simulated</span>`;

function sourceHtml(from?: PaymentSource): string {
  if (!from) return `<b>Not chosen</b><span class="pd-meta">No source account for this payout</span>`;
  if (from.kind === "simulated") return `<b>${esc(from.label)}</b><span class="pd-meta">No money moves ${SIM}</span>`;
  if (from.kind === "cardano_wallet") {
    return `<b>Agent wallet</b><span class="pd-meta">Cardano Preprod · test ADA</span>${addrHtml(from.address)}
      ${from.balanceLovelace !== undefined ? `<span class="pd-bal"><b>${esc(ada(from.balanceLovelace))}</b> available</span>` : ""}`;
  }
  return `<b>${esc(from.name || "CashXChain account")}</b><span class="pd-meta">CashXChain · ${esc(from.currency)} account</span>
    <span class="mono pd-id">${esc(from.accountId)}</span>
    ${from.available !== undefined ? `<span class="pd-bal"><b>${esc(decimalMoney(from.available, from.currency))}</b> available</span>` : ""}`;
}

const iban = (v: string): string => v.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

function destinationHtml(to?: PaymentDestination): string {
  if (!to) return "";
  if (to.kind === "cardano_address") return `<span class="pd-meta">Cardano Preprod wallet</span>${addrHtml(to.address)}`;
  if (to.kind === "iban") return kv([["IBAN", `<span class="mono">${esc(iban(to.iban))}</span>`], to.bic ? ["BIC", `<span class="mono">${esc(to.bic)}</span>`] : undefined], "sm");
  return kv([
    ["Routing", `<span class="mono">${esc(to.routingNumber)}</span>`],
    ["Account", `<span class="mono">${esc(to.accountNumber)}</span>`],
    to.accountType ? ["Type", esc(to.accountType)] : undefined,
  ], "sm");
}

const VERDICT: Record<string, [string, string]> = {
  ready_for_review: ["Ready for review", "t-ok"],
  needs_info: ["Needs information", "t-warn"],
  blocked: ["Blocked", "t-bad"],
};

function budgetHtml(b: BudgetLine): string {
  const m = (v: number) => esc(money(v, b.currency));
  const pct = (v: number, of: number) => (of > 0 ? Math.min(100, Math.max(0, (v / of) * 100)) : 0);
  const used = pct(b.usedMinor, b.limitMinor);
  const after = pct(b.afterMinor, b.limitMinor);
  const over = b.afterMinor > b.limitMinor;
  const left = Math.max(0, b.limitMinor - b.afterMinor);
  const po = b.payouts;
  const count = po ? `<div class="pd-bud-row">
      <div class="pd-bud-top"><span>Fiat payouts this session</span><b>${po.used + 1} <small>of ${po.limit} after this one</small></b></div>
      <div class="pd-meter${po.used + 1 > po.limit ? " over" : ""}"><i class="u" style="width:${pct(po.used, po.limit).toFixed(1)}%"></i><i class="n" style="left:${pct(po.used, po.limit).toFixed(1)}%;width:${(pct(po.used + 1, po.limit) - pct(po.used, po.limit)).toFixed(1)}%"></i></div>
    </div>` : "";
  return `<div class="pd-bud-row">
      <div class="pd-bud-top"><span>${esc(b.label)}</span><b>${m(b.afterMinor)} <small>of ${m(b.limitMinor)} after this payment</small></b></div>
      <div class="pd-meter${over ? " over" : ""}" role="img" aria-label="${esc(`${money(b.usedMinor, b.currency)} used, ${money(b.afterMinor, b.currency)} after this payment, of ${money(b.limitMinor, b.currency)}`)}"><i class="u" style="width:${used.toFixed(1)}%"></i><i class="n" style="left:${used.toFixed(1)}%;width:${(after - used).toFixed(1)}%"></i></div>
      <div class="pd-legend"><span><i class="u"></i>Used ${m(b.usedMinor)}</span><span><i class="n"></i>This payment</span><span>${over ? `<b class="bad">Over the limit</b>` : `${m(left)} left after`}</span></div>
    </div>
    ${kv([["Per-payment cap", m(b.perPaymentMaxMinor)]], "sm")}
    ${count}`;
}

function previewHtml(p: PaymentPreview): string {
  const [num, unit] = amountParts(p.amount);
  const inv = p.invoice;
  const alerts = [
    p.blockers.length ? callout("bad", "Cannot be paid", list(p.blockers)) : "",
    p.warnings.length ? callout("warn", p.warnings.length === 1 ? "Worth a look" : "Worth a look before you pay", list(p.warnings)) : "",
  ].join("");
  const invoiceAmount = inv.amount.minor !== p.amount.minor || inv.amount.currency !== p.amount.currency;
  const c = p.check;
  const verdict = VERDICT[c.verdict] ?? [c.verdict, "t-run"];
  const fee = p.fee ? `${esc(decimalMoney(p.fee.amount, p.fee.currency))}${p.fee.simulated ? SIM : ""}` : "";
  const extra = kv([
    fee ? ["Fee quote", fee] : undefined,
    p.idempotencyKey ? ["Idempotency-Key", `<span class="mono pd-key">${esc(p.idempotencyKey)}</span>`] : undefined,
  ], "sm");
  return `<div class="pd-hero">
      <span class="pd-lab">You pay</span>
      <div class="pd-amt"><b>${esc(num)}</b><span>${esc(unit)}</span></div>
      <div class="pd-rail"><span class="rail">${esc(p.railLabel)}</span>${p.from?.kind === "simulated" ? SIM : ""}</div>
    </div>
    ${alerts}
    <div class="pd-flow">
      <div class="pd-party"><span class="pd-lab">From</span>${sourceHtml(p.from)}</div>
      <span class="pd-arrow" aria-hidden="true">${I.arrowRight}</span>
      <div class="pd-party"><span class="pd-lab">To</span>
        <b>${esc(p.payee || inv.supplier)}${p.payee ? `<span class="ok-badge">${I.check}verified</span>` : ""}</b>
        ${destinationHtml(p.to)}
        ${p.payee ? `<p class="pd-src">${I.shieldSm}<span>From your verified payee directory, not from the invoice.</span></p>` : ""}
      </div>
    </div>
    <section class="pd-sec" aria-labelledby="pd-s-inv"><h3 id="pd-s-inv">Invoice</h3>
      ${kv([
        ["Supplier", esc(inv.supplier)],
        ["Invoice", `<span class="mono">${esc(inv.id)}</span>`],
        inv.reference ? ["Reference", `<span class="mono">${esc(inv.reference)}</span>`] : undefined,
        ["Country", esc(inv.destinationCountry)],
        invoiceAmount ? ["Invoice amount", esc(money(inv.amount.minor, inv.amount.currency))] : undefined,
      ])}
    </section>
    <section class="pd-sec" aria-labelledby="pd-s-proof"><h3 id="pd-s-proof">Proof of verification</h3>
      <div class="pd-proof"><span class="pill ${verdict[1]}">${esc(verdict[0])}</span>${c.priceLovelace ? `<span class="pd-meta">Paid check · ${esc(ada(c.priceLovelace))} via x402</span>` : ""}${txLink(c.txHash, c.explorerUrl)}</div>
      ${c.checks.length ? checkList(c.checks) : `<p class="pd-meta">No checks in the report.</p>`}
    </section>
    <section class="pd-sec" aria-labelledby="pd-s-bud"><h3 id="pd-s-bud">Budget</h3>${budgetHtml(p.budget)}</section>
    ${fee || p.idempotencyKey ? `<section class="pd-sec" aria-labelledby="pd-s-more"><h3 id="pd-s-more">Payout details</h3>${extra}</section>` : ""}`;
}

type StepCls = "done" | "active" | "pending" | "bad" | "warn";
const step = (cls: StepCls, title: string, sub = ""): string =>
  `<li class="${cls}"><span class="pd-node">${cls === "done" ? I.check : cls === "bad" || cls === "warn" ? "!" : cls === "active" ? `<i></i>` : ""}</span><div><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div></li>`;

function progressHtml(w: Win): string {
  const run = w.run;
  const state = run?.state;
  if (state === "REJECTED" || (w.outcome === "rejected" && !run)) {
    return `<div class="pd-result bad">${I.alert}<div><b>Rejected</b><span>Nothing will be paid for this invoice.</span></div></div>`;
  }
  const cardano = (w.preview?.rail ?? run?.draft?.route.rail) === "cardano_preprod";
  const at = w.approvedAt ? ` at ${esc(clock(w.approvedAt))}` : "";
  const refused = run !== undefined && state === "DRAFT_READY" && executions(run) > w.epoch;
  const sendTitle = cardano ? "Send on Cardano Preprod" : "Submit to CashXChain";
  let send: string;
  let last: string;
  let result = "";
  if (!run || state === "EXECUTING" || (state === "DRAFT_READY" && !refused)) {
    send = step("active", sendTitle, cardano ? "The agent wallet signs the transfer and waits for the block…" : "Submitting the payout…");
    last = step("pending", "Paid");
  } else if (state === "EXECUTED") {
    const po = run.payout;
    send = step("done", sendTitle, po?.status === "simulated" ? "Simulated, no money moved" : cardano ? "Broadcast" : "Accepted by CashXChain");
    last = step("done", po?.status === "submitted" ? "Submitted" : po?.status === "simulated" ? "Paid · simulated" : "Paid");
    result = po ? payoutHtml(po) : "";
    if (po && !po.explorerUrl && !po.reference) result += `<p class="fine">No payout reference was returned.</p>`;
  } else if (state === "PAYOUT_UNKNOWN") {
    send = step("bad", sendTitle, "Outcome unknown");
    last = step("pending", "Paid");
    result = `${callout("bad", "Payout outcome unknown", `${esc(run.payout?.label || "The payout may or may not have gone through")}. The invoice is locked so it can never be paid twice.`)}${txLink(run.payout?.reference, run.payout?.explorerUrl)}`;
  } else if (refused) {
    send = step("warn", sendTitle, "Refused before anything was sent");
    last = step("pending", "Paid");
    result = callout("warn", "Payout refused, nothing was paid", `${esc(run.error || run.timeline.at(-1)?.note || "No reason given")}. You can review it again.`);
  } else {
    send = step("bad", sendTitle, "Stopped");
    last = step("pending", "Paid");
    result = callout("bad", "Nothing was sent", `${esc(run.error || "The payout stopped")}. The invoice was not paid.`);
  }
  const lost = w.error && w.phase === "progress" ? callout("warn", "Lost track of the run", esc(w.error)) : "";
  return `<ol class="pd-steps">
      ${step("done", w.watching ? "Approved" : "Approved by you", at ? `Confirmed${at}` : "")}
      ${send}${last}
    </ol>${result}${lost}`;
}

function progressFoot(w: Win): string {
  const run = w.run;
  const done = run !== undefined && settled(w, run);
  if (!done && !w.error) {
    return `<p class="pd-fine">${I.info}<span>You can close this window. The payout keeps going and shows in the Inbox.</span></p>
      <div class="pd-actions"><span class="pd-gap"></span><button class="btn ghost" type="button" data-pd="close" data-focus>Close</button></div>`;
  }
  const refused = run?.state === "DRAFT_READY";
  return `<div class="pd-actions">
      <button class="btn ghost" type="button" data-pd="inbox">Open in Inbox</button><span class="pd-gap"></span>
      ${refused ? `<button class="btn ghost" type="button" data-pd="again">Review again</button>` : ""}
      <button class="btn primary" type="button" data-pd="close" data-focus>Done</button>
    </div>`;
}

// Agent settings can switch a rail off while the window is open.
onSettings(() => {
  if (win && (win.phase === "review" || win.phase === "reject")) render(win);
});
