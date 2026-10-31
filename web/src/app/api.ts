import type { Balances, BudgetState, BudgetUpdate, ChatAction, ChatRequest, ChatResponse, PaymentPreview } from "../../../src/contracts.js";
import type { Run, RunState } from "../../../src/runs.js";
import type { PayoutResult, RouteDecision } from "../../../src/types.js";

export type { Balances, BudgetState, BudgetUpdate, ChatAction, ChatRequest, ChatResponse, PaymentPreview, Run, RunState };

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
  /** Fiat payouts hold no wallet budget: capped per payout (minor units) and per server session. */
  fiatPayoutMaxMinor?: number;
  fiatPayoutsPerSession?: number;
  fiatPayoutsUsed?: number;
  /** True when approve/reject need the operator token (Authorization: Bearer). */
  approvalTokenRequired?: boolean;
  /** Same, from the OPERATOR_TOKEN variant (PR #19): "disabled" means approve/reject answer 503. */
  approvals?: "operator-token" | "disabled";
  cashxchain?: { ready: boolean; environment: string; api: string };
  /** POST /api/chat answers with a model; false or missing: the Assistant uses its rules. */
  chatReady?: boolean;
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
export type PostResult = { ok: true; data: Accepted } | { ok: false; error: string; status?: number };

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
/** 409 when the run is no longer awaiting approval or the draft cannot execute. */
/** Call through decideRun() in approval.ts, which handles the operator token. */
export const decide = (id: string, decision: Decision, operatorToken?: string): Promise<PostResult> =>
  post(`/api/runs/${encodeURIComponent(id)}/${decision}`, undefined, operatorToken ? { authorization: `Bearer ${operatorToken}` } : {});

/** JSON call that never throws for an HTTP error; status 0 means the agent was unreachable. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; retryAfterSec?: number };

async function call<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: "Could not reach the agent", status: 0 };
  }
  const data = (await res.json().catch(() => undefined)) as (T & { error?: string; retryAfterSec?: number }) | undefined;
  if (res.ok && data !== undefined) return { ok: true, data };
  const retry = data?.retryAfterSec ?? Number(res.headers.get("retry-after"));
  return { ok: false, error: data?.error || `HTTP ${res.status}`, status: res.status, ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}) };
}

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit =>
  ({ method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the human sees before confirming a payout. Moves nothing. */
export const getPreview = (id: string): Promise<ApiResult<PaymentPreview>> => call(`/api/runs/${encodeURIComponent(id)}/preview`);
export const getBalances = (): Promise<ApiResult<Balances>> => call("/api/balances");
export const getBudget = (): Promise<ApiResult<BudgetState>> => call("/api/budget");
/** Needs the operator token; 400 names the invalid value. Call through saveBudget() in settings/limits.ts. */
export const putBudget = (update: BudgetUpdate, operatorToken?: string): Promise<ApiResult<BudgetState>> =>
  call("/api/budget", json("PUT", update, operatorToken ? { authorization: `Bearer ${operatorToken}` } : {}));
/** 503: no model on the server (use the rules); 429: wait retryAfterSec. */
export const postChat = (body: ChatRequest): Promise<ApiResult<ChatResponse>> => call("/api/chat", json("POST", body));
