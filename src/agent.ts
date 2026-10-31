import { decodeCardanoTransaction, toClientCardanoSigner, type ClientCardanoSigner, type ClientCardanoSignResult } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";
import { extractInvoice } from "./extract.js";
import { PayoutUnknownError } from "./payout-cashxchain.js";
import { blockfrostChainView, blockfrostSubmitter, simulatedCxcPayouts, type ChainSubmitter, type ChainView, type FiatPayoutClient, type TxOutput } from "./payout.js";
import { filterOffers, precheck, SpendLedger, type SpendPolicy } from "./policy.js";
import { invoiceFingerprint } from "./readiness.js";
import { decideRoute, findPayee, payeeDirectory, payoutKey, type VerifiedPayee } from "./routing.js";
import type { Run, RunStore } from "./runs.js";
import { READINESS_PATH } from "./seller.js";
import { InvoiceSchema, type Invoice, type PaymentDraft, type PaymentProof, type PayoutResult, type ReadinessReport, type RouteDecision } from "./types.js";

/** Payout rails and chain access; tests inject stubs. */
export interface PayoutRails {
  submitter?: ChainSubmitter;
  fiat?: FiatPayoutClient;
  chain?: ChainView;
  walletSync?: Partial<typeof WALLET_SYNC>;
  reconcile?: Partial<typeof RECONCILE>;
}

/**
 * Between two transactions from the buyer wallet: wait until our provider has indexed the previous
 * one, then let other indexers (the hosted facilitator's) catch up for `graceMs` after it settled.
 * Otherwise the next tx can be built on, or checked against, a stale UTxO set and fail after signing.
 */
const WALLET_SYNC = { timeoutMs: 90_000, pollMs: 3_000, graceMs: 30_000 };

/** Background chain check of an unknown outcome (SETTLEMENT_UNKNOWN, Cardano PAYOUT_UNKNOWN). */
const RECONCILE = { pollMs: 15_000, windowMs: 20 * 60_000 };

/**
 * How far the provider's tip must be past a tx's validity end before the tx's absence proves it can
 * no longer land: covers indexer lag and rollbacks up to ~30 Preprod blocks (10 min of slots).
 */
const EXPIRY_MARGIN_SLOTS = 600n;

const PAID_ON_CARDANO = "Paid on Cardano Preprod (testnet)";

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
  private readonly reconcileTiming: typeof RECONCILE;
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
    this.reconcileTiming = { ...RECONCILE, ...rails.reconcile };
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
        run.route = this.route(invoice);
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

  private route(invoice: Invoice): RouteDecision {
    return decideRoute(invoice, this.payees, { payoutMaxLovelace: this.config.PAYOUT_MAX_LOVELACE, fiatMaxMinor: this.config.FIAT_PAYOUT_MAX_MINOR });
  }

  private async execute(run: Run): Promise<void> {
    try {
      const invoice = run.invoice!;
      // Re-derive the route at execution time: only the directory decides where money goes.
      const route = this.route(invoice);
      if (route.status !== "selected" || route.destination !== run.draft!.route.destination) {
        throw new Error("payout route changed since the draft; nothing executed");
      }
      // decideRoute selected this payee, so the record exists. Payouts key on it, not on extracted text.
      const payee = findPayee(this.payees, invoice.supplier)!;
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
      const ours = decodeSigned(signed.transaction);
      const tx = ours?.txHash;
      if (tx) this.noteTx(tx);
      this.payoutLedger.markUnknown(key, amount);
      const unknown: PayoutResult = { ...base, status: "unknown", ...explorer(tx), label: "Payout outcome unknown: check the explorer before paying again", executedAt: new Date().toISOString() };
      run.payout = unknown;
      this.runs.transition(run, "PAYOUT_UNKNOWN", tx ? `tx ${tx}: ${run.error}` : run.error);
      if (ours) this.watchPayout(run, key, { txHash: ours.txHash, payTo: destination, lovelace: amount, ttlSlot: ours.ttlSlot }, unknown);
      return;
    }
    this.noteTx(sent.txHash);
    this.payoutLedger.markPaid(key, amount);
    const confirmed = sent.status === "confirmed";
    run.payout = {
      ...base,
      status: confirmed ? "confirmed" : "submitted",
      ...explorer(sent.txHash),
      label: confirmed ? PAID_ON_CARDANO : "Broadcast to Cardano Preprod; confirmation pending",
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
      const payoutId = error instanceof PayoutUnknownError ? error.payoutId : undefined;
      run.payout = {
        ...base,
        status: "unknown",
        ...(payoutId ? { reference: payoutId } : {}),
        label: `Payout outcome unknown: reconcile with CashXChain (Idempotency-Key payout-${key}) before paying again`,
        executedAt: new Date().toISOString(),
      };
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

  /** Blockfrost when configured; tests inject a stub. */
  private chainView(): ChainView | undefined {
    if (!this.chain && this.config.BLOCKFROST_PROJECT_ID) this.chain = blockfrostChainView(this.config);
    return this.chain;
  }

  /** Runs inside the wallet queue, before the next tx is built. Bounded: never blocks forever. */
  private async syncWallet(): Promise<void> {
    const last = this.lastTx;
    if (!last) return;
    const { timeoutMs, pollMs, graceMs } = this.walletSync;
    const chain = this.chainView();
    if (chain) {
      const deadline = Date.now() + timeoutMs;
      while (!(await chain.hasTransaction(last.hash).catch(() => false)) && Date.now() < deadline) await sleep(pollMs);
    }
    const grace = last.at + graceMs - Date.now();
    if (grace > 0) await sleep(grace);
    if (this.lastTx === last) this.lastTx = undefined;
  }

  private async buyReport(run: Run, invoice: Invoice): Promise<ReadinessReport | undefined> {
    const fingerprint = run.fingerprint!;
    let payments = 0;
    let signedAmount: bigint | undefined;
    let signed: Signed | undefined;

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
        signed = decodeSigned(paymentPayload.payload.transaction);
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
      // The request died after signing: the facilitator may have broadcast it.
      if (signed) this.noteTx(signed.txHash);
      return this.failPayment(run, fingerprint, signedAmount, error, signed);
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
      // Only a verify rejection (402 without PAYMENT-RESPONSE) proves nothing was broadcast. A failed
      // settle can still land (A7: nginx 504, empty tx hash, tx on chain), so the next tx waits for it.
      const verifyRejected = response.status === 402 && settle === undefined;
      const maybeSent = settle?.transaction || signed?.txHash;
      if (!verifyRejected && maybeSent) this.noteTx(maybeSent);
      return this.failPayment(run, fingerprint, signedAmount, new Error(detail), signed, settle?.transaction);
    }
    // A proof needs an on-chain tx hash for a payment we actually signed.
    if (!settle.transaction || signedAmount === undefined) {
      if (signed) this.noteTx(signed.txHash);
      return this.failPayment(run, fingerprint, signedAmount, new Error("settle reported success without a transaction hash"), signed);
    }
    // A proof for some other tx proves nothing about ours: look up the one we signed instead.
    if (signed && settle.transaction !== signed.txHash) {
      this.noteTx(signed.txHash);
      const detail = `settle reported tx ${settle.transaction}, but the signed tx is ${signed.txHash}`;
      return this.failPayment(run, fingerprint, signedAmount, new Error(detail), signed);
    }

    this.ledger.markPaid(fingerprint, signedAmount!);
    run.payment = this.paymentProof(settle.transaction, { address: this.config.SELLER_ADDRESS!, lovelace: signedAmount! });
    this.noteTx(settle.transaction);
    this.runs.transition(run, "PAID", settle.transaction);
    // Paid either way: a settled request without a usable report is a failed delivery, and the
    // invoice stays locked as paid instead of being bought again.
    const report: unknown = await response.json().catch(() => undefined);
    if (!isReadinessReport(report)) {
      throw new Error(`paid (tx ${settle.transaction}), but the seller returned no readable report; the invoice stays locked as paid`);
    }
    // Run ids (our Idempotency-Key) are public: a report cached for another invoice must not decide this one.
    if (report.invoiceFingerprint !== fingerprint) {
      throw new Error(`paid (tx ${settle.transaction}), but the report is for a different invoice; the invoice stays locked as paid`);
    }
    return report;
  }

  /**
   * A signed tx may already be on-chain: never re-sign blindly, lock the invoice instead. The tx to
   * look up is the one the facilitator reported, else the one we signed.
   */
  private failPayment(run: Run, fingerprint: string, signedAmount: bigint | undefined, error: unknown, signed?: Signed, reported?: string): undefined {
    run.error = error instanceof Error ? error.message : String(error);
    if (signedAmount !== undefined) {
      const tx = reported || signed?.txHash;
      this.ledger.markUnknown(fingerprint, signedAmount);
      const settlement = {
        ...(tx ? { transactionHash: tx, explorerUrl: `${this.config.EXPLORER_TX_URL}${tx}` } : {}),
        reason: run.error,
      };
      run.settlement = settlement;
      this.runs.transition(run, "SETTLEMENT_UNKNOWN", tx ? `tx ${tx}: ${run.error}` : run.error);
      // Only the TTL of the tx we signed can prove expiry; a different hash from the facilitator cannot.
      const ttlSlot = signed && tx === signed.txHash ? signed.ttlSlot : undefined;
      if (tx) this.watchReport(run, fingerprint, { txHash: tx, payTo: this.config.SELLER_ADDRESS!, lovelace: signedAmount, ttlSlot }, settlement);
    } else {
      this.runs.transition(run, "FAILED", run.error);
    }
    return undefined;
  }

  private paymentProof(tx: string, paid: TxOutput): PaymentProof {
    return {
      network: CARDANO_NETWORK,
      buyerAddress: this.buyerAddress,
      sellerAddress: paid.address,
      asset: "lovelace",
      amount: paid.lovelace.toString(),
      transactionHash: tx,
      explorerUrl: `${this.config.EXPLORER_TX_URL}${tx}`,
      settledAt: new Date().toISOString(),
    };
  }

  /** SETTLEMENT_UNKNOWN: paid on chain locks the invoice as paid; proven expired unlocks it. */
  private watchReport(run: Run, fingerprint: string, want: Expected, settlement: NonNullable<Run["settlement"]>): void {
    this.reconcile(run, want, {
      paid: output => {
        this.ledger.resolveUnknown(fingerprint, "paid");
        run.payment = this.paymentProof(want.txHash, output);
        run.settlement = { ...settlement, resolved: "on_chain" };
        run.error = `paid on-chain (tx ${want.txHash}), but the facilitator did not deliver the report; invoice locked as paid`;
        this.runs.transition(run, "FAILED", run.error);
      },
      expired: tip => {
        this.ledger.resolveUnknown(fingerprint, "expired");
        run.settlement = { ...settlement, resolved: "expired" };
        run.error = `${expiredNote(want, tip)}; nothing paid, the invoice is unlocked`;
        this.runs.transition(run, "FAILED", run.error);
      },
    });
  }

  /** Cardano PAYOUT_UNKNOWN: paid on chain is EXECUTED; proven expired reopens the draft. */
  private watchPayout(run: Run, key: string, want: Expected, unknown: PayoutResult): void {
    this.reconcile(run, want, {
      paid: () => {
        this.payoutLedger.resolveUnknown(key, "paid");
        run.payout = { ...unknown, status: "confirmed", label: PAID_ON_CARDANO };
        this.runs.transition(run, "EXECUTED", "payout confirmed on-chain after an unclear submit");
      },
      expired: tip => {
        this.payoutLedger.resolveUnknown(key, "expired");
        run.payout = undefined;
        run.error = expiredNote(want, tip);
        this.runs.transition(run, "DRAFT_READY", `Payout never landed, nothing paid; approve again: ${run.error}`);
      },
    });
  }

  /**
   * Resolves an unknown outcome from chain evidence, off the wallet queue and off the request: polls
   * every `pollMs` for up to `windowMs` on an unref'd timer and stops once decided. Without a tx
   * lookup, or if nothing is decided in time, the run stays unknown and locked.
   */
  private reconcile(run: Run, want: Expected, on: { paid(output: TxOutput): void; expired(tip: bigint): void }): void {
    const chain = this.chainView();
    if (!chain?.txOutputs) return;
    const state = run.state;
    const { pollMs, windowMs } = this.reconcileTiming;
    const deadline = Date.now() + windowMs;
    const tick = async (): Promise<void> => {
      const found = await chainEvidence(chain, want).catch((): Evidence => ({ kind: "pending" }));
      if (run.state !== state) return; // decided elsewhere
      if (found.kind === "paid") return on.paid(found.output);
      if (found.kind === "expired") return on.expired(found.tip);
      if (found.kind === "mismatch") {
        return this.runs.transition(run, state, `tx ${want.txHash} is on chain, but no output pays exactly ${want.lovelace} lovelace to ${want.payTo}; stays locked`);
      }
      if (Date.now() + pollMs > deadline) {
        return this.runs.transition(run, state, `tx ${want.txHash} not found on chain within the check window; stays locked, check the explorer before paying again`);
      }
      schedule();
    };
    const schedule = () => void setTimeout(() => void tick().catch(error => console.warn(`chain check of ${want.txHash} failed: ${error}`)), pollMs).unref();
    schedule();
  }
}

/** What an unknown tx must show on chain to count as paid. */
interface Expected {
  txHash: string;
  payTo: string;
  lovelace: bigint;
  /** Validity end (TTL slot) of this exact tx, decoded from what we signed; unset: never proven expired. */
  ttlSlot?: bigint;
}

type Evidence = { kind: "paid"; output: TxOutput } | { kind: "mismatch" } | { kind: "expired"; tip: bigint } | { kind: "pending" };

/**
 * One chain check. The tip is read before the tx: if an index that is already past the tx's
 * validity end (plus a margin) does not have it, no block on that chain can include it any more.
 */
async function chainEvidence(chain: ChainView, want: Expected): Promise<Evidence> {
  const tip = want.ttlSlot !== undefined ? await chain.tipSlot?.().catch(() => undefined) : undefined;
  const outputs = await chain.txOutputs?.(want.txHash);
  if (outputs) {
    const output = outputs.find(o => o.address === want.payTo && o.lovelace === want.lovelace);
    return output ? { kind: "paid", output } : { kind: "mismatch" };
  }
  if (want.ttlSlot !== undefined && tip !== undefined && tip >= want.ttlSlot + EXPIRY_MARGIN_SLOTS) return { kind: "expired", tip };
  return { kind: "pending" };
}

const expiredNote = (want: Expected, tip: bigint) =>
  `tx ${want.txHash} can no longer land: its validity ended at slot ${want.ttlSlot}, the chain tip is at slot ${tip} without it`;

/** Reason from a 402's PAYMENT-REQUIRED header (verify failure), if the seller sent one. */
function paymentRequiredError(http: x402HTTPClient, response: Response): string | undefined {
  if (response.status !== 402) return undefined;
  try {
    return http.getPaymentRequiredResponse(name => response.headers.get(name)).error;
  } catch {
    return undefined;
  }
}

/** Hash and validity end (TTL slot) of a tx we signed. */
type Signed = { txHash: string; ttlSlot?: bigint };

/** Decodes the tx we signed, so an unknown outcome can still be looked up, and proven expired. */
function decodeSigned(transaction: unknown): Signed | undefined {
  try {
    if (typeof transaction !== "string") return undefined;
    const { txHash, ttlSlot } = decodeCardanoTransaction(transaction);
    return { txHash, ttlSlot };
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
