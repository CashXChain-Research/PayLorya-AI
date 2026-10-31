import { esc } from "../shared/dom.js";
import { decide, type Decision, type PostResult } from "./api.js";
import { health } from "./health.js";
import { toast } from "./ui.js";

// Kept per tab only; the server checks it on every approve/reject.
const KEY = "cxc-operator-token";

export function storedToken(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

function storeToken(token: string | undefined): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: asked again next time
  }
}

/** The server wants the operator token on approve/reject (either server variant). */
export const tokenRequired = (): boolean => health.approvalTokenRequired === true || health.approvals === "operator-token";
/** The server has approvals switched off (no operator token configured). */
export const approvalsDisabled = (): boolean => health.approvals === "disabled";
/** True when the server wants a token and this tab has none yet (auto-approve then waits). */
export const tokenMissing = (): boolean => tokenRequired() && !storedToken();

/** Calm modal asking for the operator token. Resolves undefined on cancel. */
export function askOperatorToken(reason = "This deployment asks for the operator token before any approval."): Promise<string | undefined> {
  const dialog = document.createElement("dialog");
  dialog.className = "token-dialog";
  dialog.innerHTML = `<form method="dialog">
      <h2>Operator token</h2>
      <p>${esc(reason)} It stays in this tab only.</p>
      <input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="Token" aria-label="Operator token" required>
      <div class="actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Continue</button></div>
    </form>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const token = dialog.returnValue === "ok" ? dialog.querySelector("input")!.value.trim() : "";
      dialog.remove();
      resolve(token || undefined);
    });
    dialog.showModal();
  });
}

const changes = new Set<(id?: string) => void>();
/** Called after an approve or reject went through and when a payout settles (balances, budgets). */
export function onPaymentChange(listener: (id?: string) => void): void {
  changes.add(listener);
}
export function emitPaymentChange(id?: string): void {
  for (const listener of changes) listener(id);
}

/** Asks for the token now (e.g. to let auto-approve run) and keeps it for this tab. */
export async function ensureOperatorToken(): Promise<boolean> {
  if (storedToken()) return true;
  const token = await askOperatorToken("Auto-approve needs the operator token of this deployment.");
  if (token) storeToken(token);
  return Boolean(token);
}

/**
 * Approve or reject with the operator token when the server requires one. Interactive calls ask
 * for it once per tab; background calls (auto-approve) never prompt. A 401 forgets the token.
 */
export async function decideRun(id: string, decision: Decision, opts: { interactive?: boolean } = {}): Promise<PostResult> {
  const interactive = opts.interactive ?? true;
  if (approvalsDisabled()) return { ok: false, error: "Approvals are switched off on this server", status: 503 };
  let token = storedToken();
  let asked = false;
  if (tokenRequired() && !token) {
    if (!interactive) return { ok: false, error: "operator token needed", status: 401 };
    token = await askOperatorToken();
    asked = true;
    if (!token) return { ok: false, error: "Cancelled. Nothing was approved.", status: 0 };
    storeToken(token);
  }
  let result = await decide(id, decision, token);
  // Health may be stale: a 401 without a token yet asks once and retries.
  if (!result.ok && result.status === 401 && interactive && !token && !asked) {
    token = await askOperatorToken();
    if (!token) return { ok: false, error: "Cancelled. Nothing was approved.", status: 0 };
    storeToken(token);
    asked = true;
    result = await decide(id, decision, token);
  }
  if (!result.ok && result.status === 401) {
    storeToken(undefined);
    if (interactive) toast(`Wrong operator token. Nothing was ${decision === "approve" ? "approved" : "rejected"}; try again.`);
  }
  if (result.ok) emitPaymentChange(id);
  return result;
}

/**
 * Another operator-only call (e.g. PUT /api/budget): sends the stored token, asks for one when this
 * tab has none, and asks once more after a 401 before retrying. status 0: the dialog was cancelled.
 */
export async function withOperatorToken<T extends { ok: boolean; status?: number }>(
  reason: string,
  request: (token: string) => Promise<T>,
): Promise<T | { ok: false; error: string; status: 0 }> {
  const cancelled = { ok: false as const, error: "Cancelled. Nothing was changed.", status: 0 as const };
  let token = storedToken();
  let asked = false;
  if (!token) {
    token = await askOperatorToken(reason);
    asked = true;
    if (!token) return cancelled;
    storeToken(token);
  }
  let result = await request(token);
  if (!result.ok && result.status === 401) {
    storeToken(undefined);
    if (asked) return result;
    token = await askOperatorToken(`The stored operator token was not accepted. ${reason}`);
    if (!token) return cancelled;
    storeToken(token);
    result = await request(token);
    if (!result.ok && result.status === 401) storeToken(undefined);
  }
  return result;
}
