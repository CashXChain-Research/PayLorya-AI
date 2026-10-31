// Documents: multi-file upload with progress, processing state, filters, table, detail view.
import { esc } from "../../shared/dom.js";
import { del, get, postWithProgress } from "../api.js";
import { askCfo, type Ctx, navigate } from "../state.js";
import type { DocumentDetail, DocumentSummary, DocumentUpload } from "../types.js";
import {
  ACCEPT,
  amount,
  bytes,
  confirmDialog,
  date,
  dateTime,
  daysUntil,
  docIcon,
  dueLabel,
  empty,
  fileIcon,
  fileToBase64,
  icon,
  KIND_LABEL,
  MAX_FILE,
  mimeOf,
  pageHead,
  sk,
  skLines,
  statusPill,
  titleCase,
  toast,
  usd,
} from "../ui.js";
import { newPaymentDialog } from "./payments.js";

const KIND_PLURAL: Record<string, string> = {
  invoice: "Invoices",
  receipt: "Receipts",
  bank_statement: "Bank statements",
  contract: "Contracts",
  payroll: "Payroll",
  tax: "Tax",
  other: "Other",
};
const docPath = (id: string) => `/api/v1/documents/${encodeURIComponent(id)}`;

function statusCell(d: DocumentSummary): string {
  if (d.status === "processing") return `<span class="pill t-run"><i class="live"></i>Reading</span>`;
  if (d.status === "failed") return `<span class="pill t-bad" title="${esc(d.error ?? "")}">Failed</span>`;
  return `<span class="pill t-ok">${icon("check", 11, 3)}Ready</span>`;
}

function row(d: DocumentSummary): string {
  const due = d.dueDate && d.kind === "invoice" ? dueLabel(d.dueDate) : null;
  return `<tr data-id="${esc(d.id)}" tabindex="0">
    <td class="c-doc"><div class="c-doc-in"><span class="doc-ic ${d.status} k-${esc(d.kind ?? "none")}">${icon(docIcon(d), 17)}</span><div><b>${esc(d.title || d.filename)}</b><span>${esc(d.title ? d.filename : bytes(d.size))}${d.source === "chat" ? " · from chat" : ""}</span></div></div></td>
    <td class="c-kind">${d.kind ? `<span class="kind k-${d.kind}">${esc(KIND_LABEL[d.kind] ?? d.kind)}</span>` : d.status === "processing" ? sk("60px", 12) : '<span class="muted">—</span>'}</td>
    <td class="c-cp">${esc(d.counterparty || "—")}</td>
    <td class="c-amt num">${d.amountMinor != null ? esc(amount(d.amountMinor, d.currency)) : '<span class="muted">—</span>'}</td>
    <td class="c-due">${d.dueDate ? `<span>${esc(date(d.dueDate))}</span>${due && due.tone && due.tone !== "t-neutral" ? `<em class="${due.tone}">${esc(due.text)}</em>` : ""}` : '<span class="muted">—</span>'}</td>
    <td class="c-cat">${d.category ? `<span class="cat">${esc(d.category)}</span>` : '<span class="muted">—</span>'}</td>
    <td class="c-st">${statusCell(d)}</td>
  </tr>`;
}

interface QueueItem {
  key: number;
  file: File;
  state: "waiting" | "reading" | "uploading" | "processing" | "done" | "failed";
  progress: number;
  doc?: DocumentSummary;
  error?: string;
}

export async function renderDocuments(view: HTMLElement, ctx: Ctx): Promise<void> {
  let docs: DocumentSummary[] = [];
  let kind = "all";
  let q = "";
  const queue: QueueItem[] = [];
  let seq = 0;
  let running = false;
  const polling = new Set<string>();

  view.innerHTML = `${pageHead("Documents", "Upload invoices, receipts, statements, contracts and payroll. Claude reads them and extracts amounts, dates and counterparties.")}
  <label class="drop" id="drop" tabindex="0">
    <input type="file" id="doc-file" multiple accept="${ACCEPT}" hidden>
    <span class="drop-ic">${icon("upload", 22)}</span>
    <span class="drop-t"><b>Drop files here or <u>browse</u></b><span>PDF, photos, CSV or text · up to 15 MB each · multiple files at once</span></span>
  </label>
  <ul class="queue" id="queue" hidden></ul>
  <section class="card list-card">
    <div class="list-head">
      <div class="chips" id="kinds"></div>
    </div>
    <div class="filters" id="doc-filters" role="search">
      <label class="search">${icon("search", 15)}<input id="doc-q" type="search" autocomplete="off" placeholder="Search documents" aria-label="Search documents"></label>
      <select class="fsel" id="df-cat" aria-label="Category"><option value="">All categories</option></select>
      <select class="fsel" id="df-due" aria-label="Due date"><option value="">Any due date</option><option value="overdue">Overdue</option><option value="14">Due in 14 days</option><option value="none">No due date</option></select>
      <select class="fsel" id="df-period" aria-label="Uploaded"><option value="">Uploaded any time</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <select class="fsel" id="df-src" aria-label="Source"><option value="">All sources</option><option value="upload">Uploaded</option><option value="chat">From chat</option></select>
      <button type="button" class="link-sm" id="df-clear" hidden>Clear filters</button>
      <span class="pf-count" id="df-count" aria-live="polite"></span>
    </div>
    <div class="tbl-wrap" id="doc-table"><div class="pad">${skLines(6)}</div></div>
  </section>`;

  const tableEl = view.querySelector<HTMLElement>("#doc-table")!;
  // Filters next to the kind chips and search: category, due date, upload period, source.
  const fsel = {
    cat: view.querySelector<HTMLSelectElement>("#df-cat")!,
    due: view.querySelector<HTMLSelectElement>("#df-due")!,
    period: view.querySelector<HTMLSelectElement>("#df-period")!,
    src: view.querySelector<HTMLSelectElement>("#df-src")!,
  };
  const filtersOn = () => Object.values(fsel).some(el => el.value);
  const passes = (d: DocumentSummary): boolean => {
    if (fsel.cat.value && d.category !== fsel.cat.value) return false;
    if (fsel.src.value && d.source !== fsel.src.value) return false;
    const due = fsel.due.value;
    if (due) {
      const n = daysUntil(d.dueDate);
      if (due === "none" ? n != null : n == null || (due === "overdue" ? n >= 0 : n < 0 || n > Number(due))) return false;
    }
    const period = fsel.period.value;
    if (period === "month" && !d.createdAt.startsWith(new Date().toISOString().slice(0, 7))) return false;
    if (/^\d+$/.test(period) && Date.now() - Date.parse(d.createdAt) > Number(period) * 86_400_000) return false;
    return true;
  };
  let catKey = "";
  /** Category options follow the documents; the chosen one stays while it still exists. */
  const syncCategories = () => {
    const cats = [...new Set(docs.map(d => d.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b));
    const key = cats.join("\u0000");
    if (key === catKey) return;
    catKey = key;
    const keep = fsel.cat.value;
    fsel.cat.innerHTML = `<option value="">All categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}`;
    fsel.cat.value = cats.includes(keep) ? keep : "";
  };
  const kindsEl = view.querySelector<HTMLElement>("#kinds")!;
  const queueEl = view.querySelector<HTMLElement>("#queue")!;

  const paint = () => {
    const counts = new Map<string, number>();
    for (const d of docs) if (d.kind) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
    const issues = docs.filter(d => d.status !== "processed").length;
    kindsEl.innerHTML =
      `<button data-k="all" class="${kind === "all" ? "on" : ""}">All <em>${docs.length}</em></button>` +
      Object.keys(KIND_LABEL)
        .filter(k => counts.get(k))
        .map(k => `<button data-k="${k}" class="${kind === k ? "on" : ""}">${KIND_PLURAL[k] ?? KIND_LABEL[k]} <em>${counts.get(k)}</em></button>`)
        .join("") +
      (issues ? `<button data-k="pending" class="${kind === "pending" ? "on" : ""}">Processing &amp; failed <em>${issues}</em></button>` : "");
    const needle = q.toLowerCase();
    syncCategories();
    for (const el of Object.values(fsel)) el.classList.toggle("on", Boolean(el.value));
    const base = docs.filter(
      d =>
        (kind === "all" || (kind === "pending" ? d.status !== "processed" : d.kind === kind)) &&
        (!needle || [d.title, d.filename, d.counterparty, d.category].some(x => x?.toLowerCase().includes(needle))),
    );
    const rows = base.filter(passes);
    view.querySelector<HTMLElement>("#df-clear")!.hidden = !filtersOn();
    view.querySelector("#df-count")!.textContent = filtersOn() ? `${rows.length} of ${base.length}` : "";
    if (!docs.length) {
      tableEl.innerHTML = empty({ icon: "doc", title: "No documents yet", text: "Upload your first invoices, receipts or bank statements above. Your AI CFO reads them and keeps your books, budgets and forecast current." });
      return;
    }
    if (!rows.length) {
      tableEl.innerHTML = empty({
        icon: "search",
        title: "No matches",
        text: "Try another filter or search term.",
        ...(filtersOn() ? { action: `<button class="btn ghost sm" type="button" data-clear-filters>Clear filters</button>` } : {}),
      });
      return;
    }
    tableEl.innerHTML = `<table class="tbl docs"><thead><tr><th>Document</th><th class="c-kind">Kind</th><th class="c-cp">Counterparty</th><th class="c-amt num">Amount</th><th class="c-due">Due</th><th class="c-cat">Category</th><th class="c-st">Status</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`;
  };

  const poll = (id: string) => {
    if (polling.has(id)) return;
    polling.add(id);
    const started = Date.now();
    const tick = async () => {
      if (!ctx.alive()) return;
      try {
        const d = await get<DocumentDetail>(docPath(id), true);
        if (!ctx.alive()) return;
        if (d.status !== "processing" || Date.now() - started > 180000) {
          polling.delete(id);
          const i = docs.findIndex(x => x.id === id);
          if (i >= 0) docs[i] = d;
          else docs.unshift(d);
          const qi = queue.find(x => x.doc?.id === id);
          if (qi) {
            qi.doc = d;
            qi.state = d.status === "processed" ? "done" : d.status === "failed" ? "failed" : "processing";
            qi.error = d.error;
            paintQueue();
          }
          paint();
          return;
        }
      } catch {
        // keep polling
      }
      const t = window.setTimeout(tick, 1500);
      ctx.onCleanup(() => window.clearTimeout(t));
    };
    const t = window.setTimeout(tick, 1200);
    ctx.onCleanup(() => window.clearTimeout(t));
  };

  const STATE_TEXT: Record<QueueItem["state"], string> = {
    waiting: "Waiting",
    reading: "Preparing",
    uploading: "Uploading",
    processing: "Claude is reading it…",
    done: "Done",
    failed: "Failed",
  };
  const paintQueue = () => {
    queueEl.hidden = !queue.length;
    const active = queue.some(x => x.state !== "done" && x.state !== "failed");
    queueEl.innerHTML =
      queue
        .map(it => {
          const pct = it.state === "uploading" ? Math.round(it.progress * 100) : it.state === "waiting" || it.state === "reading" ? 0 : 100;
          const label =
            it.state === "done" && it.doc
              ? `${KIND_LABEL[it.doc.kind ?? "other"] ?? "Document"}${it.doc.counterparty ? ` from ${it.doc.counterparty}` : ""}${it.doc.amountMinor != null ? ` · ${amount(it.doc.amountMinor, it.doc.currency)}` : ""}`
              : it.state === "failed"
                ? it.error || "Could not process this file"
                : `${STATE_TEXT[it.state]}${it.state === "uploading" ? ` ${pct}%` : ""}`;
          return `<li class="q-item q-${it.state}">
          <span class="q-ic">${it.state === "done" ? icon("check", 16, 2.6) : it.state === "failed" ? icon("alert", 16) : it.state === "processing" ? '<i class="spin"></i>' : icon(fileIcon(mimeOf(it.file)), 16)}</span>
          <div class="q-body"><div class="q-top"><b>${esc(it.file.name)}</b><span>${esc(bytes(it.file.size))}</span></div>
          <div class="q-bar"><i style="width:${pct}%"></i></div><span class="q-state">${esc(label)}</span></div>
          ${it.doc && it.state === "done" ? `<a class="btn ghost xs" href="/app/documents/${esc(it.doc.id)}">Open</a>` : ""}
        </li>`;
        })
        .join("") + (active ? "" : `<li class="q-foot"><button type="button" class="link-sm" id="q-clear">Clear finished</button></li>`);
  };

  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const it = queue.find(x => x.state === "waiting");
        if (!it || !ctx.alive()) break;
        it.state = "reading";
        paintQueue();
        try {
          const body: DocumentUpload = { filename: it.file.name, mimeType: mimeOf(it.file), dataBase64: await fileToBase64(it.file) };
          it.state = "uploading";
          paintQueue();
          let lastPaint = 0;
          const doc = await postWithProgress<DocumentSummary>("/api/v1/documents", body, f => {
            it.progress = f;
            if (Date.now() - lastPaint > 80) {
              lastPaint = Date.now();
              paintQueue();
            }
          });
          it.doc = doc;
          it.state = doc.status === "processing" ? "processing" : doc.status === "failed" ? "failed" : "done";
          it.error = doc.error;
          docs.unshift(doc);
          paint();
          if (doc.status === "processing") poll(doc.id);
        } catch (err) {
          it.state = "failed";
          it.error = (err as Error).message;
          toast(`${it.file.name}: ${it.error}`, "error");
        }
        paintQueue();
      }
    } finally {
      running = false;
    }
  };

  const add = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE) {
        toast(`${file.name} is larger than 15 MB.`, "error");
        continue;
      }
      queue.push({ key: ++seq, file, state: "waiting", progress: 0 });
    }
    paintQueue();
    void run();
  };

  const drop = view.querySelector<HTMLElement>("#drop")!;
  const fileIn = view.querySelector<HTMLInputElement>("#doc-file")!;
  fileIn.addEventListener("change", () => {
    if (fileIn.files) add(fileIn.files);
    fileIn.value = "";
  });
  drop.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileIn.click();
    }
  });
  drop.addEventListener("dragover", e => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer?.files.length) add(e.dataTransfer.files);
  });
  queueEl.addEventListener("click", e => {
    if ((e.target as HTMLElement).closest("#q-clear")) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.state === "done" || queue[i]!.state === "failed") queue.splice(i, 1);
      paintQueue();
    }
  });
  kindsEl.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-k]");
    if (!b) return;
    kind = b.dataset.k!;
    paint();
  });
  view.querySelector<HTMLElement>("#doc-filters")!.addEventListener("input", () => paint());
  view.addEventListener("click", e => {
    if (!(e.target as HTMLElement).closest("#df-clear, [data-clear-filters]")) return;
    for (const el of Object.values(fsel)) el.value = "";
    paint();
  });
  view.querySelector<HTMLInputElement>("#doc-q")!.addEventListener("input", e => {
    q = (e.target as HTMLInputElement).value.trim();
    paint();
  });
  tableEl.addEventListener("click", e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (tr) navigate(`/app/documents/${encodeURIComponent(tr.dataset.id!)}`);
  });
  tableEl.addEventListener("keydown", e => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (tr && e.key === "Enter") navigate(`/app/documents/${encodeURIComponent(tr.dataset.id!)}`);
  });

  docs = await get<DocumentSummary[]>("/api/v1/documents");
  if (!ctx.alive()) return;
  docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  paint();
  for (const d of docs) if (d.status === "processing") poll(d.id);
}

/* Detail */

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fmtValue(v: unknown): string {
  if (v == null || v === "") return '<span class="muted">—</span>';
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return esc(v.toLocaleString("en-US"));
  return esc(String(v));
}
function extractedHtml(v: unknown, depth = 0): string {
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="muted">None</span>';
    if (v.every(isPlainObject)) {
      const keys = [...new Set(v.flatMap(o => Object.keys(o as object)))].slice(0, 6);
      return `<div class="md-table"><table><thead><tr>${keys.map(k => `<th>${esc(titleCase(k))}</th>`).join("")}</tr></thead><tbody>${v
        .map(o => `<tr>${keys.map(k => `<td>${isPlainObject((o as Record<string, unknown>)[k]) ? esc(JSON.stringify((o as Record<string, unknown>)[k])) : fmtValue((o as Record<string, unknown>)[k])}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
    }
    return v.map(fmtValue).join(", ");
  }
  if (isPlainObject(v)) {
    const entries = Object.entries(v);
    if (!entries.length) return '<span class="muted">—</span>';
    return `<dl class="kv ${depth ? "nested" : ""}">${entries.map(([k, x]) => `<dt>${esc(titleCase(k))}</dt><dd>${isPlainObject(x) || Array.isArray(x) ? extractedHtml(x, depth + 1) : fmtValue(x)}</dd>`).join("")}</dl>`;
  }
  return fmtValue(v);
}

async function preview(el: HTMLElement, d: DocumentDetail): Promise<void> {
  const src = `${docPath(d.id)}/file`;
  if (d.mimeType.startsWith("image/")) {
    el.innerHTML = `<img src="${esc(src)}" alt="${esc(d.filename)}" loading="lazy">`;
  } else if (d.mimeType === "application/pdf") {
    el.innerHTML = `<iframe src="${esc(src)}#view=FitH&toolbar=0" title="${esc(d.filename)}"></iframe><a class="preview-open" href="${esc(src)}" target="_blank" rel="noopener">${icon("external", 13)}Open PDF in a new tab</a>`;
  } else if (d.mimeType.startsWith("text/") || /csv/.test(d.mimeType)) {
    el.innerHTML = `<div class="pad">${sk("90%")}<div style="height:8px"></div>${sk("70%")}</div>`;
    try {
      const res = await fetch(src, { credentials: "same-origin" });
      const text = await res.text();
      const lines = text.split("\n");
      if (/csv/.test(d.mimeType) || d.filename.endsWith(".csv")) {
        const rows = lines.filter(l => l.trim()).slice(0, 60).map(l => l.split(",").map(c => c.replace(/^"|"$/g, "")));
        el.innerHTML = `<div class="csv"><table>${rows.map((r, i) => `<tr>${r.map(c => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join("")}</tr>`).join("")}</table></div>`;
      } else el.innerHTML = `<pre class="txt">${esc(lines.slice(0, 300).join("\n"))}</pre>`;
    } catch {
      el.innerHTML = `<div class="chart-empty">Preview unavailable.</div>`;
    }
  } else {
    el.innerHTML = `<div class="chart-empty">No preview for this file type. <a href="${esc(src)}" download="${esc(d.filename)}">Download it</a>.</div>`;
  }
}

export async function renderDocument(view: HTMLElement, ctx: Ctx): Promise<void> {
  const id = ctx.params[0]!;
  view.innerHTML = `<a class="back" href="/app/documents">${icon("chevronLeft", 16)}Documents</a>
    <header class="page-head"><div class="page-title">${sk("320px", 30)}<div style="height:10px"></div>${sk("200px", 13)}</div></header>
    <div class="doc-grid"><div class="card preview-card">${sk("100%", 480, 14)}</div><div class="col">${skLinesCard()}${skLinesCard()}</div></div>`;
  let d: DocumentDetail;
  try {
    d = await get<DocumentDetail>(docPath(id), true);
  } catch {
    if (!ctx.alive()) return;
    view.innerHTML = `<a class="back" href="/app/documents">${icon("chevronLeft", 16)}Documents</a>${empty({ icon: "doc", title: "Document not found", text: "It may have been deleted.", action: `<a class="btn primary sm" href="/app/documents">Back to documents</a>` })}`;
    return;
  }
  if (!ctx.alive()) return;
  const due = d.dueDate ? dueLabel(d.dueDate) : null;
  const payable = d.status === "processed" && (d.kind === "invoice" || d.kind === "payroll" || d.kind === "tax");
  const paid = d.payments.some(p => p.status === "executed");
  const subtitle = [d.kind ? KIND_LABEL[d.kind] : null, d.filename, `${bytes(d.size)}`, `uploaded ${date(d.createdAt)}${d.source === "chat" ? " in chat" : ""}`].filter(Boolean).map(x => esc(x)).join(" · ");

  view.innerHTML = `<a class="back" href="/app/documents">${icon("chevronLeft", 16)}Documents</a>
  ${pageHead(
    d.title || d.filename,
    subtitle,
    `<button class="btn ghost sm" type="button" id="d-ask">${icon("sparkle", 16)}Ask CFO about this</button>
     ${d.status === "processed" ? `<button class="btn ${payable && !paid ? "primary" : "ghost"} sm" type="button" id="d-pay">${icon("pay", 16)}Draft payment</button>` : ""}
     <a class="icon-btn boxed" href="${esc(docPath(d.id))}/file" download="${esc(d.filename)}" aria-label="Download original" title="Download original">${icon("download", 17)}</a>
     <button class="icon-btn boxed danger-h" type="button" id="d-del" aria-label="Delete document" title="Delete document">${icon("trash", 17)}</button>`,
  )}
  ${d.status === "processing" ? `<div class="callout run">${'<i class="spin"></i>'}<span>Claude is reading this document. Fields appear here when it is done.</span></div>` : ""}
  ${d.status === "failed" ? `<div class="callout bad">${icon("alert", 15)}<span>${esc(d.error || "This document could not be processed.")} Try uploading a clearer copy.</span></div>` : ""}
  <div class="doc-grid">
    <div class="card preview-card"><div class="preview" id="preview"></div></div>
    <div class="col">
      <section class="card">
        <div class="card-head"><h2>Summary</h2>${d.status === "processed" ? '<span class="pill t-ok">' + icon("check", 11, 3) + "Read by Claude</span>" : ""}</div>
        ${d.summary ? `<p class="doc-sum">${esc(d.summary)}</p>` : ""}
        <dl class="kv">
          <dt>Kind</dt><dd>${d.kind ? esc(KIND_LABEL[d.kind] ?? d.kind) : "—"}</dd>
          <dt>Counterparty</dt><dd>${esc(d.counterparty || "—")}</dd>
          <dt>Amount</dt><dd class="strong">${d.amountMinor != null ? esc(amount(d.amountMinor, d.currency)) : "—"}</dd>
          <dt>Issued</dt><dd>${esc(date(d.issueDate, true))}</dd>
          <dt>Due</dt><dd>${d.dueDate ? `${esc(date(d.dueDate, true))} ${due && !paid ? `<span class="pill ${due.tone}">${esc(due.text)}</span>` : ""}` : "—"}</dd>
          <dt>Category</dt><dd>${d.category ? `<span class="cat">${esc(d.category)}</span>` : "—"}</dd>
        </dl>
      </section>
      ${d.extracted && Object.keys(d.extracted).length ? `<section class="card"><div class="card-head"><h2>Extracted details</h2><span class="count">for reference</span></div><div class="extracted">${extractedHtml(d.extracted)}</div></section>` : ""}
      <section class="card">
        <div class="card-head"><h2>Payments</h2></div>
        ${d.payments.length ? `<ul class="link-list">${d.payments.map(p => `<li><a href="/app/payments?id=${esc(p.id)}"><div><b>${esc(p.payeeName)}</b><span>${esc(dateTime(p.createdAt))}</span></div><div class="ll-r"><b>${esc(amount(p.amountMinor, p.currency))}</b>${statusPill(p.status)}</div></a></li>`).join("")}</ul>` : `<p class="muted small">No payments linked to this document${payable ? ". Draft one and it goes through your policy checks." : "."}</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>Transactions</h2></div>
        ${d.transactions.length ? `<ul class="link-list">${d.transactions.map(t => `<li><div class="ll"><div><b>${esc(t.description)}</b><span>${esc(date(t.date))} · ${esc(t.category)}</span></div><div class="ll-r"><b class="${t.amountMinor < 0 ? "" : "pos"}">${esc(amount(t.amountMinor, t.currency))}</b>${t.currency !== "USD" ? `<span class="muted small">≈ ${esc(usd(t.usdMinor))}</span>` : ""}</div></div></li>`).join("")}</ul>` : `<p class="muted small">No transactions recorded from this document.</p>`}
      </section>
    </div>
  </div>`;

  void preview(view.querySelector<HTMLElement>("#preview")!, d);
  view.querySelector("#d-ask")!.addEventListener("click", () =>
    askCfo(`About the document “${d.title || d.filename}”${d.counterparty ? ` from ${d.counterparty}` : ""}: summarise what it says and tell me what I should do about it.`),
  );
  view.querySelector("#d-pay")?.addEventListener("click", async () => {
    const p = await newPaymentDialog({
      amountMinor: d.amountMinor,
      currency: d.currency,
      documentId: d.id,
      counterparty: d.counterparty,
      reason: [d.title || d.filename, d.counterparty].filter(Boolean).join(" · "),
    }).catch(() => null);
    if (p && ctx.alive()) ctx.reload();
  });
  view.querySelector("#d-del")!.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete document?", `“${d.title || d.filename}” and its extracted data will be removed. Payments already made are kept in the audit log.`, "Delete", true))) return;
    try {
      await del(docPath(d.id));
      toast("Document deleted", "ok");
      navigate("/app/documents", { replace: true });
    } catch {
      // toast shown
    }
  });
  if (d.status === "processing") {
    const t = window.setTimeout(() => ctx.reload(), 2500);
    ctx.onCleanup(() => window.clearTimeout(t));
  }
}

function skLinesCard(): string {
  return `<div class="card">${sk("30%", 18)}<div style="height:16px"></div>${skLines(3)}</div>`;
}
