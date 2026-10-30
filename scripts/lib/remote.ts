// Drives a running instance (the laptop or the Cloudflare deployment) over its own public endpoints, so
// this side needs no Blockfrost or Anthropic key. Shared by scripts/remote-check.ts, remote-run.ts and
// safety-scenarios.ts. Evidence built here is public by design: whitelisted fields only.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Run, RunState } from "../../src/runs.js";
import { describeError, excerpt, type Check } from "./milestone.js";

export class UsageError extends Error {}
export class RemoteError extends Error {}
/** The server no longer knows the run: in-memory state was lost (container restart or redeploy). */
export class RunNotFoundError extends RemoteError {}

export type TimelineEntry = Run["timeline"][number];

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set<RunState>(["DRAFT_READY", "NEEDS_INFO", "BLOCKED", "FAILED", "SETTLEMENT_UNKNOWN"]);
export const EXPLORER_HOME = "https://preprod.cardanoscan.io";
export const EVIDENCE_DIR = fileURLToPath(new URL("../../evidence/", import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- CLI ---------------------------------------------------------------------------------------

/** `--url <base>`, else PUBLIC_BASE_URL; trailing slashes dropped. */
export function resolveTarget(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const raw = (url ?? env.PUBLIC_BASE_URL ?? "").trim();
  if (raw === "") throw new UsageError("no target: pass --url <base> or set PUBLIC_BASE_URL (e.g. https://cxc-agentpay.<subdomain>.workers.dev)");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(`target ${raw} is not a URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new UsageError(`target ${raw} is not an http(s) URL`);
  if (parsed.search !== "" || parsed.hash !== "") throw new UsageError(`target ${raw} must be a base URL without query or fragment`);
  return raw.replace(/\/+$/, "");
}

const OPTIONS = {
  url: { type: "string" },
  yes: { type: "boolean" },
  sample: { type: "string" },
  file: { type: "string" },
} as const;
export type Flag = Exclude<keyof typeof OPTIONS, "url">;

export interface RemoteArgs {
  baseUrl: string;
  yes: boolean;
  sample?: string;
  file?: string;
}

const parseStrict = (args: string[]) => parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: false });

/** Strict: an unknown or misspelled option (e.g. `--yess`) is an error, never silently ignored. */
export function parseRemoteArgs(argv: string[], accepted: Flag[], env: NodeJS.ProcessEnv = process.env): RemoteArgs {
  let values: ReturnType<typeof parseStrict>["values"];
  try {
    values = parseStrict(argv).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  for (const flag of ["yes", "sample", "file"] as const) {
    if (values[flag] !== undefined && !accepted.includes(flag)) throw new UsageError(`--${flag} is not an option of this command`);
  }
  if (values.sample !== undefined && values.file !== undefined) throw new UsageError("pass either --sample or --file, not both");
  return { baseUrl: resolveTarget(values.url, env), yes: values.yes === true, sample: values.sample, file: values.file };
}

/** True when this module is the script tsx was started with (not imported by a test). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/** Same line format as scripts/preflight.ts. */
export function formatLine(status: Check["status"] | "SKIP", name: string, detail: string, hint?: string): string {
  return `${status}  ${name.padEnd(17)}${detail}${hint ? `  -> ${hint}` : ""}`;
}

export const formatCheck = (check: Check): string => formatLine(check.status, check.name, check.detail, check.hint);

/** One timeline entry with the server-side time since the run was created. */
export function formatTransition(entry: TimelineEntry, createdAt: string): string {
  const ms = Date.parse(entry.at) - Date.parse(createdAt);
  const elapsed = Number.isFinite(ms) ? `+${(ms / 1000).toFixed(1)}s` : "+?";
  return `  ${elapsed.padStart(8)}  ${entry.state.padEnd(19)}${entry.note ?? ""}`.trimEnd();
}

// --- HTTP --------------------------------------------------------------------------------------

export interface Fetched {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

/** fetch with a deadline that also covers reading the body. Throws on network errors and timeouts. */
export async function request(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Fetched> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

const Lovelace = z.string().regex(/^\d+$/);
// GET /api/health in src/server.ts. Unknown keys are stripped; the optional limits come from newer servers.
const HealthSchema = z.object({
  status: z.string(),
  network: z.string(),
  x402Ready: z.boolean(),
  aiReady: z.boolean(),
  facilitator: z.string(),
  buyerAddress: z.string().optional(),
  sellerAddress: z.string().optional(),
  priceLovelace: Lovelace,
  spentLovelace: Lovelace,
  maxPriceLovelace: Lovelace.optional().catch(undefined),
  sessionBudgetLovelace: Lovelace.optional().catch(undefined),
});
export type Health = z.infer<typeof HealthSchema>;

// A cold container start after a deploy can take a while.
export async function getHealth(baseUrl: string, timeoutMs = 30_000): Promise<Health> {
  let res: Fetched;
  try {
    res = await request(`${baseUrl}/api/health`, {}, timeoutMs);
  } catch (error) {
    throw new RemoteError(`GET ${baseUrl}/api/health failed: ${describeError(error)}`);
  }
  if (res.status !== 200) throw new RemoteError(`GET /api/health -> HTTP ${res.status}: ${excerpt(res.text)}`);
  const parsed = HealthSchema.safeParse(res.json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(i => i.path.join(".") || "body"))].join(", ");
    throw new RemoteError(`GET /api/health returned an unexpected body (${fields}): ${excerpt(res.text)}`);
  }
  return parsed.data;
}

export async function getSamples(baseUrl: string): Promise<Record<string, string>> {
  let res: Fetched;
  try {
    res = await request(`${baseUrl}/api/samples`);
  } catch (error) {
    throw new RemoteError(`GET /api/samples failed: ${describeError(error)}`);
  }
  if (res.status !== 200 || !isRecord(res.json)) throw new RemoteError(`GET /api/samples -> HTTP ${res.status}: ${excerpt(res.text)}`);
  return Object.fromEntries(Object.entries(res.json).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** POST /api/runs. The server answers 202 before it extracts or pays anything. */
export async function startRun(baseUrl: string, input: string): Promise<string> {
  let res: Fetched;
  try {
    res = await request(
      `${baseUrl}/api/runs`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) },
      30_000,
    );
  } catch (error) {
    throw new RemoteError(`POST /api/runs failed: ${describeError(error)} (if the server received it, a run may still be in progress)`);
  }
  const id = isRecord(res.json) ? res.json.id : undefined;
  if (res.status !== 202 || typeof id !== "string") throw new RemoteError(`POST /api/runs -> HTTP ${res.status}: ${excerpt(res.text)}`);
  return id;
}

function isRun(value: unknown): value is Run {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.state === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.timeline) &&
    value.timeline.every(e => isRecord(e) && typeof e.state === "string" && typeof e.at === "string")
  );
}

export async function getRun(baseUrl: string, id: string, timeoutMs = 15_000): Promise<Run> {
  const path = `/api/runs/${encodeURIComponent(id)}`;
  let res: Fetched;
  try {
    res = await request(`${baseUrl}${path}`, {}, timeoutMs);
  } catch (error) {
    throw new RemoteError(`GET ${path} failed: ${describeError(error)}`);
  }
  if (res.status === 404) throw new RunNotFoundError(`run ${id} not found (HTTP 404): the server lost its in-memory runs (container restart or redeploy?)`);
  if (res.status !== 200 || !isRun(res.json)) throw new RemoteError(`GET ${path} -> HTTP ${res.status}: ${excerpt(res.text)}`);
  return res.json;
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  onTransition?: (entry: TimelineEntry, run: Run) => void;
}

export interface PollResult {
  /** Last state seen; undefined if no poll ever succeeded. */
  run: Run | undefined;
  timedOut: boolean;
  lastError?: string;
}

/**
 * Polls until a terminal state or the deadline. Transient errors are retried until the deadline; a 404
 * throws RunNotFoundError, because then the payment state can only be read from the chain.
 */
export async function pollRun(baseUrl: string, id: string, opts: PollOptions): Promise<PollResult> {
  const deadline = Date.now() + opts.timeoutMs;
  let run: Run | undefined;
  let lastError: string | undefined;
  let seen = 0;
  for (;;) {
    try {
      run = await getRun(baseUrl, id);
      lastError = undefined;
      for (const entry of run.timeline.slice(seen)) opts.onTransition?.(entry, run);
      seen = run.timeline.length;
      if (TERMINAL_STATES.has(run.state)) return { run, timedOut: false };
    } catch (error) {
      if (error instanceof RunNotFoundError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    const left = deadline - Date.now();
    if (left <= 0) return { run, timedOut: true, lastError };
    await sleep(Math.min(opts.intervalMs ?? 2_000, left));
  }
}

// --- public evidence ---------------------------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Ties evidence to the posted input without publishing it. */
export function inputDigest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Field-by-field copy of a run's public parts, so a field added to Run later never leaks by accident.
 * `input` is never copied: with --file it can be a real invoice, or anything someone pasted.
 * Report checks are reduced to id/status/source: their messages may quote invoice data.
 */
export function publicRun(run: Run) {
  const { payment, report, draft, settlement } = run as Partial<Record<"payment" | "report" | "draft" | "settlement", unknown>>;
  return {
    runId: str(run.id),
    state: str(run.state),
    createdAt: str(run.createdAt),
    invoiceId: (isRecord(run.invoice) ? str(run.invoice.id) : undefined) ?? null,
    timeline: (Array.isArray(run.timeline) ? run.timeline : []).filter(isRecord).map(e => ({
      state: str(e.state),
      at: str(e.at),
      note: str(e.note),
    })),
    payment: isRecord(payment)
      ? {
          network: str(payment.network),
          buyerAddress: str(payment.buyerAddress),
          sellerAddress: str(payment.sellerAddress),
          asset: str(payment.asset),
          amount: str(payment.amount),
          transactionHash: str(payment.transactionHash),
          explorerUrl: str(payment.explorerUrl),
          settledAt: str(payment.settledAt),
        }
      : null,
    report: isRecord(report)
      ? {
          verdict: str(report.verdict),
          payoutExecuted: bool(report.payoutExecuted),
          checks: (Array.isArray(report.checks) ? report.checks : []).filter(isRecord).map(c => ({
            id: str(c.id),
            status: str(c.status),
            source: str(c.source),
          })),
        }
      : null,
    draft: isRecord(draft) ? { status: str(draft.status), executable: bool(draft.executable) } : null,
    settlement: isRecord(settlement)
      ? { transactionHash: str(settlement.transactionHash), explorerUrl: str(settlement.explorerUrl), reason: str(settlement.reason) }
      : null,
    error: str(run.error) ?? null,
  };
}
export type RunRecord = ReturnType<typeof publicRun>;

export function publicHealth(health: Health) {
  return {
    network: health.network,
    facilitator: health.facilitator,
    sellerAddress: health.sellerAddress ?? null,
    buyerAddress: health.buyerAddress ?? null,
    priceLovelace: health.priceLovelace,
    ...(health.maxPriceLovelace !== undefined ? { maxPriceLovelace: health.maxPriceLovelace } : {}),
    ...(health.sessionBudgetLovelace !== undefined ? { sessionBudgetLovelace: health.sessionBudgetLovelace } : {}),
  };
}

/** Milliseconds from run creation to the first PAID entry and to the last entry, by the server's clock. */
export function serverTimings(run: Run): { paid: number | null; final: number | null } {
  const created = Date.parse(run.createdAt);
  const since = (at: string | undefined) => {
    const ms = at === undefined ? NaN : Date.parse(at) - created;
    return Number.isFinite(ms) ? ms : null;
  };
  return { paid: since(run.timeline.find(e => e.state === "PAID")?.at), final: since(run.timeline.at(-1)?.at) };
}

export interface RunEvidenceInput {
  target: string;
  run: Run;
  health: Health;
  input: { source: string; text: string };
  spentBefore: string;
  spentAfter: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export function buildRunEvidence(e: RunEvidenceInput) {
  return {
    kind: "live-run",
    target: e.target,
    ...publicRun(e.run),
    input: { source: e.input.source, sha256: inputDigest(e.input.text) },
    health: { ...publicHealth(e.health), spentLovelaceBefore: e.spentBefore, spentLovelaceAfter: e.spentAfter },
    timingsMs: { ...serverTimings(e.run), wallClock: e.finishedAt.getTime() - e.startedAt.getTime() },
    startedAt: e.startedAt.toISOString(),
    finishedAt: e.finishedAt.toISOString(),
  };
}

export const fileStamp = (date: Date): string => date.toISOString().replace(/[:.]/g, "-");

export async function writeEvidence(dir: string, name: string, evidence: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
  return file;
}
