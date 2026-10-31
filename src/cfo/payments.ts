import type { BuyerAgent } from "../agent.js";
import { normalizeIban } from "../readiness.js";
import type { VerifiedPayee } from "../routing.js";
import type { Run, RunStore } from "../runs.js";
import type { Invoice } from "../types.js";
import { toUsdMinor } from "./fx.js";
import { decidePayment, type PolicyDecision, type Rail } from "./policy.js";
import type { Payee, Payment, Store } from "./store.js";

// CashXChain sandbox payout currencies (fiat rail). ADA goes over Cardano Preprod.
const CXC_CURRENCIES = new Set(["EUR", "USD", "GBP", "CHF", "AED", "PLN", "SEK"]);

export function railFor(currency: string): Rail {
  if (currency === "ADA") return "cardano_preprod";
  return CXC_CURRENCIES.has(currency) ? "cashxchain" : "manual";
}

export interface DraftInput {
  payeeId?: string;
  payeeName?: string;
  amountMinor: number;
  currency: string;
  reason: string;
  documentId?: string;
  requestedBy: "agent" | "user";
}

export interface PaymentEngine {
  agent?: BuyerAgent;
  runs: RunStore;
}

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

/** Drafts, decides, approves and executes payments for a workspace. */
export class Payments {
  constructor(
    private readonly store: Store,
    private readonly engine: PaymentEngine,
  ) {}

  private async railWritable(ws: string, rail: Rail): Promise<boolean> {
    const kind = rail === "cardano_preprod" ? "cardano_agent_wallet" : rail === "cashxchain" ? "cashxchain" : undefined;
    return (await this.store.connections(ws)).some(c => c.kind === kind && c.access === "read_write");
  }

  async evaluate(ws: string, p: { requestedBy: "agent" | "user"; rail: Rail; usdMinor: number; payeeKnown: boolean }): Promise<PolicyDecision> {
    const workspace = (await this.store.workspace(ws))!;
    return decidePayment(workspace.autonomy, workspace.limits, {
      ...p,
      railWritable: await this.railWritable(ws, p.rail),
      agentExecutedThisMonthUsdMinor: await this.store.agentExecutedSince(ws, monthStart()),
    });
  }

  /** Creates a payment with its policy decision. An "auto" decision starts execution right away. */
  async draft(ws: string, input: DraftInput): Promise<Payment> {
    const payee = input.payeeId ? await this.store.payee(ws, input.payeeId) : findPayeeByName(await this.store.payees(ws), input.payeeName);
    const payeeName = payee?.name ?? input.payeeName?.trim() ?? "Unknown payee";
    const rail = railFor(input.currency);
    const usdMinor = toUsdMinor(input.amountMinor, input.currency);
    const policy = await this.evaluate(ws, { requestedBy: input.requestedBy, rail, usdMinor, payeeKnown: Boolean(payee) });
    const status = policy.decision === "blocked" ? "blocked" : policy.decision === "auto" ? "executing" : "pending_approval";
    const payment = await this.store.addPayment(ws, {
      payeeId: payee?.id,
      payeeName,
      amountMinor: input.amountMinor,
      currency: input.currency,
      usdMinor,
      rail,
      reason: input.reason.slice(0, 300),
      documentId: input.documentId,
      status,
      requestedBy: input.requestedBy,
      policy,
    });
    const verb = status === "executing" ? "executing payment" : status === "blocked" ? "drafted blocked payment" : "drafted payment";
    await this.store.log(ws, input.requestedBy, verb, `${payeeName}: ${fmt(input.amountMinor, input.currency)} (${policy.decision})`, { type: "payment", id: payment.id });
    if (status === "executing") void this.execute(ws, payment.id);
    return payment;
  }

  /** Human approval. Re-checks the policy: access may have changed since the draft. */
  async approve(ws: string, id: string): Promise<{ ok: true; payment: Payment } | { ok: false; error: string }> {
    const p = await this.store.payment(ws, id);
    if (!p) return { ok: false, error: "payment not found" };
    if (p.status !== "pending_approval" && p.status !== "blocked") return { ok: false, error: `payment is ${p.status}` };
    const payee = p.payeeId ? await this.store.payee(ws, p.payeeId) : undefined;
    const policy = await this.evaluate(ws, { requestedBy: "user", rail: p.rail, usdMinor: p.usdMinor, payeeKnown: Boolean(payee) });
    if (policy.decision === "blocked") {
      await this.store.updatePayment(ws, id, { status: "blocked", policy });
      return { ok: false, error: policy.checks.find(c => c.status === "fail")?.message ?? "blocked by policy" };
    }
    if (!payee) return { ok: false, error: "Add the payee to your payee directory before paying" };
    // Atomic claim: of two approvals at once, only one starts the payment.
    if (!(await this.store.claimPayment(ws, id, ["pending_approval", "blocked"], "executing", new Date().toISOString()))) {
      return { ok: false, error: "payment was already decided" };
    }
    const payment = await this.store.updatePayment(ws, id, { policy });
    await this.store.log(ws, "user", "approved payment", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)}`, { type: "payment", id });
    void this.execute(ws, id);
    return { ok: true, payment };
  }

  async reject(ws: string, id: string): Promise<{ ok: true; payment: Payment } | { ok: false; error: string }> {
    const p = await this.store.payment(ws, id);
    if (!p) return { ok: false, error: "payment not found" };
    if (!(await this.store.claimPayment(ws, id, ["pending_approval", "blocked"], "rejected", new Date().toISOString()))) {
      return { ok: false, error: `payment is ${p.status}` };
    }
    await this.store.log(ws, "user", "rejected payment", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)}`, { type: "payment", id });
    return { ok: true, payment: (await this.store.payment(ws, id))! };
  }

  /** Never throws: it runs detached, so every failure ends up on the payment. */
  private async execute(ws: string, id: string): Promise<void> {
    try {
      await this.executeOnce(ws, id);
    } catch (error) {
      console.error("payment execution failed", error);
      try {
        await this.store.updatePayment(ws, id, { status: "failed", error: "Internal error while executing; check the activity log before retrying" });
      } catch {
        // database unreachable: the run store still holds the outcome
      }
    }
  }

  /**
   * Runs the payment through the payout engine: paid x402 verification report, route to the
   * verified payee (this workspace's directory only), payout within the platform caps.
   */
  private async executeOnce(ws: string, id: string): Promise<void> {
    const p = (await this.store.payment(ws, id))!;
    const fail = async (error: string) => {
      await this.store.updatePayment(ws, id, { status: "failed", error });
      await this.store.log(ws, "system", "payment failed", `${p.payeeName}: ${error}`, { type: "payment", id });
    };
    const agent = this.engine.agent;
    if (!agent) return fail("The payment engine is not configured on this server");
    const payee = p.payeeId ? await this.store.payee(ws, p.payeeId) : undefined;
    if (!payee) return fail("Payee is not in the payee directory");

    const run = this.engine.runs.create(JSON.stringify(invoiceFor(p, payee)));
    run.payees = [verifiedPayee(payee)];
    await this.store.updatePayment(ws, id, { runId: run.id });
    try {
      await agent.process(run);
      if (run.state !== "DRAFT_READY" || !run.draft?.executable) return fail(reasonOf(run));
      const approved = agent.approve(run);
      if (!approved.ok) return fail(approved.reason);
      await approved.done;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    // Re-read: approve() moved the run on after the DRAFT_READY check above.
    const final = stateOf(run);
    if (final !== "EXECUTED" || !run.payout) {
      return fail(final === "PAYOUT_UNKNOWN" ? `Outcome unclear, payment locked until reconciled: ${run.error ?? ""}` : reasonOf(run));
    }
    const payout = run.payout;
    const onChain = payout.rail === "cardano_preprod";
    await this.store.updatePayment(ws, id, {
      status: "executed",
      executedAt: payout.executedAt,
      reference: payout.reference,
      ...(onChain && payout.reference ? { txHash: payout.reference } : {}),
      ...(payout.explorerUrl ? { explorerUrl: payout.explorerUrl } : {}),
      ...(payout.simulated ? { error: payout.label } : {}),
    });
    // Invoices already count as spend from their issue date; only payments without one are new spend.
    if (!p.documentId) {
      await this.store.addTransaction(ws, {
        date: payout.executedAt.slice(0, 10),
        description: `Payment to ${p.payeeName}: ${p.reason}`.slice(0, 200),
        counterparty: p.payeeName,
        category: "Transfers",
        amountMinor: -p.amountMinor,
        currency: p.currency,
        usdMinor: -p.usdMinor,
        source: "payment",
        paymentId: id,
      });
    }
    await this.store.log(ws, "system", "payment executed", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)}${payout.reference ? ` (${payout.reference})` : ""}`, {
      type: "payment",
      id,
    });
  }
}

const stateOf = (run: Run): Run["state"] => run.state;

function reasonOf(run: Run): string {
  return run.error ?? run.route?.reason ?? run.draft?.route.reason ?? run.timeline.at(-1)?.note ?? `stopped at ${run.state}`;
}

export function findPayeeByName(payees: Payee[], name?: string): Payee | undefined {
  if (!name) return undefined;
  const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return payees.find(p => p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === key);
}

function verifiedPayee(p: Payee): VerifiedPayee {
  return {
    name: p.name,
    ...(p.iban ? { iban: normalizeIban(p.iban) } : {}),
    ...(p.bic ? { bic: p.bic.replace(/\s+/g, "").toUpperCase() } : {}),
    ...(p.routingNumber ? { routingNumber: p.routingNumber } : {}),
    ...(p.accountNumber ? { accountNumber: p.accountNumber } : {}),
    ...(p.accountType ? { accountType: p.accountType } : {}),
    ...(p.cardanoAddress ? { cardanoAddress: p.cardanoAddress } : {}),
  };
}

/** The payment as an invoice for the payout engine; account details come from the payee record. */
function invoiceFor(p: Payment, payee: Payee): Invoice {
  const v = verifiedPayee(payee);
  const country = payee.country?.toUpperCase() ?? v.iban?.slice(0, 2) ?? (v.routingNumber ? "US" : "DE");
  return {
    id: `CFO-${p.id.slice(0, 8).toUpperCase()}`,
    supplier: payee.name,
    destinationCountry: country,
    currency: p.currency,
    amountMinor: p.amountMinor,
    reference: p.reason.slice(0, 140),
    ...(v.iban ? { iban: v.iban } : {}),
    ...(v.bic ? { bic: v.bic } : {}),
    ...(v.routingNumber ? { routingNumber: v.routingNumber } : {}),
    ...(v.accountNumber ? { accountNumber: v.accountNumber } : {}),
    ...(v.cardanoAddress ? { cardanoAddress: v.cardanoAddress } : {}),
  };
}

function fmt(minor: number, currency: string): string {
  const e = currency === "ADA" ? 6 : currency === "JPY" ? 0 : 2;
  return `${(minor / 10 ** e).toLocaleString("en-US", { maximumFractionDigits: e })} ${currency === "ADA" ? "tADA" : currency}`;
}
