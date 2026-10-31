import { ada, esc, money } from "../../shared/dom.js";
import { getHealth, getRun, listRuns, type Health, type Run, type RunSummary } from "../api.js";
import { getSettings } from "../settings/store.js";
import { checkList, pill, txLink } from "../ui.js";
import { AI } from "./icons.js";

// Deterministic, rule-based answers from the run data and settings. No model: nothing is made up.
type Intent = "blocked" | "settings" | "pending" | "spend" | "tx" | "recent" | "help" | "hello";

const RULES: Array<[Intent, RegExp]> = [
  ["blocked", /\b(why|reason|what happened)\b.*\b(block|held|hold|stop|flag|reject|fail)|\b(blocked|on hold|held back)\b/i],
  ["settings", /\bauto-?approv|\b(settings?|permissions?|allowed|rules)\b|\bwhat (can|may) (you|the agent)\b/i],
  ["pending", /\b(pending|awaiting|waiting|to approve|needs? (my )?(approval|decision)|open (invoices|items|drafts))\b/i],
  ["spend", /\b(spen[dt]|budgets?|costs?|how much|fees?|paid out|expenses?)\b/i],
  ["tx", /\b(transactions?|txs?|proofs?|explorer|hash(es)?|receipts?|on-?chain|cardanoscan|payout ids?)\b/i],
  ["recent", /\b(recent|history|latest|all|list|show)\b.*\b(invoices?|runs?|payments?|payouts?)\b|^(invoices|payments|payouts)\??$/i],
  ["help", /\b(help|what can you do|how does (this|it) work|what do you do)\b|^\?$/i],
  ["hello", /^(hi|hello|hey|hallo|moin|servus|good (morning|afternoon|evening))\b/i],
];

export const ASK_CHIPS = ["What's pending?", "How much did we spend?", "Why was it blocked?", "Show transactions", "What are you allowed to do?"];

export const askChips = (items = ASK_CHIPS): string =>
  `<div class="chips">${items.map(q => `<button class="chip ask" type="button" data-ask="${esc(q)}">${AI.ask}${esc(q)}</button>`).join("")}</div>`;

const open = (id: string, text = "Open") => `<button class="m-link" type="button" data-open="${esc(id)}">${esc(text)} ${AI.arrow}</button>`;
const who = (r: { supplier?: string; invoiceId?: string; id: string }) =>
  `<b>${esc(r.supplier || "Unread invoice")}</b><span>${esc(r.invoiceId || r.id.slice(0, 8))}</span>`;

/** "Wallet on the invoice…" -> "wallet on the invoice…", but "IBAN …" stays. */
const lower = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

function rows(items: string[]): string {
  return `<ul class="m-rows">${items.join("")}</ul>`;
}

async function pending(): Promise<string> {
  const runs = await listRuns();
  const waiting = runs.filter(r => r.state === "DRAFT_READY");
  const held = runs.filter(r => r.state === "BLOCKED" || r.state === "NEEDS_INFO").length;
  if (!waiting.length) {
    return `Nothing is waiting for your approval right now.${held ? ` ${held === 1 ? "One invoice is" : `${held} invoices are`} held back; ask me why.` : ""}`;
  }
  const head = waiting.length === 1 ? "One invoice is waiting for your decision:" : `${waiting.length} invoices are waiting for your decision:`;
  return `${head}${rows(waiting.map(r => `<li><span class="who">${who(r)}</span><span class="amt">${esc(money(r.amountMinor, r.currency))}</span>${open(r.id, "Review")}</li>`))}`;
}

function meter(label: string, used: number, total: number, value: string, sub: string): string {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return `<div class="m-stat"><div class="m-stat-top"><span>${label}</span><b>${value}</b></div><div class="meter"><i style="width:${pct.toFixed(1)}%"></i></div><span class="m-stat-sub">${sub}</span></div>`;
}

async function spend(): Promise<string> {
  const [h, runs] = await Promise.all([getHealth(), listRuns()]);
  if (!h.status) return "I can't reach the agent right now, so I have no numbers to show.";
  const spent = Number(h.spentLovelace || 0);
  const budget = Number(h.sessionBudgetLovelace || 0);
  const checks = runs.filter(r => r.transactionHash).length;
  const paid = Number(h.paidOutLovelace || 0);
  const payBudget = Number(h.payoutBudgetLovelace || 0);
  const parts = [
    meter("Verification checks", spent, budget, ada(spent), `${checks} paid check${checks === 1 ? "" : "s"} via x402 · session budget ${ada(budget)}`),
    meter("Payouts on Cardano", paid, payBudget, ada(paid), `payout budget ${ada(payBudget)}${h.payoutMaxLovelace ? ` · up to ${ada(h.payoutMaxLovelace)} each` : ""}`),
  ];
  if (h.fiatPayoutsPerSession) {
    const used = h.fiatPayoutsUsed ?? 0;
    const cap = h.fiatPayoutMaxMinor ? ` · up to ${(h.fiatPayoutMaxMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} EUR or USD each` : "";
    parts.push(meter("Fiat payouts via CashXChain", used, h.fiatPayoutsPerSession, `${used} of ${h.fiatPayoutsPerSession}`, `this server session${cap}`));
  }
  const byCurrency = new Map<string, number>();
  for (const r of runs) {
    if (r.state === "EXECUTED" && r.currency && r.amountMinor != null) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.amountMinor);
  }
  const totals = [...byCurrency].map(([c, v]) => esc(money(v, c))).join(" · ");
  const fiat = h.cashxchain?.ready ? "CashXChain sandbox (test ledger)" : "a labeled simulation";
  return `Here is this session's spend, straight from the agent:<div class="m-stats">${parts.join("")}</div>
    ${totals ? `<p class="m-p">Paid out to suppliers: <b>${totals}</b>.</p>` : `<p class="m-p">No supplier payouts yet.</p>`}
    <span class="m-fine">tADA is test money on Cardano Preprod. Fiat payouts go to ${fiat}.</span>`;
}

function whyHeld(run: Run): { reason: string; checks: string } {
  const rt = run.route;
  const failing = (run.report?.checks ?? []).filter(c => c.status === "fail" || c.status === "warn");
  if (rt?.status === "blocked") return { reason: rt.reason, checks: checkList(rt.checks.filter(c => c.status !== "pass")) };
  if (run.report && run.report.verdict !== "ready_for_review") {
    return { reason: run.report.verdict === "blocked" ? "the readiness report blocked it" : "the readiness report needs more information", checks: checkList(failing) };
  }
  const note = run.timeline.at(-1)?.note ?? "";
  if (/no account identifier/.test(note)) return { reason: "the invoice has no bank details (no IBAN, routing number or wallet), so I held it before paying for a check", checks: "" };
  return { reason: note || "no reason was recorded", checks: "" };
}

async function blocked(): Promise<string> {
  const runs = await listRuns();
  const latest = runs.find(r => r.state === "BLOCKED" || r.state === "NEEDS_INFO");
  if (!latest) return "Nothing is blocked or on hold right now.";
  const run = await getRun(latest.id);
  if (!run) return "I couldn't load that invoice from the agent.";
  const { reason, checks } = whyHeld(run);
  const verb = run.state === "BLOCKED" ? "was blocked" : "is on hold";
  const amount = run.invoice ? ` (${esc(money(run.invoice.amountMinor, run.invoice.currency))})` : "";
  return `The latest one, <b>${esc(run.invoice?.supplier ?? "an unread invoice")}</b>${amount}, ${verb}: ${esc(lower(reason))}.${checks}
    <p class="m-p">${run.state === "BLOCKED" ? "Nothing was paid out." : "Nothing was paid out; send it again once the details are there."} ${open(run.id, "Open in Inbox")}</p>`;
}

async function transactions(): Promise<string> {
  const runs = (await listRuns()).filter(r => r.transactionHash || r.payoutStatus).slice(0, 5);
  if (!runs.length) return "No transactions yet. Every invoice I verify buys one check via x402 on Cardano Preprod; its transaction will show up here.";
  const full = (await Promise.all(runs.map(r => getRun(r.id).catch(() => undefined)))).filter((r): r is Run => Boolean(r));
  const items = full.map(r => {
    const check = r.payment ? `<span class="lbl">Check</span>${txLink(r.payment.transactionHash, r.payment.explorerUrl)}` : "";
    const po = r.payout;
    const payout = !po ? ""
      : po.explorerUrl ? `<span class="lbl">Payout</span>${txLink(po.reference, po.explorerUrl)}`
      : po.reference ? `<span class="lbl">Payout ID</span><span class="mono">${esc(po.reference)}</span>${po.simulated ? `<span class="sim">simulated</span>` : ""}`
      : "";
    return `<li><span class="who">${who({ id: r.id, supplier: r.invoice?.supplier, invoiceId: r.invoice?.id })}</span><span class="proofs">${check}${payout}</span></li>`;
  });
  return `The latest proofs, newest first:${rows(items)}<span class="m-fine">Check payments are x402 transactions on Cardano Preprod (test funds).</span>`;
}

function settings(h: Partial<Health>): string {
  const s = getSettings();
  const on = (v: boolean, text: string) => ({ status: v ? ("pass" as const) : ("skip" as const), message: `${text}: ${v ? "on" : "off"}` });
  const approval = s.approval === "auto"
    ? `Auto-approve payouts up to ${s.autoMaxTada} tADA or ${s.autoMaxFiat} in a fiat currency; anything larger waits for you.`
    : "Every payout waits for your click.";
  const limits = [
    h.maxPriceLovelace ? `checks up to ${ada(h.maxPriceLovelace)} each` : "",
    h.sessionBudgetLovelace ? `${ada(h.sessionBudgetLovelace)} session budget` : "",
    h.payoutMaxLovelace ? `tADA payouts up to ${ada(h.payoutMaxLovelace)}` : "",
  ].filter(Boolean).join(", ");
  return `This is what I may do, from Agent settings in this browser:${checkList([
    on(s.buyChecks, "Buy verification checks via x402"),
    on(s.payCardano, "Pay out on Cardano Preprod"),
    on(s.payCashxchain, "Pay out via CashXChain"),
  ])}<p class="m-p">${approval}${limits ? ` The server's own limits always apply: ${esc(limits)}.` : ""}</p>
    <a class="m-link" href="#/settings">Open Agent settings ${AI.arrow}</a>`;
}

async function recent(): Promise<string> {
  const runs = (await listRuns()).slice(0, 6);
  if (!runs.length) return "No invoices yet. Drop one here to start.";
  return `Your latest invoices:${rows(runs.map((r: RunSummary) => `<li><span class="who">${who(r)}</span><span class="amt">${esc(money(r.amountMinor, r.currency))}</span>${pill(r.state, r.payoutStatus)}${open(r.id)}</li>`))}`;
}

const HELP = `I read supplier invoices (drop a PDF, paste text or JSON), verify each with a paid check via x402, pick the payout rail from your verified payees and wait for your approval before any money moves.
  <p class="m-p">I can also answer a few questions from your run data:</p>`;

/** Supplier named in the question: the status of its latest invoice. */
async function bySupplier(text: string): Promise<string | undefined> {
  const runs = await listRuns();
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
  const hit = runs.find(r => r.supplier && r.supplier.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(w => w.length >= 4 && words.includes(w)));
  if (!hit) return undefined;
  return `The latest invoice from <b>${esc(hit.supplier)}</b>:${rows([`<li><span class="who">${who(hit)}</span><span class="amt">${esc(money(hit.amountMinor, hit.currency))}</span>${pill(hit.state, hit.payoutStatus)}${open(hit.id)}</li>`])}`;
}

/** Answer HTML for a question. Every number and name comes from the agent's API or settings. */
export async function answer(text: string): Promise<string> {
  const intent = RULES.find(([, re]) => re.test(text.trim()))?.[0];
  try {
    switch (intent) {
      case "blocked": return await blocked();
      case "settings": return settings(await getHealth().catch(() => ({})));
      case "pending": return await pending();
      case "spend": return await spend();
      case "tx": return await transactions();
      case "recent": return await recent();
      case "help": return `${HELP}${askChips()}`;
      case "hello": return `Hi. Drop an invoice here, or ask me about your payments.${askChips(ASK_CHIPS.slice(0, 3))}`;
    }
    const supplier = await bySupplier(text);
    if (supplier) return supplier;
  } catch {
    return "I can't reach the agent right now. Try again in a moment.";
  }
  return `I can't answer that one: I only answer from your run data, with simple rules, so I don't guess. If it was an invoice, send the full text with the amount and bank details. Try:${askChips()}`;
}
