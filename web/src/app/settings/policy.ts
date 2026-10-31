import type { PayoutRail } from "../../../../src/types.js";
import { majorUnits } from "../../shared/dom.js";
import type { Run } from "../api.js";
import type { AgentSettings } from "./store.js";

/** Why these settings stop an invoice from being sent to the agent, if they do. */
export function sendBlock(settings: AgentSettings): string | undefined {
  return settings.buyChecks ? undefined : "Verification checks are switched off in Agent settings";
}

/** Why these settings stop a payout on this rail, if they do. */
export function railBlock(rail: PayoutRail | undefined, settings: AgentSettings): string | undefined {
  if (rail === "cardano_preprod" && !settings.payCardano) return "Cardano payouts are switched off in Agent settings";
  if (rail === "cxc_fiat" && !settings.payCashxchain) return "CashXChain payouts are switched off in Agent settings";
  return undefined;
}

/** Why these settings stop the approval of this draft, if they do. The server's own checks still apply. */
export const approvalBlock = (run: Run, settings: AgentSettings): string | undefined => railBlock(run.draft?.route.rail, settings);

/**
 * True when this browser should approve the draft without asking: auto mode, payable, rail allowed,
 * amount within the ceiling, and never a draft that was approved once before (a refused payout
 * reopens the draft; a human decides the retry).
 */
export function autoApproves(run: Run, settings: AgentSettings): boolean {
  const draft = run.draft;
  if (settings.approval !== "auto" || run.state !== "DRAFT_READY" || !draft?.executable) return false;
  if (approvalBlock(run, settings) || run.timeline.some(t => t.state === "EXECUTING")) return false;
  const amount = majorUnits(draft.amountMinor, draft.currency);
  return amount <= (draft.currency === "ADA" ? settings.autoMaxTada : settings.autoMaxFiat);
}
