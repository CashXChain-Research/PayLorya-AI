import { randomUUID } from "node:crypto";
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
  /** Set on SETTLEMENT_UNKNOWN: what to look up on the explorer before anyone pays again. */
  settlement?: { transactionHash?: string; explorerUrl?: string; reason: string };
  error?: string;
  timeline: Array<{ state: RunState; at: string; note?: string }>;
}

export const DEFAULT_MAX_RUNS = 500;

// Eviction allowlists; any other state (CREATED, EXTRACTED, PRECHECKED, PAYING, PAID, EXECUTING, or a
// state added later) is in flight and never evicted. Settled: no async step writes the run again.
const SETTLED: ReadonlySet<RunState> = new Set<RunState>(["NEEDS_INFO", "BLOCKED", "FAILED", "EXECUTED", "REJECTED"]);
// At rest, but a human may still approve the draft or must reconcile a tx: evicted only after every settled run.
const PARKED: ReadonlySet<RunState> = new Set<RunState>(["DRAFT_READY", "SETTLEMENT_UNKNOWN", "PAYOUT_UNKNOWN"]);

// In-memory on purpose (hackathon). One process / one container instance only.
// Capped at maxRuns: a new run evicts the oldest settled run, then the oldest parked one.
export class RunStore {
  private runs = new Map<string, Run>();

  constructor(readonly maxRuns = DEFAULT_MAX_RUNS) {}

  get size(): number {
    return this.runs.size;
  }

  /** Undefined when the store is full and every run in it is in flight. */
  tryCreate(input: string): Run | undefined {
    while (this.runs.size >= this.maxRuns) if (!this.evictOldest()) return undefined;
    const now = new Date().toISOString();
    const run: Run = { id: randomUUID(), state: "CREATED", createdAt: now, input, timeline: [{ state: "CREATED", at: now }] };
    this.runs.set(run.id, run);
    return run;
  }

  create(input: string): Run {
    const run = this.tryCreate(input);
    if (!run) throw new Error(`run store full: ${this.maxRuns} runs in flight`);
    return run;
  }

  /** Map order is insertion order, so the first match is the oldest. */
  private evictOldest(): boolean {
    for (const tier of [SETTLED, PARKED]) {
      for (const run of this.runs.values()) {
        if (tier.has(run.state)) return this.runs.delete(run.id);
      }
    }
    return false;
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
