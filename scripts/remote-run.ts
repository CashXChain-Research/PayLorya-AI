// One agent run on a running instance via POST /api/runs, polled to a terminal state (AT3 on the live URL).
// The SERVER's buyer wallet pays about PRICE_LOVELACE plus fee, so it needs --yes; without it, a dry run.
//   npm run remote:run -- --url <base> [--sample <key> | --file <path>] [--yes]
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { CARDANO_NETWORK } from "../src/config.js";
import { InvoiceSchema, type Invoice } from "../src/types.js";
import { describeError, formatAda } from "./lib/milestone.js";
import {
  buildRunEvidence,
  EVIDENCE_DIR,
  EXPLORER_HOME,
  fileStamp,
  formatTransition,
  getHealth,
  getSamples,
  isMain,
  parseRemoteArgs,
  pollRun,
  startRun,
  UsageError,
  writeEvidence,
  type Health,
  type PollResult,
  type RemoteArgs,
} from "./lib/remote.js";

const USAGE = "usage: npm run remote:run -- [--url <base>] [--sample <key> | --file <path>] [--yes]   (default target: PUBLIC_BASE_URL)";
// Payments queue per buyer wallet and settle waits for a confirmation.
export const RUN_TIMEOUT_MS = 8 * 60_000;

/** The smoke invoice with a unique id, so the server's per-invoice lock never refuses it. */
export function liveInvoice(now: Date): Invoice {
  return {
    id: `LIVE-${now.getTime()}`,
    supplier: "Brenner Maschinenbau GmbH",
    destinationCountry: "DE",
    currency: "EUR",
    amountMinor: 1_248_000,
    iban: "DE89370400440532013000",
  };
}

/** Same test as BuyerAgent.extract: structured JSON skips the model. */
export function isStructuredInvoice(text: string): boolean {
  try {
    return InvoiceSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

export interface RunInput {
  text: string;
  /** Goes into the evidence instead of the text itself. */
  source: string;
  label: string;
  structured: boolean;
}

export async function resolveInput(baseUrl: string, opts: { sample?: string; file?: string }, now: Date): Promise<RunInput> {
  if (opts.sample !== undefined) {
    const samples = await getSamples(baseUrl);
    const text = samples[opts.sample];
    if (text === undefined) throw new UsageError(`unknown sample ${opts.sample}; the server has: ${Object.keys(samples).join(", ") || "none"}`);
    return { text, source: `sample:${opts.sample}`, label: `sample ${opts.sample}`, structured: isStructuredInvoice(text) };
  }
  if (opts.file !== undefined) {
    let text: string;
    try {
      text = await readFile(opts.file, "utf8");
    } catch (error) {
      throw new UsageError(`cannot read --file ${opts.file}: ${describeError(error)}`);
    }
    if (text.trim() === "") throw new UsageError(`--file ${opts.file} is empty`);
    return { text, source: `file:${basename(opts.file)}`, label: `file ${opts.file}`, structured: isStructuredInvoice(text) };
  }
  const invoice = liveInvoice(now);
  return { text: JSON.stringify(invoice), source: "default", label: `structured invoice ${invoice.id}`, structured: true };
}

const shellArg = (s: string) => (/^[\w./:@=-]+$/.test(s) ? s : JSON.stringify(s));

export interface RemoteRunOptions extends RemoteArgs {
  log?: (line: string) => void;
  timeoutMs?: number;
  intervalMs?: number;
  evidenceDir?: string;
}

/** Returns the exit code. */
export async function remoteRun(opts: RemoteRunOptions): Promise<number> {
  const log = opts.log ?? console.log;
  const { baseUrl } = opts;
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  const startedAt = new Date();
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

  let health: Health;
  let input: RunInput;
  try {
    health = await getHealth(baseUrl);
    input = await resolveInput(baseUrl, opts, startedAt);
  } catch (error) {
    log(`FAILED: ${errorText(error)}`);
    return 1;
  }
  const price = BigInt(health.priceLovelace);
  const budget = health.sessionBudgetLovelace !== undefined ? ` of ${formatAda(BigInt(health.sessionBudgetLovelace))} session budget` : "";
  const buyer = health.buyerAddress ?? "<none>";
  log(`target      ${baseUrl}`);
  log(`network     ${health.network}`);
  log(`price       ${formatAda(price)} per paid call plus the network fee, paid from the SERVER's buyer wallet`);
  log(`buyer       ${buyer}`);
  log(`seller      ${health.sellerAddress ?? "<none>"}`);
  log(`facilitator ${health.facilitator}`);
  log(`spent       ${formatAda(BigInt(health.spentLovelace))} so far${budget}`);
  log(`input       ${input.label}${input.structured ? " (structured JSON, no model call)" : " (free text, extracted by Claude on the server)"}`);

  const blockers: string[] = [];
  if (!health.x402Ready) blockers.push("the server reports x402Ready=false and cannot pay: npm run remote:check explains");
  if (health.network !== CARDANO_NETWORK) blockers.push(`the server reports network ${health.network}, expected ${CARDANO_NETWORK}`);
  if (!input.structured && !health.aiReady) {
    blockers.push("free-text input needs ANTHROPIC_API_KEY on the server (aiReady=false); the default structured invoice works without it");
  }
  if (blockers.length > 0) {
    log(`\nFAILED: ${blockers.join("\n  ")}`);
    return 1;
  }
  if (!opts.yes) {
    const flags = `${opts.sample !== undefined ? ` --sample ${shellArg(opts.sample)}` : ""}${opts.file !== undefined ? ` --file ${shellArg(opts.file)}` : ""}`;
    log(`\ndry run, nothing started. With --yes this starts one agent run that pays about ${formatAda(price)} plus fee to the seller.`);
    log(`  npm run remote:run -- --url ${baseUrl}${flags} --yes`);
    return 0;
  }

  let id: string;
  try {
    id = await startRun(baseUrl, input.text);
  } catch (error) {
    log(`\nFAILED: ${errorText(error)}`);
    return 1;
  }
  const runUrl = `${baseUrl}/api/runs/${id}`;
  log(`\nrun ${id} started, polling ${runUrl} for up to ${Math.round(timeoutMs / 60_000)} min`);

  let result: PollResult;
  try {
    result = await pollRun(baseUrl, id, {
      timeoutMs,
      intervalMs: opts.intervalMs,
      onTransition: (entry, run) => log(formatTransition(entry, run.createdAt)),
    });
  } catch (error) {
    log(`\nFAILED: ${errorText(error)}`);
    log(`  PAYMENT STATE UNKNOWN if the run had reached PAYING: search the buyer ${buyer} on ${EXPLORER_HOME} before running again.`);
    return 1;
  }
  const finishedAt = new Date();
  const { run } = result;
  let spentAfter: string | null = null;
  try {
    spentAfter = (await getHealth(baseUrl)).spentLovelace;
  } catch {
    spentAfter = null;
  }

  if (run?.payment) {
    const { payment } = run;
    const evidence = buildRunEvidence({
      target: baseUrl,
      run,
      health,
      input,
      spentBefore: health.spentLovelace,
      spentAfter,
      startedAt,
      finishedAt,
    });
    const name = `live-run-${fileStamp(startedAt)}.json`;
    let where: string;
    try {
      where = await writeEvidence(opts.evidenceDir ?? EVIDENCE_DIR, name, evidence);
    } catch (error) {
      where = `<not written: ${describeError(error)}>`;
      log(`WARN could not write ${name}; evidence follows:\n${JSON.stringify(evidence, null, 2)}`);
    }
    const amount = /^\d+$/.test(payment.amount) ? formatAda(BigInt(payment.amount)) : `${payment.amount} lovelace`;
    log(`\nPAID ${amount} on ${payment.network}, ${payment.buyerAddress} -> ${payment.sellerAddress}`);
    log(`  tx       ${payment.transactionHash}`);
    log(`  explorer ${payment.explorerUrl}`);
    log(`  state    ${run.state}${run.report ? `, verdict ${run.report.verdict}` : ""}`);
    log(`  evidence ${where}`);
  }

  if (result.timedOut || !run) {
    log(`\nTIMED OUT after ${Math.round(timeoutMs / 1000)} s in state ${run?.state ?? "<never read>"}${result.lastError ? ` (last error: ${result.lastError})` : ""}`);
    log(`  The run may still complete. Check later: curl -s ${runUrl}`);
    log("  Do not start another paid run until this one has finished.");
    return 1;
  }
  if (run.state === "SETTLEMENT_UNKNOWN") {
    const s = run.settlement;
    log(`\nSETTLEMENT UNKNOWN: ${s?.reason ?? run.error ?? "no reason given"}`);
    if (s?.transactionHash) log(`  tx       ${s.transactionHash}`);
    if (s?.explorerUrl) log(`  explorer ${s.explorerUrl}`);
    log("  !!! The transaction may already be on-chain. Do NOT re-run: check the explorer first.");
    log(`  !!! The server has locked this invoice and counts the amount against its budget; a new invoice would pay again.`);
    if (!s?.transactionHash) log(`  !!! No tx hash known: search the buyer ${buyer} on ${EXPLORER_HOME}.`);
    return 1;
  }
  if (run.payment && run.state === "DRAFT_READY") {
    log(`\nDRAFT_READY with a real tx: ${run.draft?.status ?? "draft"}, executable ${String(run.draft?.executable)}`);
    return 0;
  }
  if (run.payment && (run.state === "NEEDS_INFO" || run.state === "BLOCKED")) {
    log(`\nPaid, but the report verdict is ${run.report?.verdict ?? run.state}: no draft. AT3 needs DRAFT_READY (use the default invoice).`);
    return 0;
  }
  log(`\n${run.state}${run.payment ? " after a payment" : ", nothing paid"}: ${run.error ?? run.timeline.at(-1)?.note ?? "no details"}`);
  return 1;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = await remoteRun(parseRemoteArgs(process.argv.slice(2), ["yes", "sample", "file"]));
  } catch (error) {
    console.error(error instanceof UsageError ? `${error.message}\n${USAGE}` : `\nFAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  }
}
