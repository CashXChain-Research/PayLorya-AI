import type { ReadinessReport } from "../../../../src/types.js";
import { ada, esc, money, short } from "../../shared/dom.js";
import { getRun, type Run } from "../api.js";
import { decideRun } from "../approval.js";
import { health, loadHealth } from "../health.js";
import { loadList } from "../list.js";
import { onSettings } from "../settings/store.js";
import { TERMINAL } from "../stages.js";
import { callout, checkList, pill, txLink } from "../ui.js";
import { approvalHtml, payoutHtml, type Card } from "./cards.js";
import { AI } from "./icons.js";
import { accountPhrase, foreignWallet, injectionWords, isJson, missingFields, stopText } from "./text.js";
import { enqueue, post, say, setWorking, type Msg, type PostOpts } from "./thread.js";

interface Tracker {
  id: string;
  run?: Run;
  /** Timeline entries already queued for narration. */
  seen: number;
  timer?: number;
  /** Latest poll; an older one that returns late is dropped. */
  gen: number;
  reportSaid: boolean;
  cards: Card[];
  lost?: boolean;
}

const trackers = new Map<string, Tracker>();
const FAST = 1200;
const IDLE = 2500; // DRAFT_READY: someone may still approve in the Inbox or by auto-approve

const reached = (run: Run, state: Run["state"], before = run.timeline.length): boolean =>
  run.timeline.slice(0, before).some(t => t.state === state);
const label = (run?: Run): string | undefined =>
  run?.invoice ? `${esc(run.invoice.supplier)} · ${esc(run.invoice.id)}` : undefined;

function opts(t: Tracker): PostOpts {
  return {
    ctx: () => label(t.run),
    foot: () => `<span data-pill="${esc(t.id)}">${t.run ? pill(t.run.state, t.run.payout?.status) : ""}</span>
      <button class="m-link" type="button" data-open="${esc(t.id)}">Open in Inbox ${AI.arrow}</button>`,
  };
}

/** Follows a run the chat created: narrates each new timeline entry until the run settles. */
export function track(id: string): void {
  if (trackers.has(id)) return;
  const t: Tracker = { id, seen: 0, gen: 0, reportSaid: false, cards: [] };
  trackers.set(id, t);
  setWorking(id, true);
  void poll(t);
}

async function poll(t: Tracker): Promise<void> {
  clearTimeout(t.timer);
  const gen = ++t.gen;
  let run: Run | undefined;
  try {
    run = await getRun(t.id);
  } catch {
    if (gen === t.gen) t.timer = window.setTimeout(() => void poll(t), 2500);
    return;
  }
  if (gen !== t.gen) return;
  if (!run) {
    if (!t.lost) {
      t.lost = true;
      setWorking(t.id, false);
      void say(t.id, { html: "I lost track of this invoice: the agent no longer knows the run (it restarted). Nothing more will happen to it." }, opts(t));
    }
    return;
  }
  t.run = run;
  refresh(t);
  for (; t.seen < run.timeline.length; t.seen++) {
    const i = t.seen;
    void enqueue(async () => {
      for (const msg of messagesFor(t, i)) await post(t.id, msg, opts(t));
    });
  }
  const busy = !TERMINAL.includes(run.state);
  void enqueue(async () => setWorking(t.id, busy && !t.lost));
  if (busy) t.timer = window.setTimeout(() => void poll(t), FAST);
  else if (run.state === "DRAFT_READY") t.timer = window.setTimeout(() => void poll(t), IDLE);
  else {
    void loadHealth();
    void loadList();
  }
}

/** Re-renders the run's live parts: approval cards and state pills. */
function refresh(t: Tracker): void {
  const run = t.run;
  if (!run) return;
  for (const card of t.cards) renderCard(run, card);
  const html = pill(run.state, run.payout?.status);
  for (const el of document.querySelectorAll<HTMLElement>(`[data-pill="${CSS.escape(t.id)}"]`)) {
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}

function renderCard(run: Run, card: Card): void {
  const html = approvalHtml(run, card);
  if (card.el.dataset.sig === html) return;
  card.el.dataset.sig = html;
  card.el.innerHTML = html;
}

function cardMsg(t: Tracker, epoch: number): Msg {
  return {
    html: "",
    kind: "card",
    mount: el => {
      el.dataset.run = t.id;
      el.dataset.card = String(t.cards.length);
      const card: Card = { el, epoch };
      t.cards.push(card);
      if (t.run) renderCard(t.run, card);
    },
  };
}

function reportMsgs(t: Tracker, report: ReadinessReport): Msg[] {
  if (t.reportSaid) return [];
  t.reportSaid = true;
  const failing = report.checks.filter(c => c.status === "fail" || c.status === "warn");
  if (report.verdict === "ready_for_review") {
    const passed = report.checks.filter(c => c.status === "pass").length;
    const note = failing.length ? `${passed} checks passed, ${failing.length} with a note.` : `All ${passed} checks passed.`;
    return [{ html: `The readiness report is back: <b>ready for review</b>. ${note}
      <details class="m-more"><summary>Show checks</summary>${checkList(report.checks)}</details>` }];
  }
  const what = report.verdict === "blocked" ? "says <b>blocked</b>" : "needs more information";
  return [{ html: `The readiness report ${what}:${checkList(failing)}` }];
}

function routeMsgs(run: Run): Msg[] {
  const rt = run.route;
  if (!rt) return [];
  if (rt.status === "blocked") {
    return [{
      kind: "card",
      html: callout("bad", "Payout blocked", `${esc(rt.reason)}. Nothing was paid out: your verified payee records decide where money goes, never the invoice.`),
    }];
  }
  if (rt.status === "unavailable") return [{ html: `I can't pick a payout route yet: ${esc(rt.reason)}.` }];
  const ignored = rt.checks.some(c => c.id === "wallet" && c.status === "warn");
  const where = rt.rail === "cardano_preprod"
    ? `<b>Cardano Preprod</b> to the verified wallet of ${esc(rt.payee)}`
    : `<b>CashXChain</b> to the verified ${rt.destination?.startsWith("ABA") ? "bank account" : "IBAN"} of ${esc(rt.payee)}`;
  return [{
    html: `Route: ${where}.${ignored ? " The wallet address in the invoice is not on file, so I ignored it." : ""}`,
  }];
}

function failedMsgs(run: Run, i: number): Msg[] {
  const error = run.error || run.timeline[i]?.note || "unknown error";
  const stop = stopText(error);
  if (reached(run, "EXECUTING", i)) {
    return [{ kind: "card", html: callout("bad", "Nothing was sent", `${esc(stop ?? error)}. The invoice was not paid.`) }];
  }
  if (!run.invoice) {
    const missing = missingFields(error);
    const html = missing
      ? `I couldn't read a complete invoice from this. Missing or unreadable: <b>${esc(missing)}</b>. Nothing was paid. Send the full invoice text or a digital PDF.`
      : /ANTHROPIC_API_KEY/.test(error)
        ? "Claude is not configured on this server, so I can only take structured JSON invoices right now. Nothing was paid."
        : /declined/.test(error)
          ? "Claude declined to read this one. Nothing was paid."
          : `I couldn't read this invoice: ${esc(error)}. Nothing was paid.`;
    return [{ html }];
  }
  if (stop) return [{ kind: "card", html: callout("warn", "Stopped before signing", `${esc(stop)}. No transaction, spend unchanged.`) }];
  if (run.payment) {
    return [{ html: `The check was paid, but the verifier returned no readable report. I've locked this invoice as paid so it is never bought twice.<br>${txLink(run.payment.transactionHash, run.payment.explorerUrl)}` }];
  }
  return [{ html: `I stopped: ${esc(error)}. Nothing was paid.` }];
}

/** What the agent says about timeline entry i, from the run as it is now. */
function messagesFor(t: Tracker, i: number): Msg[] {
  const run = t.run!;
  const entry = run.timeline[i]!;
  const inv = run.invoice;
  switch (entry.state) {
    case "CREATED":
      return [{ html: isJson(run.input) ? "Got it. This is structured JSON, so I check the fields directly, without Claude." : "Got it. Claude is reading the invoice for the payment fields…" }];
    case "EXTRACTED": {
      if (!inv) return [];
      const account = accountPhrase(run);
      const out: Msg[] = [{
        html: `I read the invoice: <b>${esc(money(inv.amountMinor, inv.currency))}</b> from <b>${esc(inv.supplier)}</b>${account ? `, ${account}` : ", but I found no bank details"}.
          <span class="m-fine">${esc(inv.id)}${inv.reference ? ` · ref ${esc(inv.reference)}` : ""} · ${esc(inv.destinationCountry)}</span>`,
      }];
      const foreign = inv.currency === "ADA" ? undefined : foreignWallet(run.input, [health.sellerAddress, health.supplierCardanoAddress]);
      if (foreign || injectionWords(run.input)) {
        const told = foreign ? `The invoice tells the agent to pay <span class="mono">${esc(short(foreign))}</span>.` : "The invoice contains instructions addressed to the agent.";
        out.push({ kind: "card", html: callout("ok", "Prompt injection ignored", `${told} Invoice text is data to me, not instructions: nothing in it can change who gets paid, the price or the budget.`) });
      }
      return out;
    }
    case "PRECHECKED": {
      const what = inv?.currency === "ADA" ? "Wallet" : "Bank details";
      const price = health.priceLovelace ? ` for ${esc(ada(health.priceLovelace))}` : "";
      return [{ html: `${what} present. Buying a readiness check${price} via x402…` }];
    }
    case "PAYING":
      // Shown only while it is in flight: a spend-policy stop can still refuse before signing.
      return reached(run, "PAID") || (run.state === "FAILED" && !run.payment) ? [] : [{ html: "Paying the verifier via x402 from the agent wallet. Waiting for Cardano Preprod to settle it…" }];
    case "PAID": {
      const p = run.payment;
      if (!p) return [];
      return [{ html: `Paid <b>${esc(ada(p.amount))}</b> on Cardano Preprod to the allow-listed verifier.<br>${txLink(p.transactionHash, p.explorerUrl)}` }];
    }
    case "DRAFT_READY": {
      const epoch = run.timeline.slice(0, i).filter(x => x.state === "EXECUTING").length;
      if (epoch > 0) {
        return [
          { kind: "card", html: callout("warn", "Payout refused, nothing was paid", `The rail refused it before anything was sent: ${esc(run.error || entry.note || "no reason given")}. You can approve again.`) },
          cardMsg(t, epoch),
        ];
      }
      const ask = run.draft?.executable ? "Here is the payout. Nothing moves until you approve." : "Here is the draft. It can't be paid yet:";
      return [...(run.report ? reportMsgs(t, run.report) : []), ...routeMsgs(run), { html: ask }, cardMsg(t, epoch)];
    }
    case "BLOCKED": {
      const out = run.report ? reportMsgs(t, run.report) : [];
      if (run.route) return [...out, ...routeMsgs(run)];
      return [...out, { kind: "card", html: callout("bad", "Blocked", "I won't pay this invoice. Nothing was paid out.") }];
    }
    case "NEEDS_INFO": {
      if (!reached(run, "PAYING", i)) {
        const why = /no account identifier/.test(entry.note ?? "")
          ? "the invoice has no bank details (no IBAN, routing number or wallet)"
          : entry.note || "details are missing";
        return [{ kind: "card", html: callout("warn", "On hold, nothing spent", `I'm holding this one before paying for a check: ${esc(why)}. Ask the supplier for them, then send it again.`) }];
      }
      return [...(run.report ? reportMsgs(t, run.report) : []), { html: "I'm holding it until the supplier corrects this. Nothing was paid out." }];
    }
    case "SETTLEMENT_UNKNOWN":
      return [{
        kind: "card",
        html: `${callout("bad", "Settlement unclear", "The check's payment may or may not have settled. I've locked this invoice so it can never be paid twice: look it up on the explorer before trying again.")}${txLink(run.settlement?.transactionHash, run.settlement?.explorerUrl)}`,
      }];
    case "FAILED":
      return failedMsgs(run, i);
    case "EXECUTING": {
      const how = run.route?.rail === "cardano_preprod"
        ? "The agent wallet signs the transfer to the verified wallet and broadcasts it on Cardano Preprod."
        : "Submitting the payout to CashXChain.";
      return [{ html: `Approved. Paying… <span class="m-fine">${how}</span>` }];
    }
    case "EXECUTED":
      return run.payout ? [{ kind: "card", html: payoutHtml(run.payout) }] : [{ html: "Paid." }];
    case "PAYOUT_UNKNOWN":
      return [{
        kind: "card",
        html: `${callout("bad", "Payout outcome unknown", `${esc(run.payout?.label || "The payout may or may not have gone through")}. I've locked this invoice so it can never be paid twice.`)}${txLink(run.payout?.reference, run.payout?.explorerUrl)}`,
      }];
    case "REJECTED":
      return [{ html: "Rejected. Nothing will be paid." }];
    default:
      return [];
  }
}

/** Approve or reject from a card in the thread. */
export async function act(button: HTMLButtonElement): Promise<void> {
  const host = button.closest<HTMLElement>(".m-card[data-run]");
  const t = host ? trackers.get(host.dataset.run!) : undefined;
  const card = t?.cards[Number(host?.dataset.card)];
  const decision = button.dataset.act;
  if (!t?.run || !card || card.busy || (decision !== "approve" && decision !== "reject")) return;
  card.busy = decision;
  card.note = undefined;
  renderCard(t.run, card);
  let reply: string | undefined;
  try {
    const res = await decideRun(t.id, decision);
    if (res.ok) card.mine = decision;
    else if (res.status === 0) card.note = `Cancelled. Nothing was ${decision === "approve" ? "approved" : "rejected"}; the invoice is still waiting for you.`;
    else if (res.status === 401) card.note = `The operator token was not accepted. Nothing was ${decision === "approve" ? "approved" : "rejected"}; try again.`;
    else if (res.status === 409) reply = `It is no longer waiting for a decision (${esc(res.error)}).`;
    else reply = `I couldn't ${decision} it: ${esc(res.error)}.`;
  } catch {
    reply = "I couldn't reach the agent. Nothing changed; try again.";
  }
  card.busy = undefined;
  renderCard(t.run, card);
  if (reply) void say(t.id, { html: reply }, opts(t));
  await poll(t);
}

/** Settings decide whether Approve is enabled. */
export function initNarration(): void {
  onSettings(() => {
    for (const t of trackers.values()) refresh(t);
  });
}
