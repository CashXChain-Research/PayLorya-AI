import type { PayoutResult } from "../../../src/types.js";
import { ada, esc, money, short } from "../shared/dom.js";
import type { Health, Run, RunState } from "./api.js";
import { autoLimitText, autoNeedsToken, wasAttempted, wasAutoApproved } from "./settings/auto-state.js";
import { approvalBlock, autoApproves } from "./settings/policy.js";
import { getSettings } from "./settings/store.js";
import { I, callout, checkList, clock, eta, txLink, type CheckRow } from "./ui.js";

/** States where polling stops: the agent is done or waits for a human. */
export const TERMINAL: readonly RunState[] = ["DRAFT_READY", "NEEDS_INFO", "BLOCKED", "SETTLEMENT_UNKNOWN", "FAILED", "EXECUTED", "PAYOUT_UNKNOWN", "REJECTED"];
/** States where the CFO held the invoice back. */
export const HELD: readonly RunState[] = ["NEEDS_INFO", "BLOCKED", "SETTLEMENT_UNKNOWN", "FAILED", "PAYOUT_UNKNOWN", "REJECTED"];

const RAIL: Record<string, string> = { cardano_preprod: "Cardano Preprod · tADA", cxc_fiat: "CashXChain · fiat" };
const rail = (r?: string): string => esc(r ? RAIL[r] ?? r : "");

// Spend-policy refusals (src/agent.ts): nothing was signed for these.
const STOP_TEXT: Record<string, string> = {
  "already paid": "This invoice was already verified and paid once",
  "already in progress": "A payment for this invoice is already in progress",
  "budget exhausted": "The session budget is used up",
  "unknown settlement": "An earlier payment for this invoice is still unresolved",
  "max payments": "The payment limit for this run is reached",
};
const stopReason = (error = ""): string | undefined => Object.keys(STOP_TEXT).find(k => error.includes(k));
const stopText = (error = ""): string => STOP_TEXT[stopReason(error) ?? ""] ?? error;
const reached = (run: Run, state: RunState): boolean => run.timeline.some(t => t.state === state);
const isPolicyStop = (run: Run): boolean => run.state === "FAILED" && !reached(run, "EXECUTING") && stopReason(run.error) !== undefined;

const PAYOUT_TITLE: Record<Exclude<PayoutResult["status"], "unknown">, string> = {
  confirmed: "Paid",
  submitted: "Payout submitted",
  simulated: "Payout simulated",
};

export type StageKey = "read" | "verify" | "route" | "approve" | "pay";
export type StageClass = "done" | "active" | "pending" | "skip" | "warn" | "bad";
/** sum, call, card and more are HTML. */
export interface Stage {
  key: StageKey;
  cls: StageClass;
  title: string;
  by: string;
  sum: string;
  call?: string;
  card?: string;
  more?: string;
}

const set = (stage: Stage, patch: Partial<Stage>): void => void Object.assign(stage, patch);

export function stagesFor(run: Run, health: Partial<Health>): Stage[] {
  const inv = run.invoice;
  const s = run.state;
  const ended = TERMINAL.includes(s);
  const later: StageClass = ended ? "skip" : "pending";
  const out: Stage[] = [];

  // 1. Read
  const read: Stage = { key: "read", cls: "active", title: "Read the invoice", by: "Claude", sum: "" };
  if (inv) {
    const account = inv.currency === "ADA"
      ? inv.cardanoAddress
      : inv.iban || (inv.routingNumber ? `ABA ${inv.routingNumber} / ${inv.accountNumber || "?"}` : "");
    const found = inv.currency === "ADA"
      ? (inv.cardanoAddress ? "a Cardano wallet" : "no wallet")
      : inv.iban ? "an IBAN" : inv.routingNumber ? "US bank details" : "no bank details";
    set(read, {
      cls: "done",
      sum: `Found <b>${esc(money(inv.amountMinor, inv.currency))}</b> from ${esc(inv.supplier)}, with ${found}.`,
      more: `<dl class="kv"><dt>Invoice</dt><dd>${esc(inv.id)}${inv.reference ? ` · ref ${esc(inv.reference)}` : ""}</dd><dt>Country</dt><dd>${esc(inv.destinationCountry)}</dd>${account ? `<dt>Account</dt><dd class="mono">${esc(account)}${inv.bic ? ` · ${esc(inv.bic)}` : ""}</dd>` : ""}</dl>
        <p class="fine">Claude returns fields only. It cannot choose who gets paid, the price or the budget.</p>`,
    });
  } else if (s === "FAILED") {
    set(read, { cls: "bad", sum: esc(run.error) });
  } else {
    read.sum = `<span class="sk" style="width:70%;margin-top:8px"></span><span class="sk" style="width:45%;margin-top:8px"></span>`;
  }
  out.push(read);

  // 2. Verify: precheck, then the x402-paid readiness report
  const v: Stage = { key: "verify", cls: later, title: "Verify with a paid agent", by: "x402 · Cardano", sum: "" };
  const price = health.priceLovelace;
  const foreign = (run.input || "").match(/addr_test1[0-9a-z]{20,}/g)?.find(a => a !== health.sellerAddress && a !== health.supplierCardanoAddress);
  if (s === "NEEDS_INFO" && !run.report && !reached(run, "PAYING")) {
    set(v, { cls: "warn", sum: `Held before paying anything: ${esc(run.timeline.at(-1)?.note || "missing details")}.` });
  } else if (run.payment) {
    const r = run.report;
    const verdict = r?.verdict;
    const failing = (r?.checks ?? []).filter(c => c.status === "fail" || c.status === "warn").map(c => c.message);
    const verdictText = !r ? ""
      : verdict === "ready_for_review" ? " The report says it is ready to pay."
      : verdict === "blocked" ? ` Report: blocked. ${failing.join("; ")}.`
      : ` Report: needs information. ${failing.join("; ")}.`;
    const policy: CheckRow[] = [
      { status: "pass", message: `Payee is the allow-listed PayLorya verifier ${short(health.sellerAddress)}` },
      { status: "pass", message: `Price ${ada(run.payment.amount)} within the ${ada(health.maxPriceLovelace)} cap` },
      { status: "pass", message: "Within the session budget" },
      { status: "pass", message: "First payment for this invoice" },
    ];
    const q = r?.routeQuote;
    const noReport = !r && s === "FAILED";
    set(v, {
      cls: noReport || verdict === "blocked" ? "bad" : !r || verdict === "ready_for_review" ? "done" : "warn",
      sum: `Paid <b>${esc(ada(run.payment.amount))}</b> per request for a readiness report.${esc(noReport ? ` ${run.error}.` : verdictText)}<br>${txLink(run.payment.transactionHash, run.payment.explorerUrl)}`,
      more: `<div class="sub-h">Spend policy</div>${checkList(policy)}
        ${r ? `<div class="sub-h">Report</div>${checkList(r.checks)}` : ""}
        ${q ? `<p class="fine">${esc(q.label)}: ${esc(q.rail)} · fee USD ${esc(q.feeUsd)} · ${esc(q.fxRate)}</p>` : ""}
        <p class="fine">Pay for results only: the verifier settles after the report is delivered.</p>`,
    });
  } else if (isPolicyStop(run)) {
    set(v, {
      cls: "bad",
      sum: `Refused before signing. ${esc(stopText(run.error))}. No transaction, spend unchanged.`,
      more: `<p class="fine mono" style="margin:0">${esc(run.error)}</p>`,
    });
  } else if (s === "SETTLEMENT_UNKNOWN") {
    set(v, { cls: "bad", sum: `Settlement unclear. The invoice is locked so it can never be paid twice.<br>${txLink(run.settlement?.transactionHash, run.settlement?.explorerUrl)}` });
  } else if (s === "FAILED" && inv) {
    set(v, { cls: "bad", sum: esc(run.error) });
  } else if (reached(run, "PAYING")) {
    set(v, { cls: "active", sum: `Paying <b>${esc(ada(price))}</b> on Cardano Preprod. Settles in 1 to 3 minutes…` });
  } else if (reached(run, "PRECHECKED")) {
    set(v, { cls: "active", sum: "Bank details present. Queued for the agent wallet…" });
  } else {
    v.sum = `Buys a readiness report for ${esc(ada(price))} via x402.`;
  }
  if (foreign && inv?.currency !== "ADA" && (run.payment || v.cls === "active")) {
    v.call = callout("ok", "Prompt injection ignored", `The invoice told the agent to pay <span class="mono">${esc(short(foreign))}</span>. That address never reached the wallet.`);
  }
  out.push(v);

  // 3. Route
  const rt = run.route;
  const r3: Stage = { key: "route", cls: later, title: "Choose the payout rail", by: "Code", sum: ended ? "Not reached." : "Picks the rail from your verified payee records." };
  if (rt) {
    set(r3, {
      cls: rt.status === "selected" ? "done" : rt.status === "blocked" ? "bad" : "warn",
      sum: rt.status === "selected"
        ? `<span class="rail">${rail(rt.rail)}</span> to the verified account of ${esc(rt.payee)}.`
        : `${rt.rail ? `<span class="rail">${rail(rt.rail)}</span> ` : ""}${esc(rt.reason)}.`,
      call: rt.status === "blocked" ? callout("bad", "Payout blocked", "The report only checks that the account is well-formed. Your verified payee records decide where money goes.") : "",
      more: `${checkList(rt.checks.map(c => ({ ...c, source: "deterministic" })))}${rt.destination ? `<dl class="kv" style="margin-top:10px"><dt>Verified account</dt><dd class="mono">${esc(rt.destination)}</dd></dl>` : ""}`,
    });
  }
  out.push(r3);

  // 4. Approve
  const a: Stage = { key: "approve", cls: later, title: "Your approval", by: wasAutoApproved(run.id) ? "Your settings" : "You", sum: "" };
  if (run.draft) {
    const decided = s === "EXECUTING" || s === "EXECUTED" || s === "PAYOUT_UNKNOWN" || (s === "FAILED" && reached(run, "EXECUTING"));
    a.cls = s === "REJECTED" ? "bad" : decided ? "done" : run.draft.executable ? "active" : "warn";
    a.card = payCard(run, decided);
  } else {
    a.sum = s === "NEEDS_INFO" ? "Held until the supplier sends the missing details."
      : s === "BLOCKED" ? "Nothing to approve. The payout is blocked."
      : ended ? "Nothing to approve." : "Nothing is paid without your approval.";
  }
  out.push(a);

  // 5. Pay
  const po = run.payout;
  const onChain = rt?.rail === "cardano_preprod";
  const p: Stage = { key: "pay", cls: later, title: "Pay the supplier", by: rt?.rail ? (onChain ? "Cardano" : "CashXChain") : "", sum: "" };
  if (s === "EXECUTING") {
    set(p, { cls: "active", sum: onChain ? "Signed by the agent wallet. Broadcasting on Cardano Preprod and waiting for the block…" : "Submitting the payout to CashXChain…" });
  } else if (po && po.status !== "unknown") {
    p.cls = "done";
    p.card = payoutCard(po, po.status);
  } else if (s === "PAYOUT_UNKNOWN") {
    set(p, { cls: "bad", sum: `${esc(po?.label || "Payout outcome unknown")}. The invoice is locked so it can never be paid twice.<br>${txLink(po?.reference, po?.explorerUrl)}` });
  } else if (s === "FAILED" && reached(run, "EXECUTING")) {
    set(p, { cls: "bad", sum: `Nothing was sent: ${esc(run.error)}` });
  } else if (s === "REJECTED") {
    set(p, { cls: "skip", sum: "Rejected. Nothing will be paid." });
  } else if (s === "DRAFT_READY" && reached(run, "EXECUTING")) {
    // The rail refused before anything was sent; the backend reopens the draft for another approval.
    set(p, { cls: "warn", sum: `Refused before anything was sent: ${esc(run.error)}. Nothing was paid; you can approve again.` });
  } else if (s === "DRAFT_READY" && run.draft?.executable) {
    set(p, { cls: "pending", sum: "Runs on the selected rail after you approve." });
  } else {
    p.sum = ended ? "Not reached." : "Runs on the selected rail after you approve.";
  }
  out.push(p);
  return out;
}

function payoutCard(po: PayoutResult, status: keyof typeof PAYOUT_TITLE): string {
  const ref = po.explorerUrl
    ? txLink(po.reference, po.explorerUrl)
    : po.reference ? `<p class="fine">Payout ID <span class="mono">${esc(po.reference)}</span></p>` : "";
  return `<div class="success${status === "simulated" ? " simulated" : ""}">
      <svg class="tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg>
      <div><b>${PAYOUT_TITLE[status]} · ${esc(money(po.amountMinor, po.currency))}</b>
      <span>${esc(po.label)}.</span></div>
    </div>
    ${ref}`;
}

function payCard(run: Run, decided: boolean): string {
  const d = run.draft!;
  const rt = d.route;
  const q = d.routeQuote;
  const s = run.state;
  const simBadge = q?.source === "cxc-sandbox" ? "" : `<span class="sim">simulated</span>`;
  const fee = d.currency === "ADA" ? "~0.2 tADA network fee" : q ? `USD ${esc(q.feeUsd)}${simBadge}` : "–";
  const rows: Array<[string, string]> = [["To", `${esc(d.supplier)}${rt.status === "selected" ? `<span class="ok-badge">${I.check}verified</span>` : ""}`]];
  if (rt.destination) rows.push(["Account", `<span class="mono">${esc(short(rt.destination))}</span>`]);
  rows.push(["Rail", rt.rail ? rail(rt.rail) : "None"], ["Fee", fee]);
  if (q) rows.push(["Arrives", `${esc(eta(q.etaHours))} <span class="sim">estimate</span>`]);

  let foot: string;
  if (decided) {
    const at = run.timeline.find(t => t.state === "EXECUTING")?.at;
    const who = wasAutoApproved(run.id) ? "Approved automatically by your settings" : "Approved by you";
    foot = `<div class="stamp">${I.check} ${who}${at ? ` at ${esc(clock(at))}` : ""}</div>`;
  } else if (s === "REJECTED") {
    foot = `<div class="stamp bad">Rejected by you. Nothing will be paid.</div>`;
  } else if (d.executable && s === "DRAFT_READY") {
    // Agent settings apply on top of the server: a switched-off rail disables Approve, Reject stays.
    const settings = getSettings();
    const block = approvalBlock(run, settings);
    const auto = !block && autoApproves(run, settings) && !wasAttempted(run.id);
    const note = block
      ? `<div class="guard" id="guard-${esc(run.id)}">${I.alert}<span>${esc(block)}. <a href="#/settings">Change in Agent settings</a></span></div>`
      : auto && autoNeedsToken()
        ? `<p class="auto-note wait">${I.lock}<span>Within your ${esc(autoLimitText(d.currency, settings))} auto-approve limit. Waiting for the operator token: <a href="#/settings">enter it in Agent settings</a>.</span></p>`
        : auto
          ? `<p class="auto-note"><i></i><span>Within your ${esc(autoLimitText(d.currency, settings))} auto-approve limit. Approving automatically…</span></p>`
          : `<p class="fine">${esc(d.note)}</p>`;
    const approve = block
      ? `<button class="btn primary" type="button" data-act="approve" disabled aria-describedby="guard-${esc(run.id)}">${I.lock} Review and pay</button>`
      : `<button class="btn primary" type="button" data-act="approve">${I.lock} Review and pay</button>`;
    foot = `<div class="actions">${approve}<button class="btn ghost" type="button" data-act="reject">Reject</button></div>${note}`;
  } else {
    foot = `${callout("warn", "Cannot be paid yet", `${esc(rt.reason)}.`)}${s === "DRAFT_READY" ? `<div class="actions"><button class="btn ghost" type="button" data-act="reject">Reject</button></div>` : ""}`;
  }
  return `<div class="pay">
    <div class="pay-top"><span>You pay</span><b>${esc(money(d.amountMinor, d.currency))}</b></div>
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${foot}
  </div>`;
}

export function stageHtml(st: Stage, n: number): string {
  const node = st.cls === "done" ? I.check
    : st.cls === "bad" || st.cls === "warn" ? "!"
    : st.cls === "skip" ? "–"
    : st.cls === "active" ? `<i class="dot"></i>`
    : String(n);
  return `<div class="node">${node}</div>
    <div class="s-body">
      <div class="s-top"><h3>${st.title}</h3>${st.by ? `<span class="by">${esc(st.by)}</span>` : ""}${st.more ? `<button class="more" type="button" data-more aria-expanded="false">Details ${I.chev}</button>` : ""}</div>
      ${st.sum ? `<div class="s-sum">${st.sum}</div>` : ""}
      ${st.call || ""}${st.card || ""}
      ${st.more ? `<div class="fold"><div><div class="fold-in">${st.more}</div></div></div>` : ""}
    </div>`;
}
