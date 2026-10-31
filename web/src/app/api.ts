import type { Run, RunState } from "../../../src/runs.js";
import type { PayoutResult, RouteDecision } from "../../../src/types.js";

export type { Run, RunState };

/** GET /api/health (src/server.ts). Lovelace amounts are decimal strings. */
export interface Health {
  status: "ok";
  network: string;
  x402Ready: boolean;
  aiReady: boolean;
  facilitator: string;
  buyerAddress?: string;
  sellerAddress?: string;
  priceLovelace: string;
  maxPriceLovelace: string;
  sessionBudgetLovelace: string;
  spentLovelace: string;
  supplierCardanoAddress?: string;
  payoutMaxLovelace: string;
  payoutBudgetLovelace: string;
  paidOutLovelace: string;
}

/** One GET /api/runs item (src/server.ts), newest first. The input text stays behind /api/runs/:id. */
export interface RunSummary {
  id: string;
  state: RunState;
  createdAt: string;
  supplier?: string;
  invoiceId?: string;
  amountMinor?: number;
  currency?: string;
  transactionHash?: string;
  rail?: RouteDecision["rail"];
  payoutStatus?: PayoutResult["status"];
}

export type Decision = "approve" | "reject";
type Accepted = { id: string; state: RunState };
export type PostResult = { ok: true; data: Accepted } | { ok: false; error: string; status: number };

const getJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;

/** Empty when the agent is unreachable; the page then shows "Offline". */
export const getHealth = (): Promise<Partial<Health>> => getJson<Partial<Health>>("/api/health");
export const getSamples = (): Promise<Record<string, string>> => getJson<Record<string, string>>("/api/samples");
export const listRuns = (): Promise<RunSummary[]> => getJson<RunSummary[]>("/api/runs");

/** Throws when the agent is unreachable; undefined for a 404 or anything that is not a run. */
export async function getRun(id: string): Promise<Run | undefined> {
  const run = await getJson<Partial<Run> | null>(`/api/runs/${encodeURIComponent(id)}`);
  return run?.timeline ? (run as Run) : undefined;
}

async function post(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<PostResult> {
  const init: RequestInit = body === undefined
    ? { method: "POST", headers }
    : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Partial<Accepted> & { error?: string };
  if (!res.ok || !data.id) return { ok: false, error: data.error || `HTTP ${res.status}`, status: res.status };
  return { ok: true, data: data as Accepted };
}

export const createRun = (input: string): Promise<PostResult> => post("/api/runs", { input });
/**
 * Needs the operator token (401 without or with a wrong one; 503 when the server has none).
 * 409 when the run is no longer awaiting approval or the draft cannot execute.
 */
export const decide = (id: string, decision: Decision, operatorToken: string): Promise<PostResult> =>
  post(`/api/runs/${encodeURIComponent(id)}/${decision}`, undefined, { authorization: `Bearer ${operatorToken}` });
