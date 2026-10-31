import { randomUUID } from "node:crypto";
import type { PayoutRouteKind } from "./payout.js";
import type { Invoice, PaymentDraft, PaymentProof, ReadinessReport } from "./types.js";

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
  // After human approval of a DRAFT_READY run:
  | "PAYING_OUT"
  | "PAID_OUT"
  | "PAYOUT_FAILED" // nothing was sent; can be approved again
  | "PAYOUT_UNKNOWN"; // may have been sent; invoice locked until a human checks the reference

export interface PayoutRecord {
  route: PayoutRouteKind;
  status: "pending" | "settled" | "submitted" | "refused" | "unknown";
  vendorId: string;
  payee: string;
  amountMinor: number;
  currency: string;
  approvedAt: string;
  reference?: string;
  explorerUrl?: string;
  simulated?: boolean;
  completedAt?: string;
  reason?: string;
}

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
