// Shared UI helpers for the dashboard: icons, formatting, toast, dialogs, skeletons, empty states.
import { esc, money } from "../shared/dom.js";
import type { Autonomy, Balance, PaymentStatus, Rail } from "./types.js";

/* Icons: 24×24 stroke paths (Lucide-style), rendered inline. */
const P: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
  doc: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  pay: '<path d="M3 7h18v12H3z"/><path d="M3 11h18M7 15h3"/>',
  budget: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  payees: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  shield: '<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/>',
  shieldCheck: '<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  clip: '<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1.5M15 13v1.5M2 13v3M22 13v3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  invoice: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M12.5 10.5v8M14.5 12h-2.75a1.6 1.6 0 0 0 0 3.2h1.5a1.6 1.6 0 0 1 0 3.2H10"/>',
  receipt: '<path d="M6 3h12v18l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  contract: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8.5 17.5c1.2-2.2 2.2-2.2 2.7-.2.4 1.6 1.4 1 2.3-.4.6-.9 1.3-.6 1.8.6"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUp: '<path d="M7 17L17 7M9 7h8v8"/>',
  arrowDown: '<path d="M17 7L7 17M15 17H7V9"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="M6 17l3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="M12 6l3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
};

export function icon(name: keyof typeof P | string, size = 18, sw = 1.9): string {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
}

/* Formatting */
const EXP: Record<string, number> = { JPY: 0, ADA: 6 };
export const exponent = (currency: string): number => EXP[currency] ?? 2;

/** USD cents → "$1,234.56" (or compact "$1.2k"). */
export function usd(minor: number | undefined, opts: { compact?: boolean; sign?: boolean; cents?: boolean } = {}): string {
  const v = (minor ?? 0) / 100;
  const abs = Math.abs(v);
  let s: string;
  if (opts.compact && abs >= 1000) {
    s = "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: abs >= 100000 ? 0 : 1 }).format(abs);
  } else {
    const digits = opts.cents === false || (opts.compact && abs >= 100) ? 0 : 2;
    s = "$" + abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  const neg = v < 0;
  if (neg) return `−${s}`;
  if (opts.sign && v > 0) return `+${s}`;
  return s;
}

/** Minor units in any currency. ADA minor units are lovelace (Cardano Preprod: tADA). */
export function amount(minor: number | undefined, currency: string | undefined): string {
  if (minor == null || !currency) return "—";
  if (currency === "ADA") return money(minor, "ADA");
  try {
    const e = exponent(currency);
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: e, maximumFractionDigits: e }).format(minor / 10 ** e);
  } catch {
    return money(minor, currency);
  }
}

/** Major-unit input ("1,250.50") → minor units for the currency. */
export function toMinor(major: string, currency: string): number {
  const n = Number(String(major).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10 ** exponent(currency));
}

export function balance(b: Balance): string {
  const n = Number(b.amount);
  const digits = /ADA|ETH|BTC/i.test(b.asset) ? 4 : 2;
  const v = Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }) : b.amount;
  return `${v} ${b.asset}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-31" or ISO timestamp → "Oct 31" (adds the year when not this year). */
export function date(s: string | undefined, withYear?: boolean): string {
  if (!s) return "—";
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const year = withYear ?? d.getFullYear() !== new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year ? `, ${d.getFullYear()}` : ""}`;
}
export function dateTime(s: string | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${date(s)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  const name = MONTHS[(m ?? 1) - 1] ?? ym;
  return long ? `${new Date(2000, (m ?? 1) - 1, 1).toLocaleString("en-US", { month: "long" })} ${y}` : name;
}
export function ago(s: string | undefined): string {
  if (!s) return "";
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return date(s);
}
/** Days from today to a YYYY-MM-DD date (negative: past). */
export function daysUntil(ymd: string | undefined): number | undefined {
  if (!ymd) return undefined;
  const d = new Date(`${ymd}T00:00:00`);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}
export function dueLabel(ymd: string | undefined): { text: string; tone: string } {
  const n = daysUntil(ymd);
  if (n == null) return { text: "No due date", tone: "" };
  if (n < 0) return { text: `${-n} d overdue`, tone: "t-bad" };
  if (n === 0) return { text: "Due today", tone: "t-warn" };
  if (n === 1) return { text: "Due tomorrow", tone: "t-warn" };
  return { text: `Due in ${n} d`, tone: n <= 7 ? "t-warn" : "t-neutral" };
}
export const bytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
export const titleCase = (s: string): string => s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join("") || "?";
/** Stable 0..2 tone for avatars. */
export const tone = (s: string): number => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
export const avatar = (name: string, cls = ""): string => `<span class="av v${tone(name)} ${cls}">${esc(initials(name))}</span>`;

/* Domain labels */
export const AUTONOMY: Record<Autonomy, { name: string; short: string; tone: string }> = {
  read_only: { name: "Read-only", short: "Read-only", tone: "t-ok" },
  guarded: { name: "Guarded", short: "Guarded", tone: "t-run" },
  full: { name: "Full access", short: "Full access", tone: "t-bad" },
};
export const RAIL: Record<Rail, { name: string; note: string }> = {
  cardano_preprod: { name: "Cardano Preprod", note: "testnet · tADA" },
  cashxchain: { name: "CashXChain", note: "sandbox rail" },
  manual: { name: "Manual", note: "paid outside" },
};
export const railChip = (r: Rail): string =>
  `<span class="rail rail-${r}"><b>${esc(RAIL[r]?.name ?? r)}</b><span>${esc(RAIL[r]?.note ?? "")}</span></span>`;
const STATUS: Record<PaymentStatus, [string, string]> = {
  pending_approval: ["Needs approval", "t-warn"],
  approved: ["Approved", "t-run"],
  executing: ["Executing", "t-run"],
  awaiting_signature: ["Sign in wallet", "t-warn"],
  executed: ["Paid", "t-ok"],
  rejected: ["Rejected", "t-neutral"],
  failed: ["Failed", "t-bad"],
  blocked: ["Blocked", "t-bad"],
};
export function statusPill(s: PaymentStatus): string {
  const [label, cls] = STATUS[s] ?? [s, "t-neutral"];
  return `<span class="pill ${cls}">${s === "executing" ? '<i class="live"></i>' : ""}${esc(label)}</span>`;
}
export const KIND_LABEL: Record<string, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  bank_statement: "Bank statement",
  contract: "Contract",
  payroll: "Payroll",
  tax: "Tax",
  other: "Other",
};

/* Toast */
let toastTimer = 0;
export function toast(message: string, kind: "info" | "error" | "ok" = "info"): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "alert" : kind === "ok" ? "check" : "info", 16, 2.2)}<span>${esc(message)}</span>`;
  void el.offsetWidth;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), kind === "error" ? 5200 : 3200);
}

/* Dialogs (native <dialog>, so Esc and focus handling come for free) */
export interface DialogOptions {
  title: string;
  body: string;
  /** Submit button label; omit for an info dialog. */
  submit?: string;
  danger?: boolean;
  wide?: boolean;
  onOpen?: (form: HTMLFormElement, close: () => void) => void;
  /** Return false (or throw) to keep the dialog open. */
  onSubmit?: (form: HTMLFormElement) => Promise<boolean | void> | boolean | void;
}
export function dialog(opts: DialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = `dlg${opts.wide ? " wide" : ""}`;
    d.innerHTML = `<form method="dialog" class="dlg-form" novalidate>
      <header class="dlg-head"><h2>${esc(opts.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon("x")}</button></header>
      <div class="dlg-body">${opts.body}</div>
      <footer class="dlg-foot">
        <button type="button" class="btn ghost sm" data-close>${opts.submit ? "Cancel" : "Close"}</button>
        ${opts.submit ? `<button type="submit" class="btn sm ${opts.danger ? "danger" : "primary"}" data-submit>${esc(opts.submit)}</button>` : ""}
      </footer></form>`;
    document.body.append(d);
    const form = d.querySelector("form")!;
    let result = false;
    const close = () => d.close();
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    // Close on a backdrop click only when the press also started on the backdrop, outside the box.
    // A bare "target === dialog" also fires when a select's option list or a text selection ends
    // outside the form, which closed the dialog in the middle of choosing.
    const outside = (e: MouseEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    d.addEventListener("pointerdown", e => {
      pressedOutside = e.target === d && outside(e);
    });
    d.addEventListener("click", e => {
      if (pressedOutside && e.target === d && outside(e)) close();
      pressedOutside = false;
    });
    for (const b of d.querySelectorAll("[data-close]")) b.addEventListener("click", close);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("[data-submit]");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.classList.add("loading");
      try {
        const ok = opts.onSubmit ? await opts.onSubmit(form) : true;
        if (ok !== false) {
          result = true;
          close();
        }
      } catch {
        // the API layer already showed a toast
      } finally {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    });
    d.showModal();
    // showModal focuses the close button; onOpen may focus a field of its own (e.g. a new payee's
    // name). Only fall back to the first field when onOpen did not.
    const before = document.activeElement;
    opts.onOpen?.(form, close);
    if (document.activeElement === before) {
      form.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea")?.focus();
    }
  });
}
export function confirmDialog(title: string, message: string, submit = "Confirm", danger = false): Promise<boolean> {
  return dialog({ title, body: `<p class="dlg-text">${esc(message)}</p>`, submit, danger });
}
/** Marks a field invalid with an inline message; returns false for chaining in onSubmit. */
export function fieldError(form: HTMLFormElement, name: string, message: string): false {
  const input = form.elements.namedItem(name) as HTMLElement | null;
  const field = input?.closest(".field");
  field?.classList.add("invalid");
  let msg = field?.querySelector(".field-err");
  if (field && !msg) {
    msg = document.createElement("span");
    msg.className = "field-err";
    field.append(msg);
  }
  if (msg) msg.textContent = message;
  input?.focus();
  input?.addEventListener("input", () => field?.classList.remove("invalid"), { once: true });
  return false;
}
export const val = (form: HTMLFormElement, name: string): string =>
  ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "").trim();

/* Skeletons and empty states */
export const sk = (w = "100%", h = 14, r = 8): string => `<span class="sk" style="width:${w};height:${h}px;border-radius:${r}px"></span>`;
export const skLines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<div class="sk-row">${sk("36px", 36, 12)}<div class="sk-col">${sk(`${60 - (i % 3) * 12}%`)}${sk(`${35 + (i % 2) * 10}%`, 11)}</div>${sk("70px")}</div>`).join("");
export const skCard = (h = 220): string => `<div class="card sk-card">${sk("40%", 18)}<div style="height:18px"></div>${sk("100%", h - 60, 14)}</div>`;

export function empty(opts: { icon: string; title: string; text: string; action?: string }): string {
  return `<div class="empty-state"><div class="empty-ill">${icon(opts.icon, 26, 1.8)}</div><b>${esc(opts.title)}</b><p>${esc(opts.text)}</p>${opts.action ?? ""}</div>`;
}

export function pageHead(title: string, sub: string, actions = ""): string {
  return `<header class="page-head"><div class="page-title"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard", "ok");
  } catch {
    toast("Copy failed. Select the text and copy it manually.", "error");
  }
}

/** Reads a File as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}
export const MAX_FILE = 15 * 1024 * 1024;
export const ACCEPT = "image/*,application/pdf,text/csv,text/plain,.csv,.txt,.pdf";
export function fileIcon(mime: string): string {
  return mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "doc" : "file";
}
/** Icon for a document row: its kind once read, a warning when reading failed, else the file type. */
export const KIND_ICON: Record<string, string> = {
  invoice: "invoice",
  receipt: "receipt",
  bank_statement: "bank",
  contract: "contract",
  payroll: "payees",
  tax: "percent",
};
export function docIcon(d: { kind?: string; status: string; mimeType: string }): string {
  if (d.status === "failed") return "alert";
  return (d.kind && KIND_ICON[d.kind]) || fileIcon(d.mimeType);
}
/** Mime fallback for files the browser reports without a type. */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "csv" ? "text/csv" : ext === "txt" ? "text/plain" : ext === "pdf" ? "application/pdf" : "application/octet-stream";
}
