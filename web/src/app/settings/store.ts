/**
 * What the agent may do, as chosen in Agent settings. Stored in this browser and applied by this
 * browser on top of the server's hard limits (price cap, budgets, verified payees), which only the
 * operator can change.
 */
export interface AgentSettings {
  /** Buy x402 verification checks. Off: invoices cannot be sent to the agent. */
  buyChecks: boolean;
  /** Rails the agent may pay out on after approval. */
  payCardano: boolean;
  payCashxchain: boolean;
  /** "ask": every payout waits for a click. "auto": payouts within the limits below are approved by this browser. */
  approval: "ask" | "auto";
  /** Auto-approve ceilings in major units: tADA, and any fiat currency (EUR, USD, ...). */
  autoMaxTada: number;
  autoMaxFiat: number;
}

export const DEFAULT_SETTINGS: Readonly<AgentSettings> = {
  buyChecks: true,
  payCardano: true,
  payCashxchain: true,
  approval: "ask",
  autoMaxTada: 5,
  autoMaxFiat: 500,
};

const KEY = "cxc-agent-settings";
const listeners = new Set<(settings: AgentSettings) => void>();
let current: AgentSettings = load();

function load(): AgentSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof AgentSettings, unknown>>;
    const pick = <K extends keyof AgentSettings>(key: K, ok: (v: unknown) => boolean): AgentSettings[K] =>
      (ok(saved[key]) ? saved[key] : DEFAULT_SETTINGS[key]) as AgentSettings[K];
    const bool = (v: unknown) => typeof v === "boolean";
    const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    return {
      buyChecks: pick("buyChecks", bool),
      payCardano: pick("payCardano", bool),
      payCashxchain: pick("payCashxchain", bool),
      approval: pick("approval", v => v === "ask" || v === "auto"),
      autoMaxTada: pick("autoMaxTada", amount),
      autoMaxFiat: pick("autoMaxFiat", amount),
    };
  } catch {
    return { ...DEFAULT_SETTINGS }; // storage blocked or corrupt
  }
}

export const getSettings = (): AgentSettings => current;

export function saveSettings(next: AgentSettings): void {
  current = { ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage blocked: the settings last for this page view
  }
  for (const listener of listeners) listener(current);
}

/** Called on every change; returns an unsubscribe function. */
export function onSettings(listener: (settings: AgentSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
