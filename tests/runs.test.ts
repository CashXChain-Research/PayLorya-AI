import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_RUNS, RunStore, type Run, type RunState } from "../src/runs.js";

// Every state, classified. A new RunState fails typecheck here until someone decides whether it may be evicted.
const CLASS: Record<RunState, "settled" | "parked" | "in-flight"> = {
  CREATED: "in-flight",
  EXTRACTED: "in-flight",
  PRECHECKED: "in-flight",
  PAYING: "in-flight",
  PAID: "in-flight",
  EXECUTING: "in-flight",
  DRAFT_READY: "parked",
  SETTLEMENT_UNKNOWN: "parked",
  PAYOUT_UNKNOWN: "parked",
  NEEDS_INFO: "settled",
  BLOCKED: "settled",
  FAILED: "settled",
  EXECUTED: "settled",
  REJECTED: "settled",
};
const STATES = Object.keys(CLASS) as RunState[];
const inFlight = STATES.filter(s => CLASS[s] === "in-flight");

function fill(store: RunStore, states: RunState[]): Run[] {
  return states.map((state, i) => {
    const run = store.create(`run ${i}`);
    if (state !== "CREATED") store.transition(run, state);
    return run;
  });
}

const ids = (store: RunStore) => store.list().map(r => r.input).reverse();

describe("RunStore cap", () => {
  it("defaults to 500 runs", () => {
    expect(DEFAULT_MAX_RUNS).toBe(500);
    expect(new RunStore().maxRuns).toBe(500);
  });

  it("never grows past maxRuns", () => {
    const store = new RunStore(5);
    for (let i = 0; i < 50; i++) store.transition(store.create(`run ${i}`), "FAILED");
    expect(store.size).toBe(5);
    expect(ids(store)).toEqual(["run 45", "run 46", "run 47", "run 48", "run 49"]);
  });

  it.each(STATES)("evicts a lone %s run only if it is not in flight", state => {
    const store = new RunStore(1);
    const [old] = fill(store, [state]);
    const next = store.tryCreate("next");
    if (CLASS[state] === "in-flight") {
      expect(next).toBeUndefined();
      expect(store.get(old!.id)).toBe(old);
    } else {
      expect(next).toBeDefined();
      expect(store.get(old!.id)).toBeUndefined();
    }
    expect(store.size).toBe(1);
  });

  it("evicts the oldest settled run first, even when parked and in-flight runs are older", () => {
    const store = new RunStore(5);
    fill(store, ["PAYING", "DRAFT_READY", "FAILED", "EXECUTING", "NEEDS_INFO"]);
    store.create("run 5");
    expect(ids(store)).toEqual(["run 0", "run 1", "run 3", "run 4", "run 5"]);
    store.create("run 6");
    expect(ids(store)).toEqual(["run 0", "run 1", "run 3", "run 5", "run 6"]);
  });

  it("evicts the oldest parked run only when no settled run is left", () => {
    const store = new RunStore(4);
    fill(store, ["PAID", "SETTLEMENT_UNKNOWN", "DRAFT_READY", "PRECHECKED"]);
    store.create("run 4");
    expect(ids(store)).toEqual(["run 0", "run 2", "run 3", "run 4"]);
  });

  it("refuses a new run when every stored run is in flight, and keeps them all", () => {
    const store = new RunStore(inFlight.length);
    const runs = fill(store, inFlight);
    expect(store.tryCreate("one more")).toBeUndefined();
    expect(() => store.create("one more")).toThrow(/run store full/);
    expect(store.size).toBe(inFlight.length);
    for (const run of runs) expect(store.get(run.id)).toBe(run);
  });

  it("makes room again once an in-flight run settles", () => {
    const store = new RunStore(2);
    const [a] = fill(store, ["PAYING", "EXECUTING"]);
    expect(store.tryCreate("blocked")).toBeUndefined();
    store.transition(a!, "DRAFT_READY");
    expect(store.tryCreate("now")).toBeDefined();
    expect(store.get(a!.id)).toBeUndefined();
  });
});
