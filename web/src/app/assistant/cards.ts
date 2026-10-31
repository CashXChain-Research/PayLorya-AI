import type { PayoutResult } from "../../../../src/types.js";
import { esc, money } from "../../shared/dom.js";
import type { Run } from "../api.js";
import { APPROVALS_OFF, approvalsDisabled } from "../approval.js";
import { approvalBlock } from "../settings/policy.js";
import { getSettings } from "../settings/store.js";
import { I, callout, clock, eta, pill, txLink } from "../ui.js";
import { accountShort } from "./text.js";

const RAIL: Record<string, string> = { cardano_preprod: "Cardano Preprod · tADA", cxc_fiat: "CashXChain · fiat" };

/** One approval card in the thread. epoch: approvals of the run before this card was shown. */
export interface Card {
  el: HTMLElement;
  epoch: number;
  busy?: "approve" | "reject";
  /** Quiet line under the buttons, e.g. a cancelled token dialog. */
  note?: string;
  /** Approved or rejected from this card. */
  mine?: "approve" | "reject";
}

const executions = (run: Run) => run.timeline.map((t, i) => ({ ...t, i })).filter(t => t.state === "EXECUTING");

/** Approval card markup for the run as it is now. */
export function approvalHtml(run: Run, card: Card): string {
  const d = run.draft;
  if (!d) return "";
  const rt = d.route;
  const q = d.routeQuote;
  const rows: Array<[string, string]> = [
    ["To", `${esc(d.supplier)}${rt.status === "selected" ? `<span class="ok-badge">${I.check}verified</span>` : ""}`],
    ["Rail", esc(rt.rail ? RAIL[rt.rail] ?? rt.rail : "None")],
  ];
  if (rt.destination) rows.push(["Account", `<span class="mono">${esc(accountShort(rt.destination))}</span>`]);
  if (q && d.currency !== "ADA") rows.push(["Fee", `USD ${esc(q.feeUsd)}${q.source === "cxc-sandbox" ? "" : `<span class="sim">simulated</span>`}`]);
  if (d.currency === "ADA") rows.push(["Fee", "~0.2 tADA network fee"]);
  if (q) rows.push(["Arrives", `${esc(eta(q.etaHours))} <span class="sim">estimate</span>`]);

  // An approval that already happened for this card: show what came of it.
  const used = executions(run)[card.epoch];
  let foot: string;
  let state = pill(run.state, run.payout?.status);
  if (used) {
    const after = run.timeline[used.i + 1];
    if (after?.state === "DRAFT_READY") {
      state = `<span class="pill t-warn">Refused</span>`;
      foot = `<div class="stamp warn">${I.alert} Approved, then refused by the rail. Nothing was paid.</div>`;
    } else {
      foot = `<div class="stamp">${I.check} Approved${card.mine === "approve" ? " by you" : ""} at ${esc(clock(used.at))}</div>`;
    }
  } else if (run.state === "REJECTED") {
    foot = `<div class="stamp bad">Rejected${card.mine === "reject" ? " by you" : ""}. Nothing will be paid.</div>`;
  } else if (run.state !== "DRAFT_READY") {
    foot = "";
  } else if (!d.executable) {
    foot = `${callout("warn", "Cannot be paid yet", `${esc(rt.reason)}.`)}
      <div class="actions"><button class="btn ghost" type="button" data-act="reject"${card.busy ? " disabled" : ""}>Reject</button></div>`;
  } else {
    const block = approvalBlock(run, getSettings()) ?? (approvalsDisabled() ? APPROVALS_OFF : undefined);
    const busy = (act: string) => (card.busy === act ? " loading" : "");
    const off = block || card.busy ? " disabled" : "";
    foot = `<div class="actions">
        <button class="btn primary${busy("approve")}" type="button" data-act="approve"${off}>${I.lock} Review and pay</button>
        <button class="btn ghost${busy("reject")}" type="button" data-act="reject"${card.busy ? " disabled" : ""}>Reject</button>
      </div>
      ${block ? `<p class="ap-why">${I.info}<span>${esc(block)}. <a href="#/settings">Agent settings</a></span></p>` : `<p class="fine">${esc(card.note ?? d.note)}</p>`}`;
  }
  return `<div class="pay ap">
    <div class="ap-head"><span>${run.state === "DRAFT_READY" && !used ? "Ready to pay" : run.state === "REJECTED" ? "Payout draft" : "Payout"}</span>${state}</div>
    <div class="pay-top"><b>${esc(money(d.amountMinor, d.currency))}</b><span class="ap-id">${esc(d.invoiceId)}</span></div>
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${foot}
  </div>`;
}

const TITLE: Record<Exclude<PayoutResult["status"], "unknown">, string> = {
  confirmed: "Paid",
  submitted: "Payout submitted",
  simulated: "Payout simulated",
};

/** Result of an executed payout, with the animated tick. */
export function payoutHtml(po: PayoutResult): string {
  const status = po.status === "unknown" ? "submitted" : po.status;
  const ref = po.explorerUrl
    ? txLink(po.reference, po.explorerUrl)
    : po.reference ? `<p class="fine">Payout ID <span class="mono">${esc(po.reference)}</span></p>` : "";
  return `<div class="success${status === "simulated" ? " simulated" : ""}">
      <svg class="tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg>
      <div><b>${TITLE[status]} · ${esc(money(po.amountMinor, po.currency))}</b><span>${esc(po.label)}.</span></div>
    </div>${ref}`;
}
