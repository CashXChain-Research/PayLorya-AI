import { decodeCardanoTransaction, toClientCardanoSigner, type ClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";
import { extractInvoice } from "./extract.js";
import { filterOffers, precheck, SpendLedger, type SpendPolicy } from "./policy.js";
import { invoiceFingerprint } from "./readiness.js";
import type { Run, RunStore } from "./runs.js";
import { READINESS_PATH } from "./seller.js";
import { InvoiceSchema, type Invoice, type PaymentDraft, type ReadinessReport } from "./types.js";

/**
 * Buyer role: the autonomous agent. Claude only extracts fields; every money decision
 * (whether to pay, how much, to whom, how often) is made by the deterministic policy.
 */
export class BuyerAgent {
  private readonly signer: ClientCardanoSigner;
  private readonly policy: SpendPolicy;
  private readonly ledger: SpendLedger;
  private walletQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: Config,
    private readonly runs: RunStore,
    signer?: ClientCardanoSigner, // tests inject a stub; production derives it from BUYER_MNEMONIC
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
  }

  get buyerAddress(): string {
    return this.signer.getAddress();
  }

  get spentLovelace(): bigint {
    return this.ledger.spentLovelace;
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
        run.draft = draftFrom(invoice, report);
        this.runs.transition(run, "DRAFT_READY", "Awaiting human approval; nothing executed");
      } else {
        this.runs.transition(run, report.verdict === "blocked" ? "BLOCKED" : "NEEDS_INFO", report.verdict);
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      if (run.state !== "SETTLEMENT_UNKNOWN") this.runs.transition(run, "FAILED", run.error);
    }
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
    const turn = this.walletQueue.then(pay);
    this.walletQueue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
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

    let settle: ReturnType<x402HTTPClient["getPaymentSettleResponse"]> | undefined;
    try {
      settle = new x402HTTPClient(client).getPaymentSettleResponse(name => response.headers.get(name));
    } catch {
      settle = undefined;
    }

    if (!response.ok || !settle?.success) {
      const detail = `HTTP ${response.status}${settle?.errorReason ? `, ${settle.errorReason}` : ""}`;
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

function draftFrom(invoice: Invoice, report: ReadinessReport): PaymentDraft {
  return {
    status: "awaiting_human_approval",
    executable: false,
    invoiceId: invoice.id,
    supplier: invoice.supplier,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    routeQuote: report.routeQuote,
    note: "Draft only. No CashXChain payout endpoint is called from this demo.",
  };
}
