import type { CheckStatus, PayoutResult } from "../../../src/types.js";
import { $, esc, short, shortHash } from "../shared/dom.js";
import { reducedMotion } from "../shared/nav.js";
import type { RunState } from "./api.js";

const svg = (size: number, stroke: number, body: string): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SHIELD = `<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/>`;

export const I = {
  check: svg(14, 3, `<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  shield: svg(18, 2, SHIELD),
  shieldSm: svg(14, 2, SHIELD),
  alert: svg(18, 2, `<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>`),
  info: svg(18, 2, `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  out: svg(12, 2.4, `<path d="M7 17L17 7M9 7h8v8"/>`),
  chev: svg(14, 2.2, `<path d="M6 9l6 6 6-6"/>`),
  lock: svg(12, 2.4, `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`),
  copy: svg(14, 2, `<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>`),
  expand: svg(14, 2.2, `<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/>`),
  close: svg(18, 2.2, `<path d="M6 6l12 12M18 6L6 18"/>`),
  arrowRight: svg(18, 2.2, `<path d="M5 12h14M13 6l6 6-6 6"/>`),
  refresh: svg(15, 2.2, `<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>`),
};

/** A long address, shortened, with copy and show-all buttons (wire them with bindAddr). */
export const addrHtml = (address: string): string => `<span class="addr">
    <span class="mono addr-v" data-full="${esc(address)}" data-short="${esc(short(address))}" title="${esc(address)}">${esc(short(address))}</span>
    <button class="addr-b" type="button" data-copy="${esc(address)}" aria-label="Copy the address" title="Copy">${I.copy}</button>
    ${short(address) === address ? "" : `<button class="addr-b" type="button" data-expand aria-expanded="false" aria-label="Show the full address" title="Show all">${I.expand}</button>`}
  </span>`;

/** Copy and show-all for every addrHtml() inside root (delegated). */
export function bindAddr(root: HTMLElement): void {
  root.addEventListener("click", e => {
    const button = (e.target as Element).closest<HTMLButtonElement>(".addr-b");
    const value = button?.closest(".addr")?.querySelector<HTMLElement>(".addr-v");
    if (!button || !value) return;
    if (button.dataset.copy !== undefined) {
      const done = (ok: boolean) => {
        button.classList.toggle("copied", ok);
        button.setAttribute("aria-label", ok ? "Copied" : "Copy failed");
        window.setTimeout(() => {
          button.classList.remove("copied");
          button.setAttribute("aria-label", "Copy the address");
        }, 1600);
      };
      // No clipboard API outside a secure context (plain http): "Copy failed", show-all still works.
      if (!window.isSecureContext || !navigator.clipboard) done(false);
      else void navigator.clipboard.writeText(button.dataset.copy).then(() => done(true), () => done(false));
      return;
    }
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    value.textContent = (open ? value.dataset.full : value.dataset.short) ?? "";
    value.closest(".addr")!.classList.toggle("full", open);
  });
}

type Tone = "run" | "ok" | "done" | "warn" | "bad";
const STATE: Record<RunState, [label: string, tone: Tone]> = {
  CREATED: ["Received", "run"],
  EXTRACTED: ["Reading", "run"],
  PRECHECKED: ["Checking", "run"],
  PAYING: ["Verifying", "run"],
  PAID: ["Verified", "run"],
  DRAFT_READY: ["Awaiting you", "ok"],
  NEEDS_INFO: ["Needs info", "warn"],
  BLOCKED: ["Blocked", "bad"],
  SETTLEMENT_UNKNOWN: ["Locked", "bad"],
  FAILED: ["Stopped", "bad"],
  EXECUTING: ["Paying", "run"],
  EXECUTED: ["Paid", "done"],
  PAYOUT_UNKNOWN: ["Locked", "bad"],
  REJECTED: ["Rejected", "bad"],
};

/** Status pill; an executed run is labeled by its payout status, never by its rail. */
export function pill(state: RunState, payoutStatus?: PayoutResult["status"]): string {
  let [text, kind]: [string, Tone] = STATE[state] ?? [state, "run"];
  if (state === "EXECUTED" && payoutStatus === "simulated") text = "Paid · simulated";
  if (state === "EXECUTED" && payoutStatus === "submitted") [text, kind] = ["Submitted", "ok"];
  return `<span class="pill t-${kind}">${kind === "run" ? `<i class="live"></i>` : ""}${esc(text)}</span>`;
}

export type CalloutKind = "info" | "ok" | "warn" | "bad";
/** title and text are HTML: escape at the call site. */
export function callout(kind: CalloutKind, title: string, text: string): string {
  const icon = kind === "bad" || kind === "warn" ? I.alert : kind === "ok" ? I.shield : I.info;
  return `<div class="callout c-${kind}">${icon}<div><b>${title}</b>${text}</div></div>`;
}

export const txLink = (hash?: string, url?: string): string =>
  hash ? `<a class="tx" href="${esc(url)}" target="_blank" rel="noopener">tx ${esc(shortHash(hash))} ${I.out}</a>` : "";

export interface CheckRow {
  status: CheckStatus;
  message: string;
  source?: string;
}
const CHECK_GLYPH: Record<CheckStatus, string> = { pass: "✓", fail: "✕", warn: "!", skip: "·" };
export const checkList = (rows: CheckRow[]): string =>
  `<ul class="checks">${rows
    .map(c => `<li><span class="ci ${esc(c.status)}">${CHECK_GLYPH[c.status] ?? "·"}</span><span>${esc(c.message)}</span>${c.source ? `<span class="src">${esc(c.source)}</span>` : ""}</li>`)
    .join("")}</ul>`;

export const initials = (name?: string): string =>
  (name || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
/** Stable avatar tint per supplier name: v0..v2. */
export const tone = (name?: string): string => `v${[...(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % 3}`;

export const eta = (hours?: number): string =>
  hours == null ? "" : hours < 1 ? `~${Math.max(1, Math.round(hours * 60))} min` : hours < 24 ? `~${Math.round(hours)} h` : `~${Math.round(hours / 24)} day${hours >= 48 ? "s" : ""}`;
export const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

let toastTimer: number | undefined;
export function toast(message: string): void {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 3800);
}

/** Animates a number from its last shown value (kept in data-v). */
export function countTo(el: HTMLElement, value: number, format: (v: number) => string = v => String(Math.round(v))): void {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(value);
  if (from === value || reducedMotion()) {
    el.textContent = format(value);
    return;
  }
  const t0 = performance.now();
  const frame = (t: number) => {
    const k = Math.min(1, (t - t0) / 800);
    el.textContent = format(from + (value - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
