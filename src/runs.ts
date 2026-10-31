import { randomUUID } from "node:crypto";
import type { VerifiedPayee } from "./routing.js";
import type { Invoice, PaymentDraft, PaymentProof, PayoutResult, ReadinessReport, RouteDecision } from "./types.js";

export type RunState =
  | "CREATED"
  | "EXTRACTED"
  | "PRECHECKED"
  | "PAYING"
  | "PAID"
  | "DRAFT_READY"
  | "NEEDS_INFO"
  | "BLOCKED"
  | "SETTLEMENT_UNKNOWN"
  | "FAILED"
  // After DRAFT_READY, only on human approval or rejection:
  | "EXECUTING"
  | "EXECUTED"
  | "PAYOUT_UNKNOWN"
  | "REJECTED";

export interface Run {
  id: string;
  state: RunState;
  createdAt: string;
  input: string;
  invoice?: Invoice;
  fingerprint?: string;
  report?: ReadinessReport;
  payment?: PaymentProof;
  route?: RouteDecision;
  draft?: PaymentDraft;
  /** The invoice payout after approval (status unknown: signed, outcome unclear, invoice locked). */
  payout?: PayoutResult;
  /** Verified payees for this run (an AI CFO workspace's directory); unset: the demo directory. */
  payees?: VerifiedPayee[];
  /** Set on SETTLEMENT_UNKNOWN: what to look up on the explorer before anyone pays again. */
  settlement?: { transactionHash?: string; explorerUrl?: string; reason: string };
  error?: string;
  timeline: Array<{ state: RunState; at: string; note?: string }>;
}

// In-memory on purpose (hackathon). One process / one container instance only.
export class RunStore {
  private runs = new Map<string, Run>();

  create(input: string): Run {
    const now = new Date().toISOString();
    const run: Run = { id: randomUUID(), state: "CREATED", createdAt: now, input, timeline: [{ state: "CREATED", at: now }] };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** Newest first. */
  list(): Run[] {
    return [...this.runs.values()].reverse();
  }

  transition(run: Run, state: RunState, note?: string): void {
    run.state = state;
    run.timeline.push({ state, at: new Date().toISOString(), note });
  }
}
