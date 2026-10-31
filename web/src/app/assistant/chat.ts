import { esc } from "../../shared/dom.js";
import { postChat, type ChatAction, type ChatRequest, type ChatResponse } from "../api.js";
import { confirmPayment } from "../confirm.js";
import { health } from "../health.js";
import { I } from "../ui.js";
import { balancesCard } from "../wallets.js";
import { answer } from "./answers.js";
import { AI } from "./icons.js";
import { markdown, plainText } from "./markdown.js";
import { track, tracked } from "./narrate.js";
import { mutate, say } from "./thread.js";

// Questions go to Claude (POST /api/chat) when the server has a model; otherwise, or when it is
// unavailable, the rule-based answers reply. The model can ask for a payment; only the window pays.

type Turn = ChatRequest["messages"][number];
const MAX_TURNS = 20;
const MAX_CHARS = 4000;
const turns: Turn[] = [];
/** One question at a time, so each one goes out with the previous answer in its history. */
let chain: Promise<unknown> = Promise.resolve();

/** Keeps a text turn for the model's history; consecutive turns of one role are merged. */
export function remember(role: Turn["role"], content: string): void {
  const text = content.trim();
  if (!text) return;
  const last = turns.at(-1);
  if (last?.role === role) last.content = `${last.content}\n\n${text}`;
  else turns.push({ role, content: text });
  if (turns.length > MAX_TURNS * 2) turns.splice(0, turns.length - MAX_TURNS);
}

/** The last 20 turns, starting with the user's (the API wants that), each capped in length. */
function history(): Turn[] {
  const recent = turns.slice(-MAX_TURNS);
  while (recent[0]?.role === "assistant") recent.shift();
  return recent.map(t => ({ role: t.role, content: t.content.length > MAX_CHARS ? `${t.content.slice(0, MAX_CHARS)}…` : t.content }));
}

const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 100;

function actionChip(a: ChatAction): string {
  if (a.type === "confirm_payment" && validId(a.runId)) return `<button class="chip pay" type="button" data-confirm="${esc(a.runId)}">${I.lock}Review and pay</button>`;
  if (a.type === "open_run" && validId(a.runId)) return `<button class="chip" type="button" data-open="${esc(a.runId)}">Open in Inbox ${AI.arrow}</button>`;
  return "";
}

function replyHtml(r: ChatResponse): string {
  const chips = (r.actions ?? []).map(actionChip).filter(Boolean);
  const tools = (r.tools ?? []).filter(t => typeof t === "string" && t);
  return `${markdown(r.reply || "") || `<p class="m-p">Done.</p>`}
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
    ${tools.length ? `<div class="m-tools" aria-label="Functions Claude used"><span>used:</span>${tools.map(t => `<code>${esc(t)}</code>`).join("")}</div>` : ""}`;
}

/** What the window came to, told in the thread (for payments the chat asked for). */
async function confirmFromChat(runId: string, key: string): Promise<void> {
  const outcome = await confirmPayment(runId);
  if (tracked(runId)) return; // the run's own narration says it
  const html = outcome === "approved"
    ? `You confirmed the payment. It is being paid now. <button class="m-link" type="button" data-open="${esc(runId)}">Open in Inbox ${AI.arrow}</button>`
    : outcome === "rejected"
      ? "You rejected it. Nothing will be paid."
      : `Not confirmed, nothing was paid. <button class="m-link" type="button" data-confirm="${esc(runId)}">Review it again ${AI.arrow}</button>`;
  remember("assistant", plainText(html));
  void say(key, { html }, { delay: 0 });
}

function runActions(r: ChatResponse, key: string): void {
  for (const a of r.actions ?? []) {
    if (a.type === "confirm_payment" && validId(a.runId)) void confirmFromChat(a.runId, key);
    else if (a.type === "run_started" && validId(a.runId)) track(a.runId);
    else if (a.type === "show_balances") void say(key, { kind: "card", html: balancesCard() }, { delay: 0 });
  }
}

/** Rule-based answer (no model). */
async function rules(text: string, key: string, delay = 650): Promise<void> {
  const html = answer(text);
  await say(key, { html }, { delay });
  remember("assistant", plainText(await html));
}

async function viaModel(text: string, key: string): Promise<void> {
  // Typing dots in a bubble of their own, so the run narration is not held up while Claude thinks.
  const el = await say(key, {
    html: "<i></i><i></i><i></i>",
    mount: node => {
      node.classList.add("typing");
      node.setAttribute("aria-label", "Claude is answering");
    },
  }, { delay: 0 });
  const res = await postChat({ messages: history() });
  const fill = (html: string) => mutate(() => {
    el.classList.remove("typing");
    el.removeAttribute("aria-label");
    el.innerHTML = html;
  });
  if (res.ok) {
    fill(replyHtml(res.data));
    remember("assistant", res.data.reply || "");
    runActions(res.data, key);
    return;
  }
  if (res.status === 429) {
    const wait = res.retryAfterSec ? `${res.retryAfterSec} second${res.retryAfterSec === 1 ? "" : "s"}` : "a moment";
    fill(`Too many questions at once. Wait ${esc(wait)}, then ask again.`);
    return;
  }
  if (res.status === 400) {
    fill(`I couldn't send that: ${esc(res.error)}.`);
    return;
  }
  // 503 (no model), network or server errors: the rules answer instead.
  const html = await answer(text);
  fill(html);
  remember("assistant", plainText(html));
}

/** Answers a question typed in the Assistant. */
export function chat(text: string, key: string): Promise<void> {
  const next = chain.then(() => {
    remember("user", text);
    return health.chatReady ? viaModel(text, key) : rules(text, key);
  });
  chain = next.catch(() => undefined);
  return next;
}

/** An invoice the user sent from the chat, so the model knows the run behind "pay it". */
export function noteInvoice(label: string, runId: string): void {
  remember("user", `I sent an invoice to the agent: ${label} (run ${runId}).`);
}
