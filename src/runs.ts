import { randomUUID } from "node:crypto";
import type { Invoice, PaymentDraft, PaymentProof, PayoutRecord, ReadinessReport } from "./types.js";

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
  // After DRAFT_READY, only through human approval (CashXChain sandbox payout).
  | "REJECTED"
  | "PAYOUT_SENDING"
  | "PAYOUT_IN_FLIGHT"
  | "PAYOUT_SETTLED"
  | "PAYOUT_FAILED"
  | "PAYOUT_UNKNOWN";

export interface Run {
  id: string;
  state: RunState;
  createdAt: string;
  input: string;
  invoice?: Invoice;
  fingerprint?: string;
  report?: ReadinessReport;
  payment?: PaymentProof;
  draft?: PaymentDraft;
  /** The CashXChain sandbox payout, once a human approved the draft. */
  payout?: PayoutRecord;
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
