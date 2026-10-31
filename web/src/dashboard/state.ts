// Shared client state and navigation for the dashboard. Pages import from here (not main.ts).
import { get } from "./api.js";
import type { Me, Payment } from "./types.js";

export interface Ctx {
  /** Path params from the route pattern. */
  params: string[];
  query: URLSearchParams;
  /** False once the user navigated away: stop polling, ignore late responses. */
  alive: () => boolean;
  onCleanup: (fn: () => void) => void;
  /** Re-renders the current route in place (after a mutation). */
  reload: () => void;
}

export const state: { me: Me | null; approvals: number } = { me: null, approvals: 0 };

type Navigate = (path: string, opts?: { replace?: boolean; silent?: boolean }) => void;
let navImpl: Navigate = path => {
  location.href = path;
};
export const navigate: Navigate = (path, opts) => navImpl(path, opts);
export function setNavigate(fn: Navigate): void {
  navImpl = fn;
}

/** A prompt handed to the chat page (from the Overview "Ask your AI CFO" box, document detail, ...). */
let pending: { text: string } | null = null;
export function askCfo(text: string): void {
  pending = { text };
  navigate("/app/chat");
}
export function takePendingPrompt(): string | null {
  const p = pending?.text ?? null;
  pending = null;
  return p;
}

const listeners = new Set<() => void>();
export function onStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitState(): void {
  for (const fn of listeners) fn();
}

/** Refreshes the approvals badge in the sidebar. */
export async function refreshBadges(): Promise<void> {
  try {
    const payments = await get<Payment[]>("/api/v1/payments", true);
    // Approvals and tADA payouts waiting for a wallet signature.
    state.approvals = payments.filter(p => p.status === "pending_approval" || p.status === "awaiting_signature").length;
    emitState();
  } catch {
    // badge only
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
  } finally {
    location.href = "/";
  }
}
