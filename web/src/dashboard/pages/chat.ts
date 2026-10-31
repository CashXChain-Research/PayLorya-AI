// AI CFO chat: thread list, streamed replies (SSE over fetch), tool status chips, file attachments.
import { esc } from "../../shared/dom.js";
import { del, get, post, stream } from "../api.js";
import { markdown } from "../markdown.js";
import { type Ctx, navigate, state, takePendingPrompt } from "../state.js";
import type { ChatEvent, ChatMessage, ChatSummary, DocumentUpload } from "../types.js";
import { ACCEPT, ago, AUTONOMY, bytes, confirmDialog, fileIcon, fileToBase64, icon, MAX_FILE, mimeOf, sk, toast } from "../ui.js";

const SUGGESTIONS: Array<[string, string]> = [
  ["budget", "Summarise my spending this month"],
  ["calendar", "Which invoices are due in the next 14 days?"],
  ["shield", "Create a budget for software at $2,000/month"],
  ["pay", "Draft payment for the latest invoice"],
  ["trend", "Forecast my cash for the next 90 days"],
];
const ALLOWED = /^(image\/|application\/pdf$|text\/csv$|text\/plain$|application\/vnd\.ms-excel$)/;

interface Pending {
  id: number;
  file: File;
  mime: string;
  url?: string;
}

function groupLabel(iso: string): string {
  const d = new Date(iso);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const diff = (t.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000;
  return diff <= 0 ? "Today" : diff <= 1 ? "Yesterday" : diff <= 7 ? "Previous 7 days" : diff <= 30 ? "Previous 30 days" : "Older";
}

const toolChip = (summary: string, running: boolean, name = "") =>
  `<span class="tool ${running ? "run" : "done"}" data-tool="${esc(name)}">${running ? '<i class="spin"></i>' : icon("check", 12, 2.8)}<span>${esc(summary)}</span></span>`;

function userMsg(m: Pick<ChatMessage, "text" | "attachments">, localFiles?: Pending[]): string {
  const atts = m.attachments?.length
    ? m.attachments.map(a => `<a class="file-chip" href="/app/documents/${esc(a.documentId)}">${icon("doc", 14)}<span>${esc(a.filename)}</span></a>`).join("")
    : (localFiles ?? []).map(f => `<span class="file-chip">${icon(fileIcon(f.mime), 14)}<span>${esc(f.file.name)}</span></span>`).join("");
  return `<div class="msg user">${atts ? `<div class="att-row">${atts}</div>` : ""}${m.text ? `<div class="bubble">${esc(m.text)}</div>` : ""}</div>`;
}
function botMsg(m?: ChatMessage): string {
  const tools = m?.tools?.length ? `<div class="tools">${m.tools.map(t => toolChip(t.summary, false, t.name)).join("")}</div>` : `<div class="tools"></div>`;
  return `<div class="msg bot"><span class="bot-av" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span><div class="msg-body">${tools}<div class="md">${m ? markdown(m.text) : '<span class="typing"><i></i><i></i><i></i></span>'}</div></div></div>`;
}

export async function renderChat(view: HTMLElement, ctx: Ctx): Promise<void> {
  let chatId: string | null = ctx.params[0] || null;
  let threads: ChatSummary[] = [];
  let files: Pending[] = [];
  let seq = 0;
  let controller: AbortController | null = null;
  const autonomy = state.me?.workspace.autonomy;

  view.innerHTML = `<div class="chat">
    <aside class="threads" id="threads">
      <div class="threads-head"><button class="btn primary sm block" type="button" id="new-chat">${icon("plus", 16, 2.4)}New chat</button></div>
      <div class="thread-list" id="thread-list">${Array.from({ length: 6 }, () => `<div class="th-sk">${sk("80%", 12)}${sk("40%", 10)}</div>`).join("")}</div>
    </aside>
    <div class="threads-scrim" id="threads-scrim"></div>
    <section class="convo" id="convo">
      <header class="convo-head">
        <button class="icon-btn threads-btn" type="button" id="threads-btn" aria-label="Show chats">${icon("chat", 18)}</button>
        <div class="convo-title"><b id="chat-title">New chat</b><span>AI CFO · Claude</span></div>
        ${autonomy ? `<a class="pill ${AUTONOMY[autonomy].tone}" href="/app/agent" title="Agent autonomy">${icon("shield", 12, 2.2)}${AUTONOMY[autonomy].name}</a>` : ""}
      </header>
      <div class="msgs" id="msgs"><div class="msgs-in" id="msgs-in"></div></div>
      <form class="composer" id="composer">
        <div class="att-chips" id="att-chips"></div>
        <textarea id="input" rows="1" placeholder="Ask about cash, invoices, budgets, or ask it to draft a payment…" aria-label="Message"></textarea>
        <div class="comp-bar">
          <button type="button" class="icon-btn" id="attach" aria-label="Attach files" title="Attach files (PDF, images, CSV, text)">${icon("clip", 18)}</button>
          <input type="file" id="file" multiple accept="${ACCEPT}" hidden>
          <span class="comp-hint">Shift + Enter for a new line</span>
          <button type="submit" class="send" id="send" aria-label="Send" disabled>${icon("send", 18, 2.4)}</button>
        </div>
      </form>
      <p class="comp-fine">Claude reads. Code decides. You approve. Payments run on Cardano Preprod (testnet) and the CashXChain sandbox.</p>
      <div class="drop-over" id="drop-over"><div>${icon("upload", 26)}<b>Drop files to attach</b><span>PDF, images, CSV or text · up to 15 MB each</span></div></div>
    </section>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => view.querySelector<T>(`#${id}`)!;
  const msgs = $("msgs");
  const inner = $("msgs-in");
  const input = $<HTMLTextAreaElement>("input");
  const send = $<HTMLButtonElement>("send");
  const listEl = $("thread-list");

  const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
  const toBottom = (force = false) => {
    if (force || nearBottom()) msgs.scrollTop = msgs.scrollHeight;
  };
  const syncSend = () => {
    if (controller) {
      send.disabled = false;
      send.classList.add("stop");
      send.innerHTML = icon("stop", 16, 2.2);
      send.setAttribute("aria-label", "Stop");
      return;
    }
    send.classList.remove("stop");
    send.innerHTML = icon("send", 18, 2.4);
    send.setAttribute("aria-label", "Send");
    send.disabled = !input.value.trim() && !files.length;
  };
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(200, input.scrollHeight)}px`;
    syncSend();
  };

  const paintThreads = () => {
    if (!threads.length) {
      listEl.innerHTML = `<p class="threads-empty">Your conversations appear here.</p>`;
      return;
    }
    let html = "";
    let last = "";
    for (const t of threads) {
      const g = groupLabel(t.updatedAt);
      if (g !== last) html += `<div class="th-group">${g}</div>`;
      last = g;
      html += `<div class="th${t.id === chatId ? " on" : ""}"><a href="/app/chat/${esc(t.id)}" title="${esc(t.title)}"><span>${esc(t.title || "New chat")}</span><em>${esc(ago(t.updatedAt))}</em></a><button type="button" class="icon-btn th-del" data-del="${esc(t.id)}" aria-label="Delete chat">${icon("trash", 15)}</button></div>`;
    }
    listEl.innerHTML = html;
  };
  const loadThreads = async () => {
    threads = await get<ChatSummary[]>("/api/v1/chats", true).catch(() => threads);
    if (!ctx.alive()) return;
    threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    paintThreads();
    const t = threads.find(x => x.id === chatId);
    if (t) $("chat-title").textContent = t.title || "New chat";
  };

  const emptyState = () => {
    inner.innerHTML = `<div class="chat-empty">
      <div class="ce-mark">${icon("sparkle", 26)}</div>
      <h2>How can I help with your finances?</h2>
      <p>I can read your documents and connected accounts, plan budgets and draft payments. Code checks every payment against your policy, and you approve what moves.</p>
      <div class="suggest">${SUGGESTIONS.map(([ic, s]) => `<button type="button" data-suggest="${esc(s)}">${icon(ic, 16)}<span>${esc(s)}</span></button>`).join("")}</div>
    </div>`;
  };

  const renderFiles = () => {
    const box = $("att-chips");
    box.innerHTML = files
      .map(
        f => `<span class="att">${f.url ? `<img src="${f.url}" alt="">` : `<span class="att-ic">${icon(fileIcon(f.mime), 16)}</span>`}<span class="att-t"><b>${esc(f.file.name)}</b><em>${esc(bytes(f.file.size))}</em></span><button type="button" class="att-x" data-rm="${f.id}" aria-label="Remove ${esc(f.file.name)}">${icon("x", 12, 2.6)}</button></span>`,
      )
      .join("");
    box.classList.toggle("has", files.length > 0);
    syncSend();
  };
  const addFiles = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const mime = mimeOf(file);
      if (!ALLOWED.test(mime)) {
        toast(`${file.name}: only images, PDF, CSV and text files are supported.`, "error");
        continue;
      }
      if (file.size > MAX_FILE) {
        toast(`${file.name} is larger than 15 MB.`, "error");
        continue;
      }
      files.push({ id: ++seq, file, mime, url: mime.startsWith("image/") ? URL.createObjectURL(file) : undefined });
    }
    renderFiles();
    input.focus();
  };
  const clearFiles = (revoke: boolean) => {
    if (revoke) for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
    files = [];
    renderFiles();
  };
  ctx.onCleanup(() => {
    controller?.abort();
    clearFiles(true);
  });

  const sendMessage = async (text: string) => {
    if (controller) return;
    if (!text && !files.length) return;
    const sending = files;
    files = [];
    renderFiles();
    input.value = "";
    grow();
    inner.querySelector(".chat-empty")?.remove();
    controller = new AbortController();
    syncSend();
    const userEl = document.createElement("div");
    userEl.innerHTML = userMsg({ text }, sending);
    inner.append(userEl.firstElementChild!);
    const botWrap = document.createElement("div");
    botWrap.innerHTML = botMsg();
    const bot = botWrap.firstElementChild as HTMLElement;
    inner.append(bot);
    bot.classList.add("streaming");
    toBottom(true);
    const toolsEl = bot.querySelector<HTMLElement>(".tools")!;
    const mdEl = bot.querySelector<HTMLElement>(".md")!;
    let acc = "";
    let raf = 0;
    const paintText = () => {
      raf = 0;
      mdEl.innerHTML = markdown(acc) + '<span class="caret"></span>';
      toBottom();
    };
    try {
      if (!chatId) {
        const chat = await post<ChatSummary>("/api/v1/chats", {});
        chatId = chat.id;
        threads.unshift(chat);
        paintThreads();
        navigate(`/app/chat/${encodeURIComponent(chat.id)}`, { silent: true });
      }
      const attachments: DocumentUpload[] = [];
      for (const f of sending) attachments.push({ filename: f.file.name, mimeType: f.mime, dataBase64: await fileToBase64(f.file) });
      for (const f of sending) if (f.url) URL.revokeObjectURL(f.url);
      const sig = controller.signal;
      await stream(
        `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
        attachments.length ? { text, attachments } : { text },
        (e: ChatEvent) => {
          if (!ctx.alive()) return;
          switch (e.type) {
            case "user": {
              const tmp = document.createElement("div");
              tmp.innerHTML = userMsg(e.message);
              const prev = bot.previousElementSibling;
              if (prev?.classList.contains("user")) prev.replaceWith(tmp.firstElementChild!);
              break;
            }
            case "text":
              acc += e.delta;
              if (!raf) raf = requestAnimationFrame(paintText);
              break;
            case "tool": {
              const running = [...toolsEl.querySelectorAll<HTMLElement>(".tool.run")].find(t => t.dataset.tool === e.name);
              if (e.status === "start") {
                toolsEl.insertAdjacentHTML("beforeend", toolChip(e.summary, true, e.name));
              } else if (running) {
                running.outerHTML = toolChip(e.summary, false, e.name);
              } else toolsEl.insertAdjacentHTML("beforeend", toolChip(e.summary, false, e.name));
              if (!acc) mdEl.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
              toBottom();
              break;
            }
            case "done": {
              if (raf) cancelAnimationFrame(raf);
              raf = 0;
              const tmp = document.createElement("div");
              tmp.innerHTML = botMsg({ ...e.message, text: e.message.text || acc });
              const done = tmp.firstElementChild as HTMLElement;
              // Keep the live tool chips when the stored message has none.
              if (!e.message.tools?.length && toolsEl.children.length) done.querySelector(".tools")!.replaceWith(toolsEl);
              bot.replaceWith(done);
              acc = "";
              break;
            }
            case "error":
              throw new Error(e.message || "The AI CFO could not answer.");
          }
        },
        sig,
      );
      if (bot.isConnected) {
        // Stream closed without a done event.
        if (raf) cancelAnimationFrame(raf);
        bot.classList.remove("streaming");
        // The stream ended without "done": the connection dropped (often a server restart mid-answer).
        mdEl.innerHTML =
          (acc ? markdown(acc) : "") +
          `<div class="callout bad">${icon("alert", 15)}<span>The connection closed before the answer was complete, possibly a server restart. Nothing you asked for was lost; send the message again.</span></div>`;
      }
    } catch (err) {
      if (raf) cancelAnimationFrame(raf);
      bot.classList.remove("streaming");
      for (const t of toolsEl.querySelectorAll(".tool.run")) t.classList.replace("run", "stopped");
      if ((err as Error).name === "AbortError") {
        mdEl.innerHTML = (acc ? markdown(acc) : "") + `<p class="stopped-note">${icon("stop", 12, 2.4)}Stopped</p>`;
      } else {
        const msg = (err as Error).message || "Something went wrong.";
        mdEl.innerHTML = (acc ? markdown(acc) : "") + `<div class="callout bad">${icon("alert", 15)}<span>${esc(msg)}</span></div>`;
        toast(msg, "error");
      }
    } finally {
      controller = null;
      syncSend();
      if (ctx.alive()) {
        void loadThreads();
        input.focus();
      }
    }
  };

  /* Events */
  $<HTMLFormElement>("composer").addEventListener("submit", e => {
    e.preventDefault();
    if (controller) {
      controller.abort();
      return;
    }
    void sendMessage(input.value.trim());
  });
  input.addEventListener("input", grow);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!controller) void sendMessage(input.value.trim());
    }
  });
  input.addEventListener("paste", e => {
    const fl = e.clipboardData?.files;
    if (fl && fl.length) {
      e.preventDefault();
      addFiles(fl);
    }
  });
  $("attach").addEventListener("click", () => $<HTMLInputElement>("file").click());
  $<HTMLInputElement>("file").addEventListener("change", e => {
    const el = e.target as HTMLInputElement;
    if (el.files) addFiles(el.files);
    el.value = "";
  });
  $("att-chips").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-rm]");
    if (!b) return;
    const id = Number(b.dataset.rm);
    const f = files.find(x => x.id === id);
    if (f?.url) URL.revokeObjectURL(f.url);
    files = files.filter(x => x.id !== id);
    renderFiles();
  });
  const convo = $("convo");
  let dragDepth = 0;
  convo.addEventListener("dragenter", e => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    convo.classList.add("dragging");
  });
  convo.addEventListener("dragover", e => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  convo.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) convo.classList.remove("dragging");
  });
  convo.addEventListener("drop", e => {
    e.preventDefault();
    dragDepth = 0;
    convo.classList.remove("dragging");
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  inner.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suggest]");
    if (b) void sendMessage(b.dataset.suggest!);
  });
  $("new-chat").addEventListener("click", () => navigate("/app/chat"));
  const closeThreads = () => view.querySelector(".chat")!.classList.remove("show-threads");
  $("threads-btn").addEventListener("click", () => view.querySelector(".chat")!.classList.toggle("show-threads"));
  $("threads-scrim").addEventListener("click", closeThreads);
  listEl.addEventListener("click", async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-del]");
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.del!;
    const t = threads.find(x => x.id === id);
    if (!(await confirmDialog("Delete chat?", `“${t?.title || "This chat"}” and its messages will be deleted. Documents attached in it stay in your library.`, "Delete chat", true))) return;
    try {
      await del(`/api/v1/chats/${encodeURIComponent(id)}`);
    } catch {
      return;
    }
    threads = threads.filter(x => x.id !== id);
    toast("Chat deleted", "ok");
    if (id === chatId) navigate("/app/chat", { replace: true });
    else paintThreads();
  });

  /* Load */
  const pendingPrompt = takePendingPrompt();
  if (chatId) {
    inner.innerHTML = `<div class="msg bot"><span class="bot-av" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span><div class="msg-body">${sk("70%", 14)}<div style="height:8px"></div>${sk("50%", 14)}</div></div>`;
  } else emptyState();
  void loadThreads();
  if (chatId) {
    try {
      const data = await get<{ chat: ChatSummary; messages: ChatMessage[] }>(`/api/v1/chats/${encodeURIComponent(chatId)}`);
      if (!ctx.alive()) return;
      $("chat-title").textContent = data.chat.title || "New chat";
      inner.innerHTML = data.messages.map(m => (m.role === "user" ? userMsg(m) : botMsg(m))).join("");
      if (!data.messages.length) emptyState();
      toBottom(true);
    } catch {
      if (!ctx.alive()) return;
      inner.innerHTML = `<div class="chat-empty"><h2>Chat not found</h2><p>It may have been deleted.</p><a class="btn primary sm" href="/app/chat">Start a new chat</a></div>`;
      return;
    }
  }
  syncSend();
  if (pendingPrompt) void sendMessage(pendingPrompt);
  else if (matchMedia("(min-width: 900px)").matches) input.focus();
}
