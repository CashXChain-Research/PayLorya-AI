import { approvalsDisabled, storedToken, tokenRequired } from "../approval.js";
import { getSettings, type AgentSettings } from "./store.js";

/**
 * What auto-approve did in this tab: drafts decided once (by auto-approve or a click; never retried,
 * also after a reload) and drafts it approved (the Inbox stamp says so). Kept in sessionStorage.
 */
const KEY = "cxc-auto-approve";

function load(): { tried: string[]; approved: string[] } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as { tried?: unknown; approved?: unknown };
    const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
    return { tried: ids(saved.tried), approved: ids(saved.approved) };
  } catch {
    return { tried: [], approved: [] };
  }
}

const saved = load();
const tried = new Set(saved.tried);
const approved = new Set(saved.approved);
const listeners = new Set<(id?: string) => void>();
/** The server answered 401 to auto-approve (token missing or wrong). */
let refused = false;

function persist(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ tried: [...tried], approved: [...approved] }));
  } catch {
    // storage blocked: kept for this page view
  }
}

export const wasAttempted = (id: string): boolean => tried.has(id);
export const wasAutoApproved = (id: string): boolean => approved.has(id);

export function markAttempted(id: string, value = true): void {
  if (value) tried.add(id);
  else tried.delete(id);
  persist();
}

export function markAutoApproved(id: string, value: boolean): void {
  if (value) approved.add(id);
  else approved.delete(id);
  persist();
}

export function setTokenRefused(value: boolean): void {
  refused = value;
}

/** Auto-approve is on but waits for the operator token of this deployment. */
export const autoNeedsToken = (): boolean =>
  getSettings().approval === "auto" && !approvalsDisabled() && (tokenRequired() || refused) && !storedToken();

/** The auto-approve ceiling that applies to an invoice currency, e.g. "5 tADA" or "EUR 500". */
export function autoLimitText(currency: string, settings: AgentSettings): string {
  const ada = currency === "ADA";
  const n = (ada ? settings.autoMaxTada : settings.autoMaxFiat).toLocaleString("en-US", { maximumFractionDigits: ada ? 6 : 2 });
  return ada ? `${n} tADA` : `${currency} ${n}`;
}

/** Called after auto-approve acted on a run (id) or its token state changed (no id). */
export function onAutoChange(listener: (id?: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAutoChange(id?: string): void {
  for (const listener of listeners) listener(id);
}
