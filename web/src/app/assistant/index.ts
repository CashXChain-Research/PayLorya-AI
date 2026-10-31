import { $, esc } from "../../shared/dom.js";
import { createRun, getSamples } from "../api.js";
import { INVOICE_ACCEPT, readInvoiceFile } from "../files.js";
import { loadList } from "../list.js";
import { currentRoute, go, onRoute } from "../router.js";
import { sendBlock } from "../settings/policy.js";
import { getSettings } from "../settings/store.js";
import { I } from "../ui.js";
import { ASK_CHIPS, answer, askChips } from "./answers.js";
import { AI, MARK } from "./icons.js";
import { dropTarget } from "./drop.js";
import { act, initNarration, track } from "./narrate.js";
import { fileSize, lineCount, looksLikeInvoice, preview } from "./text.js";
import { enqueue, initThread, mutate, post, rekey, say, toBottom, user } from "./thread.js";

// Keys of /api/samples (src/fixtures.ts); a chip only shows when the server has that sample.
const SAMPLES: Array<{ key: string; label: string; safety?: boolean }> = [
  { key: "sepa_ok", label: "EUR supplier invoice" },
  { key: "us_ok", label: "US vendor" },
  { key: "crypto_ok", label: "Crypto invoice" },
  { key: "prompt_injection", label: "Prompt injection test", safety: true },
  { key: "wallet_swap", label: "Wallet swap test", safety: true },
  { key: "bad_iban", label: "IBAN typo test", safety: true },
  { key: "no_bank_details", label: "Missing bank details", safety: true },
];
const PDFS = [
  { href: "/samples/brenner-INV-2026-1051.pdf", label: "Brenner · EUR invoice" },
  { href: "/samples/lakeside-A-5540.pdf", label: "Lakeside · USD invoice" },
];
const MAX_FIELD = 168;

let samples: Record<string, string> = {};
let seq = 0;
let input: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;

const layout = (): string => `
  <header class="page-head">
    <h1>Assistant</h1>
    <p>Drop an invoice or ask about your payments. Your AI CFO works through it here and asks before any money moves.</p>
  </header>
  <section class="card chat" id="ax-chat" aria-label="Chat with your AI CFO">
    <header class="chat-head">
      <span class="chat-av mark">${MARK}</span>
      <div class="chat-id"><b>AI CFO</b><span>Claude reads the invoices. Answers here come from your run data.</span></div>
    </header>
    <div class="chat-thread" id="ax-thread"><div class="thread-in" id="ax-log" role="log" aria-live="polite"></div></div>
    <form class="composer" id="ax-form" autocomplete="off">
      <button class="chat-jump" id="ax-jump" type="button" aria-label="Jump to the newest message">${AI.down}</button>
      <div class="composer-in">
        <button class="c-btn c-attach" id="ax-attach" type="button" aria-label="Attach an invoice (PDF or text)" title="Attach an invoice">${AI.clip}</button>
        <input type="file" id="ax-file" accept="${esc(INVOICE_ACCEPT)}" hidden>
        <textarea id="ax-input" rows="1" placeholder="Drop an invoice, paste one, or ask a question" aria-label="Message your AI CFO" spellcheck="false"></textarea>
        <button class="c-btn c-send" id="ax-send" type="submit" aria-label="Send" disabled>${AI.up}</button>
      </div>
      <p class="c-hint">PDF or text, up to 5 MB<span> · Enter to send, Shift+Enter for a new line</span></p>
    </form>
    <div class="chat-drop" id="ax-drop" aria-hidden="true">
      <div class="zone"><span class="ic">${AI.drop}</span><b>Drop the invoice to send it to your AI CFO</b><span>PDF or text, up to 5 MB</span></div>
    </div>
  </section>`;

const chip = (attrs: string, html: string): string => `<button class="chip" type="button" ${attrs}>${html}</button>`;

function welcome(): void {
  void say("hello", {
    html: `Hi, I'm your AI CFO. Drop a supplier invoice here, as a PDF or text. I read it, verify it with a paid check, pick the payout rail and ask you before any money moves.`,
  }, { delay: 0 });
  const loaded = getSamples().catch(() => ({}) as Record<string, string>);
  void enqueue(async () => {
    samples = await loaded;
    const shown = SAMPLES.filter(s => samples[s.key]);
    const group = (title: string, items: typeof SAMPLES) => items.length
      ? `<span class="m-label">${title}</span><div class="chips">${items.map(s => chip(`data-sample="${esc(s.key)}"`, `${s.safety ? I.shieldSm : AI.spark}${esc(s.label)}`)).join("")}</div>`
      : "";
    const pdfs = `<span class="m-label">Sample PDFs to upload</span><div class="chips">${PDFS.map(p => `<a class="chip dl" href="${p.href}" download>${AI.save}${esc(p.label)}</a>`).join("")}</div>`;
    const html = `${group("Try an example", shown.filter(s => !s.safety))}${group("Safety tests", shown.filter(s => s.safety))}${pdfs}`;
    await post("hello", { kind: "card", html: `<div class="m-chips">${html}</div>` }, { delay: 0 });
    await post("hello", { html: `You can also ask me about your payments.${askChips(ASK_CHIPS.slice(0, 3))}` }, { delay: 0 });
  });
}

/** Settings may forbid sending invoices; the agent says so in the thread. */
function blockedBySettings(key: string): boolean {
  const reason = sendBlock(getSettings());
  if (!reason) return false;
  void say(key, { html: `${esc(reason)}, so I can't send invoices to the agent. Turn them back on in <a href="#/settings">Agent settings</a>.` });
  return true;
}

async function start(text: string, key: string): Promise<void> {
  let res: Awaited<ReturnType<typeof createRun>>;
  try {
    res = await createRun(text);
  } catch {
    void say(key, { html: "I couldn't reach the agent. Check the connection and try again." });
    return;
  }
  if (!res.ok) {
    void say(key, { html: `The agent didn't take it: ${esc(res.error)}.` });
    return;
  }
  const id = res.data.id;
  void enqueue(async () => rekey(key, id));
  track(id);
  void loadList();
}

async function sendInvoice(text: string, label?: string): Promise<void> {
  user(`${label ? `<span class="u-label">${esc(label)}</span>` : ""}${preview(text)}`, "doc");
  const key = `send-${++seq}`;
  if (blockedBySettings(key)) return;
  await start(text, key);
}

async function sendFile(file: File, extra = 0): Promise<void> {
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const kind = pdf ? "PDF" : (file.name.split(".").pop() || "file").toUpperCase();
  user(`<span class="u-file"><span class="u-ic">${AI.file}</span><span class="u-meta"><b>${esc(file.name)}</b><small>${esc(kind)} · ${esc(fileSize(file.size))}</small></span></span>`, "file");
  const key = `send-${++seq}`;
  if (blockedBySettings(key)) return;
  const reading = readInvoiceFile(file).then(
    r => ({ ok: true as const, ...r }),
    (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
  );
  const el = await say(key, { html: `<span class="m-spin" aria-hidden="true"></span>${pdf ? "Reading the PDF…" : "Reading the file…"}` }, { delay: 260 });
  const r = await reading;
  if (!r.ok) {
    mutate(() => (el.innerHTML = `I couldn't use this file: ${esc(r.error)}.`));
    return;
  }
  const n = lineCount(r.text);
  mutate(() => {
    el.innerHTML = `Read ${n} line${n === 1 ? "" : "s"} from <b>${esc(file.name)}</b>.${extra ? ` <span class="m-fine">One invoice at a time: I left the other ${extra === 1 ? "file" : `${extra} files`}.</span>` : ""}
      <details class="m-more"><summary>Show the text</summary><pre class="m-pre">${esc(r.text)}</pre></details>`;
  });
  await start(r.text, key);
}

function sendFiles(files: FileList | File[] | null | undefined): void {
  const list = [...(files ?? [])];
  if (list[0]) void sendFile(list[0], list.length - 1);
}

function ask(text: string): void {
  user(esc(text).replace(/\n/g, "<br>"));
  void say(`ask-${++seq}`, { html: answer(text) }, { delay: 650 });
}

function sync(): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, MAX_FIELD)}px`;
  input.classList.toggle("scroll", input.scrollHeight > MAX_FIELD);
  const ready = input.value.trim().length > 0;
  sendBtn.disabled = !ready;
  sendBtn.classList.toggle("ready", ready);
}

function submit(): void {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sync();
  if (looksLikeInvoice(text)) void sendInvoice(text);
  else ask(text);
}

function initComposer(view: HTMLElement): void {
  input = $<HTMLTextAreaElement>("ax-input");
  sendBtn = $<HTMLButtonElement>("ax-send");
  const file = $<HTMLInputElement>("ax-file");
  const chat = $("ax-chat");

  $("ax-form").addEventListener("submit", e => {
    e.preventDefault();
    submit();
  });
  // The long hint does not fit a phone's composer.
  const narrow = matchMedia("(max-width: 560px)");
  const hint = () => (input.placeholder = narrow.matches ? "Ask, or drop an invoice" : "Drop an invoice, paste one, or ask a question");
  narrow.addEventListener("change", hint);
  hint();
  input.addEventListener("input", sync);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  $("ax-attach").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    sendFiles(file.files);
    file.value = "";
  });

  dropTarget(view, chat, sendFiles);

  // Paste: a file is sent; text pasted outside the field lands in it.
  document.addEventListener("paste", e => {
    if (currentRoute().view !== "assistant") return;
    const target = e.target as HTMLElement | null;
    const elsewhere = target?.closest("input, textarea, [contenteditable]") && target !== input;
    if (elsewhere) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      sendFiles(files);
      return;
    }
    const text = e.clipboardData?.getData("text") ?? "";
    if (target !== input && text) {
      e.preventDefault();
      input.value = text;
      sync();
      input.focus();
    }
  });
}

/** Renders the Assistant view: a chat with the AI CFO. */
export function initAssistant(): void {
  const view = $("view-assistant");
  view.innerHTML = layout();
  initThread($("ax-thread"), $("ax-log"), $("ax-jump"));
  initComposer(view);
  initNarration();

  $("ax-log").addEventListener("click", e => {
    const target = e.target as Element;
    const open = target.closest<HTMLElement>("[data-open]");
    if (open?.dataset.open) {
      go("inbox", open.dataset.open);
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-act]");
    if (button && !button.disabled) {
      void act(button);
      return;
    }
    const sample = target.closest<HTMLElement>("[data-sample]")?.dataset.sample;
    if (sample && samples[sample]) {
      const label = SAMPLES.find(s => s.key === sample)?.label;
      void sendInvoice(samples[sample]!, label);
      return;
    }
    const question = target.closest<HTMLElement>("[data-ask]")?.dataset.ask;
    if (question) ask(question);
  });

  onRoute(route => {
    if (route.view !== "assistant") return;
    requestAnimationFrame(() => {
      toBottom(false);
      if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
    });
  });
  welcome();
  sync();
}
