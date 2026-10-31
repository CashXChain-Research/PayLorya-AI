import { decodeCardanoTransaction, toClientCardanoSigner, type ClientCardanoSigner, type ClientCardanoSignResult } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";
import { extractInvoice } from "./extract.js";
import { blockfrostChainView, blockfrostSubmitter, simulatedCxcPayouts, type ChainSubmitter, type ChainView, type FiatPayoutClient } from "./payout.js";
import { filterOffers, precheck, SpendLedger, type SpendPolicy } from "./policy.js";
import { invoiceFingerprint } from "./readiness.js";
import { decideRoute, findPayee, payeeDirectory, payoutKey, type VerifiedPayee } from "./routing.js";
import type { Run, RunStore } from "./runs.js";
import { READINESS_PATH } from "./seller.js";
import { InvoiceSchema, type Invoice, type PaymentDraft, type PayoutResult, type ReadinessReport, type RouteDecision } from "./types.js";

/** Payout rails and chain access; tests inject stubs. */
export interface PayoutRails {
  submitter?: ChainSubmitter;
  fiat?: FiatPayoutClient;
  chain?: ChainView;
  walletSync?: Partial<typeof WALLET_SYNC>;
}

/**
 * Between two transactions from the buyer wallet: wait until our provider has indexed the previous
 * one, then let other indexers (the hosted facilitator's) catch up for `graceMs` after it settled.
 * Otherwise the next tx can be built on, or checked against, a stale UTxO set and fail after signing.
 */
const WALLET_SYNC = { timeoutMs: 90_000, pollMs: 3_000, graceMs: 30_000 };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Buyer role: the autonomous agent. Claude only extracts fields; every money decision
 * (whether to pay, how much, to whom, how often) is made by the deterministic policy.
 * It pays report fees on its own within limits; an invoice payout needs human approval.
 */
export class BuyerAgent {
  private readonly signer: ClientCardanoSigner;
  private readonly policy: SpendPolicy;
  private readonly ledger: SpendLedger;
  private readonly payoutLedger: SpendLedger;
  private readonly payees: VerifiedPayee[];
  private readonly fiat: FiatPayoutClient;
  private submitter?: ChainSubmitter;
  private chain?: ChainView;
  private readonly walletSync: typeof WALLET_SYNC;
  // Last tx this wallet broadcast (or may have), and when we learned of it.
  private lastTx?: { hash: string; at: number };
  private walletQueue: Promise<void> = Promise.resolve();
  // Fiat payout keys counted against FIAT_PAYOUTS_PER_SESSION (fiat holds no lovelace budget).
  private readonly fiatKeys = new Set<string>();

  constructor(
    private readonly config: Config,
    private readonly runs: RunStore,
    signer?: ClientCardanoSigner, // tests inject a stub; production derives it from BUYER_MNEMONIC
    rails: PayoutRails = {},
  ) {
    if (!(signer || config.BUYER_MNEMONIC) || !config.SELLER_ADDRESS) throw new Error("BUYER_MNEMONIC and SELLER_ADDRESS required");
    this.signer =
      signer ??
      toClientCardanoSigner({
        mnemonic: config.BUYER_MNEMONIC!,
        network: CARDANO_NETWORK,
        provider: blockfrostProvider(config),
      });
    this.policy = {
      allowedPayTo: [config.SELLER_ADDRESS],
      maxPriceLovelace: config.MAX_PRICE_LOVELACE,
      sessionBudgetLovelace: config.SESSION_BUDGET_LOVELACE,
      maxPaymentsPerRun: config.MAX_PAYMENTS_PER_RUN,
    };
    this.ledger = new SpendLedger(this.policy);
    // Separate budget for invoice payouts; fiat payouts hold 0 lovelace but still lock the invoice.
    this.payoutLedger = new SpendLedger(
      { allowedPayTo: [], maxPriceLovelace: config.PAYOUT_MAX_LOVELACE, sessionBudgetLovelace: config.PAYOUT_BUDGET_LOVELACE, maxPaymentsPerRun: 1 },
      "payout",
    );
    this.payees = payeeDirectory(config.SUPPLIER_CARDANO_ADDRESS);
    this.fiat = rails.fiat ?? simulatedCxcPayouts;
    this.submitter = rails.submitter;
    this.chain = rails.chain;
    this.walletSync = { ...WALLET_SYNC, ...rails.walletSync };
  }

  get buyerAddress(): string {
    return this.signer.getAddress();
  }

  get spentLovelace(): bigint {
    return this.ledger.spentLovelace;
  }

  /** Fiat payouts this session that were sent or may have been (the session limit counts these). */
  get fiatPayoutsUsed(): number {
    return this.fiatKeys.size;
  }

  get paidOutLovelace(): bigint {
    return this.payoutLedger.spentLovelace;
  }

  async process(run: Run): Promise<void> {
    try {
      const invoice = await this.extract(run.input);
      run.invoice = invoice;
      run.fingerprint = invoiceFingerprint(invoice);
      this.runs.transition(run, "EXTRACTED");

      const pre = precheck(invoice);
      if (!pre.ok) return this.runs.transition(run, "NEEDS_INFO", pre.reason);
      this.runs.transition(run, "PRECHECKED");

      const report = await this.withWallet(() => this.buyReport(run, invoice));
      if (!report) return;
      run.report = report;

      if (report.verdict === "ready_for_review") {
        run.route = this.route(run, invoice);
        if (run.route.status === "blocked") return this.runs.transition(run, "BLOCKED", run.route.reason);
        run.draft = draftFrom(invoice, report, run.route);
        const ready = run.draft.executable ? "nothing executed" : `not executable: ${run.route.reason}`;
        this.runs.transition(run, "DRAFT_READY", `Awaiting human approval; ${ready}`);
      } else {
        this.runs.transition(run, report.verdict === "blocked" ? "BLOCKED" : "NEEDS_INFO", report.verdict);
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      if (run.state !== "SETTLEMENT_UNKNOWN") this.runs.transition(run, "FAILED", run.error);
    }
  }

  /**
   * Human approval of an executable draft. The state changes synchronously, so a double click
   * cannot start two payouts; `done` settles when the payout has an outcome.
   */
  approve(run: Run): { ok: true; done: Promise<void> } | { ok: false; reason: string } {
    if (run.state !== "DRAFT_READY" || !run.draft) return { ok: false, reason: `run is ${run.state}, not awaiting approval` };
    if (!run.draft.executable) return { ok: false, reason: run.draft.route.reason };
    this.runs.transition(run, "EXECUTING", `Approved: ${run.draft.route.rail}`);
    return { ok: true, done: this.execute(run) };
  }

  reject(run: Run): { ok: true } | { ok: false; reason: string } {
    if (run.state !== "DRAFT_READY") return { ok: false, reason: `run is ${run.state}, not awaiting approval` };
    this.runs.transition(run, "REJECTED", "Rejected by a human; nothing paid");
    return { ok: true };
  }

  /** A run may carry its own verified payee directory (an AI CFO workspace's); else the demo directory. */
  private directory(run: Run): VerifiedPayee[] {
    return run.payees ?? this.payees;
  }

  private route(run: Run, invoice: Invoice): RouteDecision {
    return decideRoute(invoice, this.directory(run), { payoutMaxLovelace: this.config.PAYOUT_MAX_LOVELACE, fiatMaxMinor: this.config.FIAT_PAYOUT_MAX_MINOR });
  }

  private async execute(run: Run): Promise<void> {
    try {
      const invoice = run.invoice!;
      // Re-derive the route at execution time: only the directory decides where money goes.
      const route = this.route(run, invoice);
      if (route.status !== "selected" || route.destination !== run.draft!.route.destination) {
        throw new Error("payout route changed since the draft; nothing executed");
      }
      // decideRoute selected this payee, so the record exists. Payouts key on it, not on extracted text.
      const payee = findPayee(this.directory(run), invoice.supplier)!;
      const key = payoutKey(payee, invoice);
      if (route.rail === "cardano_preprod") await this.withWallet(() => this.payOnCardano(run, invoice, route.destination!, key));
      else await this.payViaCxc(run, invoice, route.destination!, payee, key);
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      if (run.state === "EXECUTING") this.runs.transition(run, "FAILED", run.error);
    }
  }

  /** tADA from the buyer wallet to the verified payee wallet. Signed locally, broadcast via Blockfrost. */
  private async payOnCardano(run: Run, invoice: Invoice, destination: string, key: string): Promise<void> {
    const amount = BigInt(invoice.amountMinor);
    const hold = this.payoutLedger.reserve(key, amount);
    if (!hold.ok) throw new Error(`payout refused before signing: ${hold.reason}`);

    let signed: ClientCardanoSignResult;
    try {
      signed = await this.signer.buildAndSignPaymentTransaction({
        network: CARDANO_NETWORK,
        payTo: destination,
        asset: "lovelace",
        amount: amount.toString(),
        maxTimeoutSeconds: 600,
        extra: { assetTransferMethod: "default" },
      });
    } catch (error) {
      this.payoutLedger.release(key); // nothing left the wallet
      throw error;
    }

    const base = { rail: "cardano_preprod" as const, simulated: false, amountMinor: invoice.amountMinor, currency: invoice.currency, destination };
    const explorer = (tx?: string) => (tx ? { reference: tx, explorerUrl: `${this.config.EXPLORER_TX_URL}${tx}` } : {});
    let sent: Awaited<ReturnType<ChainSubmitter["submit"]>>;
    try {
      this.submitter ??= blockfrostSubmitter(this.config);
      sent = await this.submitter.submit(signed.transaction);
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      if (this.submitter?.isDefinitiveRejection?.(error)) {
        // Refused before the mempool (e.g. an input another tx already spent): nothing was broadcast.
        this.payoutLedger.release(key);
        return this.runs.transition(run, "DRAFT_READY", `Payout refused before broadcast, nothing paid; approve again: ${run.error}`);
      }
      // The broadcast may have reached the chain: count it and lock the invoice.
      const tx = signedTxHash(signed.transaction);
      if (tx) this.noteTx(tx);
      this.payoutLedger.markUnknown(key, amount);
      run.payout = { ...base, status: "unknown", ...explorer(tx), label: "Payout outcome unknown: check the explorer before paying again", executedAt: new Date().toISOString() };
      return this.runs.transition(run, "PAYOUT_UNKNOWN", tx ? `tx ${tx}: ${run.error}` : run.error);
    }
    this.noteTx(sent.txHash);
    this.payoutLedger.markPaid(key, amount);
    const confirmed = sent.status === "confirmed";
    run.payout = {
      ...base,
      status: confirmed ? "confirmed" : "submitted",
      ...explorer(sent.txHash),
      label: confirmed ? "Paid on Cardano Preprod (testnet)" : "Broadcast to Cardano Preprod; confirmation pending",
      executedAt: new Date().toISOString(),
    };
    this.runs.transition(run, "EXECUTED", sent.txHash);
  }

  private async payViaCxc(run: Run, invoice: Invoice, destination: string, payee: VerifiedPayee, key: string): Promise<void> {
    const limit = this.config.FIAT_PAYOUTS_PER_SESSION;
    if (!this.fiatKeys.has(key) && this.fiatKeys.size >= limit) throw new Error(`payout refused: fiat payout limit of ${limit} per session reached`);
    const hold = this.payoutLedger.reserve(key, 0n);
    if (!hold.ok) throw new Error(`payout refused: ${hold.reason}`);
    this.fiatKeys.add(key);
    const base = { rail: "cxc_fiat" as const, simulated: this.fiat.simulated, amountMinor: invoice.amountMinor, currency: invoice.currency, destination };
    let reference: string;
    try {
      // Keyed per invoice, not per run: a new run for the same invoice replays instead of paying again.
      ({ reference } = await this.fiat.payout({ idempotencyKey: `payout-${key}`, invoice, destination, payee }));
    } catch (error) {
      if (this.fiat.isDefinitiveRejection?.(error)) {
        run.error = error instanceof Error ? error.message : String(error);
        this.payoutLedger.release(key);
        this.fiatKeys.delete(key); // nothing sent: does not count against the session limit
        return this.runs.transition(run, "DRAFT_READY", `Payout refused before it was sent, nothing paid; approve again: ${run.error}`);
      }
      // A real API may have accepted the payout before failing: lock, never retry blindly.
      this.payoutLedger.markUnknown(key, 0n);
      run.error = error instanceof Error ? error.message : String(error);
      run.payout = { ...base, status: "unknown", label: "Payout outcome unknown: reconcile with CashXChain before paying again", executedAt: new Date().toISOString() };
      return this.runs.transition(run, "PAYOUT_UNKNOWN", run.error);
    }
    this.payoutLedger.markPaid(key, 0n);
    const payout: PayoutResult = {
      ...base,
      status: this.fiat.simulated ? "simulated" : "submitted",
      reference,
      label: this.fiat.label,
      executedAt: new Date().toISOString(),
    };
    run.payout = payout;
    this.runs.transition(run, "EXECUTED", reference);
  }

  private async extract(input: string): Promise<Invoice> {
    // Structured JSON input skips the model entirely.
    try {
      const parsed = InvoiceSchema.safeParse(JSON.parse(input));
      if (parsed.success) return parsed.data;
    } catch {
      // not JSON, fall through to extraction
    }
    if (!this.config.aiReady) throw new Error("ANTHROPIC_API_KEY not set and input is not a structured invoice");
    return extractInvoice(input, this.config.CLAUDE_MODEL);
  }

  /**
   * One payment in flight per buyer wallet. Two signers working from the same UTxO set can pick
   * the same input; both pass verify, and the second broadcast fails after signing.
   */
  private withWallet<T>(pay: () => Promise<T>): Promise<T> {
    const turn = this.walletQueue.then(() => this.syncWallet()).then(pay);
    this.walletQueue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /** Remember a tx this wallet broadcast (or may have), so the next one waits for it. */
  private noteTx(hash: string): void {
    this.lastTx = { hash, at: Date.now() };
  }

  /** Runs inside the wallet queue, before the next tx is built. Bounded: never blocks forever. */
  private async syncWallet(): Promise<void> {
    const last = this.lastTx;
    if (!last) return;
    const { timeoutMs, pollMs, graceMs } = this.walletSync;
    if (!this.chain && this.config.BLOCKFROST_PROJECT_ID) this.chain = blockfrostChainView(this.config);
    if (this.chain) {
      const deadline = Date.now() + timeoutMs;
      while (!(await this.chain.hasTransaction(last.hash).catch(() => false)) && Date.now() < deadline) await sleep(pollMs);
    }
    const grace = last.at + graceMs - Date.now();
    if (grace > 0) await sleep(grace);
    if (this.lastTx === last) this.lastTx = undefined;
  }

  private async buyReport(run: Run, invoice: Invoice): Promise<ReadinessReport | undefined> {
    const fingerprint = run.fingerprint!;
    let payments = 0;
    let signedAmount: bigint | undefined;
    let signedTx: string | undefined;

    const client = new x402Client()
      .setSpendControls({
        allowedAssets: [
          { network: CARDANO_NETWORK, asset: "lovelace", maxAmountPerPayment: this.policy.maxPriceLovelace.toString() },
        ],
      })
      .registerPolicy((_v, reqs) => filterOffers(reqs, this.policy))
      .onBeforePaymentCreation(async ({ selectedRequirements }) => {
        if (payments >= this.policy.maxPaymentsPerRun) return { abort: true, reason: "max payments per run reached" };
        // Check and hold atomically: a concurrent run must not pass for the same invoice or budget.
        const allowed = this.ledger.reserve(fingerprint, BigInt(selectedRequirements.amount));
        if (!allowed.ok) return { abort: true, reason: allowed.reason };
      })
      .onAfterPaymentCreation(async ({ selectedRequirements, paymentPayload }) => {
        payments += 1;
        signedAmount = BigInt(selectedRequirements.amount);
        signedTx = signedTxHash(paymentPayload.payload.transaction);
      })
      // Core runs this only after our hold was taken and signing threw: nothing was sent.
      .onPaymentCreationFailure(async () => {
        this.ledger.release(fingerprint);
      });
    client.register("cardano:*", new ExactCardanoScheme(this.signer));

    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    this.runs.transition(run, "PAYING");

    let response: Response;
    try {
      response = await fetchWithPayment(`${this.config.baseUrl}${READINESS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": run.id },
        body: JSON.stringify({ invoice }),
      });
    } catch (error) {
      return this.failPayment(run, fingerprint, signedAmount, error, signedTx);
    }

    const http = new x402HTTPClient(client);
    let settle: ReturnType<x402HTTPClient["getPaymentSettleResponse"]> | undefined;
    try {
      settle = http.getPaymentSettleResponse(name => response.headers.get(name));
    } catch {
      settle = undefined;
    }

    if (!response.ok || !settle?.success) {
      // Verify rejections carry no PAYMENT-RESPONSE; core puts the facilitator's reason in PAYMENT-REQUIRED `error`.
      const reason = settle?.errorReason ?? paymentRequiredError(http, response);
      const detail = `HTTP ${response.status}${reason ? `, ${reason}` : ""}`;
      // A settle response with a tx means the facilitator broadcast it; a verify rejection did not.
      if (settle?.transaction) this.noteTx(settle.transaction);
      return this.failPayment(run, fingerprint, signedAmount, new Error(detail), settle?.transaction || signedTx);
    }
    // A proof needs an on-chain tx hash for a payment we actually signed.
    if (!settle.transaction || signedAmount === undefined) {
      return this.failPayment(run, fingerprint, signedAmount, new Error("settle reported success without a transaction hash"), signedTx);
    }

    this.ledger.markPaid(fingerprint, signedAmount!);
    run.payment = {
      network: CARDANO_NETWORK,
      buyerAddress: this.buyerAddress,
      sellerAddress: this.config.SELLER_ADDRESS!,
      asset: "lovelace",
      amount: signedAmount!.toString(),
      transactionHash: settle.transaction,
      explorerUrl: `${this.config.EXPLORER_TX_URL}${settle.transaction}`,
      settledAt: new Date().toISOString(),
    };
    this.noteTx(settle.transaction);
    this.runs.transition(run, "PAID", settle.transaction);
    // Paid either way: a settled request without a usable report is a failed delivery, and the
    // invoice stays locked as paid instead of being bought again.
    const report: unknown = await response.json().catch(() => undefined);
    if (!isReadinessReport(report)) {
      throw new Error(`paid (tx ${settle.transaction}), but the seller returned no readable report; the invoice stays locked as paid`);
    }
    return report;
  }

  /** A signed tx may already be on-chain: never re-sign blindly, lock the invoice instead. */
  private failPayment(run: Run, fingerprint: string, signedAmount: bigint | undefined, error: unknown, tx?: string): undefined {
    run.error = error instanceof Error ? error.message : String(error);
    if (signedAmount !== undefined) {
      this.ledger.markUnknown(fingerprint, signedAmount);
      run.settlement = {
        ...(tx ? { transactionHash: tx, explorerUrl: `${this.config.EXPLORER_TX_URL}${tx}` } : {}),
        reason: run.error,
      };
      this.runs.transition(run, "SETTLEMENT_UNKNOWN", tx ? `tx ${tx}: ${run.error}` : run.error);
    } else {
      this.runs.transition(run, "FAILED", run.error);
    }
    return undefined;
  }
}

/** Reason from a 402's PAYMENT-REQUIRED header (verify failure), if the seller sent one. */
function paymentRequiredError(http: x402HTTPClient, response: Response): string | undefined {
  if (response.status !== 402) return undefined;
  try {
    return http.getPaymentRequiredResponse(name => response.headers.get(name)).error;
  } catch {
    return undefined;
  }
}

/** Hash of the tx we signed, so an unknown settlement can still be looked up on the explorer. */
function signedTxHash(transaction: unknown): string | undefined {
  try {
    return typeof transaction === "string" ? decodeCardanoTransaction(transaction).txHash : undefined;
  } catch {
    return undefined; // undecodable: rely on the facilitator's settle response
  }
}

const VERDICTS: ReadonlySet<unknown> = new Set(["ready_for_review", "needs_info", "blocked"]);

/** Only a well-formed report may drive the run's verdict; anything else is a failed delivery. */
function isReadinessReport(body: unknown): body is ReadinessReport {
  const r = body as Partial<ReadinessReport> | null | undefined;
  return typeof r === "object" && r !== null && VERDICTS.has(r.verdict) && Array.isArray(r.checks) && r.payoutExecuted === false;
}

function draftFrom(invoice: Invoice, report: ReadinessReport, route: RouteDecision): PaymentDraft {
  const executable = route.status === "selected";
  return {
    status: "awaiting_human_approval",
    executable,
    invoiceId: invoice.id,
    supplier: invoice.supplier,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    routeQuote: report.routeQuote,
    route,
    note: !executable
      ? `Not executable: ${route.reason}.`
      : route.rail === "cardano_preprod"
        ? "On approval the agent pays tADA on Cardano Preprod to the verified wallet."
        : "On approval the agent submits the payout to CashXChain (simulated in this demo: no bank transfer).",
  };
}
