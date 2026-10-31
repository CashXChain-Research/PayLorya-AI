import { decideRun, storedToken } from "../approval.js";
import { getRun, listRuns, type PostResult, type Run } from "../api.js";
import { loadList } from "../list.js";
import { toast } from "../ui.js";
import { autoLimitText, autoNeedsToken, emitAutoChange, markAttempted, markAutoApproved, setTokenRefused, wasAttempted } from "./auto-state.js";
import { autoApproves } from "./policy.js";
import { getSettings, onSettings } from "./store.js";

export { wasAutoApproved } from "./auto-state.js";

const POLL_MS = 3000;
/** Drafts checked and left alone, with the settings they were checked under (re-checked when those change). */
const skipped = new Map<string, string>();
let busy = false;
let again = false;

/** Approves one draft; false when the server wants the operator token (the draft stays untried). */
async function approve(run: Run): Promise<boolean> {
  const draft = run.draft!;
  const limit = autoLimitText(draft.currency, getSettings());
  const hadToken = Boolean(storedToken());
  markAttempted(run.id);
  markAutoApproved(run.id, true);
  let res: PostResult | undefined;
  try {
    res = await decideRun(run.id, "approve", { interactive: false });
  } catch {
    res = undefined;
  }
  if (res?.ok) {
    setTokenRefused(false);
    toast(`Auto-approved ${draft.invoiceId}: within your ${limit} limit`);
    emitAutoChange(run.id);
    void loadList();
    return true;
  }
  markAutoApproved(run.id, false);
  if (res?.status === 401) {
    // Token missing or wrong (decideRun forgot it): wait for one in Agent settings, then retry.
    markAttempted(run.id, false);
    setTokenRefused(true);
    toast(hadToken ? "Auto-approve paused: the operator token was refused. Enter it again in Agent settings." : "Auto-approve needs the operator token. Enter it in Agent settings.");
    emitAutoChange();
    return false;
  }
  emitAutoChange(run.id);
  // Someone may have decided first; speak up only when the draft still waits.
  const now = await getRun(run.id).catch(() => undefined);
  if (now?.state === "DRAFT_READY") toast(`Could not auto-approve ${draft.invoiceId}: ${res?.error ?? "agent unreachable"}. It waits for you in the Inbox.`);
  return true;
}

async function pass(): Promise<void> {
  if (getSettings().approval !== "auto" || autoNeedsToken()) return;
  const runs = await listRuns().catch(() => undefined);
  if (!Array.isArray(runs)) return;
  for (const summary of runs) {
    if (summary.state !== "DRAFT_READY" || wasAttempted(summary.id)) continue;
    if (skipped.get(summary.id) === JSON.stringify(getSettings())) continue;
    const run = await getRun(summary.id).catch(() => undefined);
    if (!run || wasAttempted(run.id)) continue;
    const settings = getSettings();
    if (!autoApproves(run, settings)) {
      skipped.set(run.id, JSON.stringify(settings));
      continue;
    }
    if (autoNeedsToken() || !(await approve(run))) return;
  }
}

/** One sweep over the waiting drafts; a call during a sweep runs another one after it. */
export async function runAutopilot(): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      await pass();
    } while (again);
  } finally {
    busy = false;
  }
}

/** Approves drafts that autoApproves() allows, while the app is open. Re-checks on every settings change. */
export function startAutopilot(): void {
  onSettings(() => void runAutopilot());
  window.setInterval(() => void runAutopilot(), POLL_MS);
  void runAutopilot();
}
