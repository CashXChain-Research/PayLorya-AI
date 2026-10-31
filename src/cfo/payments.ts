import type { BuyerAgent } from "../agent.js";
import { decodeCardanoTransaction, type ClientCardanoSignInput, type ClientCardanoSignResult } from "@x402/cardano";
import { fiatBudgetFor } from "../budget.js";
import type { WorkspaceAgents } from "./agents.js";
import { CashXChainPayoutRoute } from "../payout-cashxchain.js";
import type { FiatPayoutClient } from "../payout.js";
import { normalizeIban } from "../readiness.js";
import { payoutKey, type VerifiedPayee } from "../routing.js";
import type { Run, RunStore } from "../runs.js";
import type { Invoice } from "../types.js";
import type { CxcKeys } from "./cxc-keys.js";
import { bech32FromHex, InsufficientFunds, TX_VALIDITY_MS, type TxKit } from "./wallet-signer.js";
import { exponent, toUsdMinor } from "./fx.js";
import { decidePayment, type PolicyDecision, type Rail } from "./policy.js";
import type { CardanoPayout, Destination, Payee, Payment, Store } from "./store.js";

// CashXChain sandbox payout currencies (fiat rail). ADA goes over Cardano Preprod.
const CXC_CURRENCIES = new Set(["EUR", "USD", "GBP", "CHF", "AED", "PLN", "SEK"]);

export function railFor(currency: string): Rail {
  if (currency === "ADA") return "cardano_preprod";
  return CXC_CURRENCIES.has(currency) ? "cashxchain" : "manual";
}

/** A draft that would duplicate an open or paid payment: nothing is created. */
export class DraftRefused extends Error {}

/** Statuses of a payment that is still open or already paid: a second one for the same bill is refused. */
const OPEN_OR_PAID: ReadonlySet<Payment["status"]> = new Set(["pending_approval", "blocked", "executing", "awaiting_signature", "executed"]);

/** What the person saw in the approval dialog; approving checks it against the stored payment. */
export interface ApprovalConfirmation {
  amountMinor: number;
  currency: string;
}

export interface DraftInput {
  payeeId?: string;
  payeeName?: string;
  /** Account details for a payee that is not saved; else taken from the linked invoice. */
  destination?: Destination;
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

export const NEEDS_OWN_WALLET =
  "tADA payouts leave from your agent wallet (read & write), or from your own Cardano wallet that you sign with (read & write): connect one on the Connections page";

export const INTERRUPTED =
  "Interrupted by a server restart before it finished. Approve it again to continue: it cannot be paid twice.";

/**
 * How far past a sent transaction's validity the provider's newest indexed block must be before an
 * unseen transaction counts as never included. An indexer that lags only delays the decision.
 */
export const EXPIRY_MARGIN_MS = 10 * 60_000;

export const CHECK_TIMED_OUT =
  "The verification on Cardano did not finish in time, so nothing was paid. Approve it again to retry.";

/** Per-payout limits of the payout engine (config): checked at drafting, not after a paid check. */
export interface PayoutLimits {
  tadaMaxLovelace: bigint;
  fiatMaxMinor?: number;
  /** Most a verification (x402 report) may cost: the agent wallet must hold it. */
  feeMaxLovelace: bigint;
}

// Cardano refuses outputs below about 1 ADA (min-UTxO): the payout engine's floor (routing.ts).
const TADA_MIN_LOVELACE = 1_000_000n;
// Headroom for network fees on top of what a payment costs.
const FEE_MARGIN_LOVELACE = 1_000_000n;
const tada = (lovelace: bigint | number) => `${(Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} tADA`;

export interface PaymentsOptions {
  limits?: PayoutLimits;
  /** One payout engine per account, signing with its own agent wallet. Without it nothing executes. */
  agents?: Pick<WorkspaceAgents, "for" | "wallet">;
  /** tADA from the owner's wallet: builds and broadcasts; absent without BLOCKFROST_PROJECT_ID (tADA refused). */
  kit?: TxKit;
  /** Explorer prefix for a transaction hash (EXPLORER_TX_URL). */
  explorerTxUrl?: string;
  /** How long the paid verification (x402 on Cardano) may take before the payment goes back to approval. */
  checkTimeoutMs?: number;
}

/** What the owner's wallet reports when asked to pay (CIP-30): hex, as the wallet gives it. */
export interface WalletReport {
  utxos: string[];
  changeAddress: string;
  /** getUsedAddresses(): must include the connected address. */
  addresses: string[];
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export const NEEDS_OWN_KEY = "CashXChain payouts leave from your own account: connect CashXChain with your API key on the Connections page";

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

/** Drafts, decides, approves and executes payments for a workspace. */
export class Payments {
  constructor(
    private readonly store: Store,
    private readonly engine: PaymentEngine,
    private readonly keys?: CxcKeys,
    private readonly wallets: PaymentsOptions = {},
  ) {}

  // Payments executing in this process. One in "executing" that is not here was cut off by a restart.
  private readonly running = new Set<string>();

  /** The workspace's own Cardano wallet (read & write): tADA payouts leave from it and nowhere else. */
  /** Why the payout engine would refuse this amount on this rail, before anything is paid. */
  private limitProblem(rail: Rail, amountMinor: number, currency: string): string | undefined {
    const l = this.wallets.limits;
    if (rail === "cardano_preprod") {
      const amount = BigInt(amountMinor);
      if (amount < TADA_MIN_LOVELACE) return `tADA payouts start at 1 tADA, the least Cardano lets a payment send to an address. This one is ${tada(amount)}.`;
      if (l && amount > l.tadaMaxLovelace) return `tADA payouts are at most ${tada(l.tadaMaxLovelace)} each (the agent's per-payout cap). This one is ${tada(amount)}: split it into smaller payments.`;
    }
    if (rail === "cashxchain" && l?.fiatMaxMinor !== undefined && amountMinor > l.fiatMaxMinor) {
      return `CashXChain payouts are at most ${fmt(l.fiatMaxMinor, currency)} each (the agent's per-payout cap). This one is ${fmt(amountMinor, currency)}: pay it by hand in CashXChain.`;
    }
    return undefined;
  }

  /**
   * What would stop this payment after its paid check, checked before the check is bought: so a
   * payment that cannot go out costs no verification fee, and says why.
   */
  private async preflight(ws: string, p: Payment, agent: BuyerAgent, route: { fiat?: FiatPayoutClient; agentPaysTada: boolean }): Promise<string | undefined> {
    const limit = this.limitProblem(p.rail, p.amountMinor, p.currency);
    if (limit) return limit;
    const budget = agent.budget;
    const usage = agent.budgetUsage;
    if (budget && usage && p.rail === "cardano_preprod") {
      const used = BigInt(usage.cardanoPaidLovelace);
      const cap = BigInt(budget.cardanoBudgetLovelace);
      if (used + BigInt(p.amountMinor) > cap) {
        return `Your agent has paid out ${tada(used)} of its ${tada(cap)} tADA budget since the server started; this payment would exceed it. Raise the budget or wait for the next session.`;
      }
    }
    if (budget && usage && p.rail === "cashxchain") {
      if (usage.fiatPayouts >= budget.fiatPayoutsPerSession) {
        return `Your agent has made ${usage.fiatPayouts} CashXChain payouts since the server started, its limit per session. Raise the limit or wait for the next session.`;
      }
      const used = usage.fiatPaidMinor[p.currency] ?? 0;
      const cap = fiatBudgetFor(budget, p.currency);
      if (used + p.amountMinor > cap) {
        return `Your agent has paid out ${fmt(used, p.currency)} of its ${fmt(cap, p.currency)} budget since the server started; this payment would exceed it.`;
      }
    }
    // Balances: read from the chain and from CashXChain. If a provider does not answer, the payment
    // goes on and the payout itself reports what it finds.
    const kit = this.wallets.kit;
    const wallet = await this.wallets.agents?.wallet(ws);
    if (kit && wallet?.address) {
      const fee = (this.wallets.limits?.feeMaxLovelace ?? 3_000_000n) + FEE_MARGIN_LOVELACE;
      const needed = fee + (route.agentPaysTada ? BigInt(p.amountMinor) : 0n);
      const held = await kit.balance(wallet.address).catch(() => undefined);
      if (held !== undefined && held < needed) {
        return route.agentPaysTada
          ? `Your agent wallet holds ${tada(held)}; this payment needs ${tada(p.amountMinor)} plus up to ${tada(fee)} for the verification on Cardano and fees. Top it up from the Preprod faucet.`
          : `Your agent wallet holds ${tada(held)}; the verification on Cardano needs up to ${tada(fee)} with fees. Top it up from the Preprod faucet.`;
      }
    }
    if (route.fiat?.sourceAccount) {
      const account = await route.fiat.sourceAccount(p.currency).catch(() => null);
      if (account === undefined) return `Your CashXChain account has no active ${p.currency} account to pay from. Open one in CashXChain.`;
      if (account?.available !== undefined && Number(account.available) * 10 ** exponent(p.currency) < p.amountMinor) {
        return `Your CashXChain ${p.currency} account holds ${account.available} ${p.currency}; this payout needs ${fmt(p.amountMinor, p.currency)}. Top it up in CashXChain.`;
      }
    }
    return undefined;
  }

  /** Stops a payment before anything was paid: blocked with its reason, which the activity shows. */
  private async block(ws: string, p: Payment, reason: string): Promise<void> {
    await this.store.updatePayment(ws, p.id, { status: "blocked", error: `${reason} Nothing was paid.`, cardano: null });
    await this.store.log(ws, "system", "payment blocked", `${p.payeeName}: ${reason}`, { type: "payment", id: p.id });
  }

  /**
   * The agent wallet signed a tADA payout: stored on its payment before the agent sends it, so a
   * restart in between is settled from the chain (in a block, or expired) and never paid twice.
   */
  async recordAgentPayout(ws: string, input: ClientCardanoSignInput, signed: ClientCardanoSignResult): Promise<void> {
    const open = (await this.store.payments(ws)).find(
      x => x.status === "executing" && x.cardano?.byAgent && !x.cardano.submitted && x.cardano.payTo === input.payTo && x.cardano.lovelace === input.amount,
    );
    if (!open?.cardano) return;
    const txHash = decodeCardanoTransaction(signed.transaction).txHash;
    const submitted = { txHash, at: new Date().toISOString(), validUntil: new Date(Date.now() + input.maxTimeoutSeconds * 1000).toISOString() };
    await this.store.updatePayment(ws, open.id, { cardano: { ...open.cardano, submitted } });
  }

  private async agentWalletState(ws: string): Promise<"ready" | "missing" | "read_only"> {
    const wallet = await this.wallets.agents?.wallet(ws);
    return !wallet ? "missing" : wallet.access === "read_write" ? "ready" : "read_only";
  }

  /**
   * Where a tADA payout leaves from. The owner's own wallet set to read & write: they sign each
   * payout in it (CIP-30), and its address is returned. Otherwise the account's agent wallet: the
   * agent pays it on its own, like a CashXChain payout. Never PayLorya AI's wallet.
   */
  private async tadaSource(ws: string): Promise<{ agent: true } | { agent: false; from: string }> {
    const connections = await this.store.connections(ws);
    const own = connections.find(x => x.kind === "cardano_wallet" && x.access === "read_write" && x.address);
    if (own?.address) {
      if (!this.wallets.kit) throw new Error("tADA payouts are not configured on this server (BLOCKFROST_PROJECT_ID)");
      return { agent: false, from: own.address };
    }
    if (connections.some(c => c.kind === "cardano_agent_wallet" && c.credentialHint && c.access === "read_write")) return { agent: true };
    throw new Error(NEEDS_OWN_WALLET);
  }

  /**
   * Builds the payout for the owner's wallet to sign, from the funds the wallet reports (CIP-30):
   * the verified payee and amount stored at approval, change back to the wallet, valid 10 minutes.
   * Built fresh on every request, so it never spends stale UTxOs or runs out of time while waiting.
   */
  async prepareTransaction(ws: string, id: string, wallet: WalletReport): Promise<Result<{ txCbor: string; txHash: string; validUntil: string }>> {
    const p = await this.store.payment(ws, id);
    if (!p) return refuse(404, "payment not found");
    const c = p.cardano;
    if (p.status !== "awaiting_signature" || !c) return refuse(409, `This payment is not waiting for a signature (it is ${p.status})`);
    const kit = this.wallets.kit;
    if (!kit) return refuse(503, "tADA payouts are not configured on this server (BLOCKFROST_PROJECT_ID)");
    let changeAddress: string;
    let held: string[];
    try {
      changeAddress = bech32FromHex(wallet.changeAddress);
      held = [changeAddress, ...wallet.addresses.map(bech32FromHex)];
    } catch {
      return refuse(400, "The wallet reported an address this server cannot read");
    }
    if (!held.includes(c.from)) return refuse(409, `This wallet does not hold ${c.from.slice(0, 20)}…, the wallet connected for payments. Open that wallet and sign again.`);
    const validUntil = Date.now() + TX_VALIDITY_MS;
    let tx;
    try {
      tx = await kit.build({ payTo: c.payTo, lovelace: BigInt(c.lovelace), funds: { utxos: wallet.utxos, changeAddress }, validUntil });
    } catch (error) {
      if (error instanceof InsufficientFunds) return refuse(400, error.message);
      return refuse(502, `The transaction could not be built: ${error instanceof Error ? error.message : String(error)}`);
    }
    const next: CardanoPayout = { ...c, tx: { cborHex: tx.cborHex, txHash: tx.txHash, validUntil: new Date(validUntil).toISOString() } };
    await this.store.updatePayment(ws, id, { cardano: next, error: undefined });
    return { ok: true, value: { txCbor: tx.cborHex, txHash: tx.txHash, validUntil: next.tx!.validUntil } };
  }

  /**
   * The owner's wallet signed the latest transaction: splice the witnesses in, record it, hand it to
   * the network. Recorded before it is sent, so a restart mid-send is resolved from the chain.
   */
  async submitSignature(ws: string, id: string, input: { txHash: string; witnessSet: string }): Promise<Result<Payment>> {
    const p = await this.store.payment(ws, id);
    if (!p) return refuse(404, "payment not found");
    const c = p.cardano;
    const kit = this.wallets.kit;
    if (p.status !== "awaiting_signature" || !c) return refuse(409, `This payment is not waiting for a signature (it is ${p.status})`);
    if (!kit) return refuse(503, "tADA payouts are not configured on this server (BLOCKFROST_PROJECT_ID)");
    if (!c.tx || c.tx.txHash !== input.txHash) return refuse(409, "That signature is for an older transaction. Sign again.");
    if (Date.now() > Date.parse(c.tx.validUntil) - 30_000) return refuse(409, "That transaction has expired. Sign again: a fresh one is built.");
    let signed: string;
    try {
      signed = kit.assemble(c.tx.cborHex, input.witnessSet);
    } catch (error) {
      return refuse(400, error instanceof Error ? error.message : "The wallet's signature could not be used");
    }
    // One send per payment: a second tab or a double click finds it already claimed.
    if (!(await this.store.claimPayment(ws, id, ["awaiting_signature"], "executing"))) return refuse(409, "This payment is already being sent");
    // Owned by this request until it is recorded and sent: the sweep must not take it for cut off.
    const live = `${ws}:${id}`;
    this.running.add(live);
    try {
      return await this.send(ws, id, p, c, kit, signed);
    } finally {
      this.running.delete(live);
    }
  }

  private async send(ws: string, id: string, p: Payment, c: CardanoPayout, kit: TxKit, signed: string): Promise<Result<Payment>> {
    if (!c.tx) return refuse(409, "That transaction has expired. Sign again: a fresh one is built.");
    const submitted = { txHash: c.tx.txHash, at: new Date().toISOString(), validUntil: c.tx.validUntil };
    await this.store.updatePayment(ws, id, { cardano: { ...c, submitted }, error: undefined });
    await this.store.log(ws, "user", "signed payment", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)} in their wallet`, { type: "payment", id });
    try {
      await kit.submit(signed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (kit.isDefinitiveRejection(error)) {
        // Refused before any mempool: nothing was sent, the owner can sign a fresh one.
        await this.store.updatePayment(ws, id, { status: "awaiting_signature", cardano: { ...c, submitted: undefined }, error: `Cardano refused the transaction, nothing was sent: ${message}. Sign again.` });
        return refuse(422, `Cardano refused the transaction, nothing was sent: ${message}`);
      }
      // It may have reached the network: the sweep settles it from the chain (in a block, or expired).
      await this.store.updatePayment(ws, id, { error: "Sent; waiting for the Cardano network to confirm it." });
      return { ok: true, value: (await this.store.payment(ws, id))! };
    }
    return { ok: true, value: await this.finishCardano(ws, id) };
  }

  /** The owner declined in the wallet (or on the page): nothing is sent, the payment is rejected. */
  async declineSignature(ws: string, id: string): Promise<Result<Payment>> {
    const p = await this.store.payment(ws, id);
    if (!p) return refuse(404, "payment not found");
    if (!(await this.store.claimPayment(ws, id, ["awaiting_signature"], "rejected"))) return refuse(409, `This payment is not waiting for a signature (it is ${p.status})`);
    await this.store.updatePayment(ws, id, { error: "Declined in the wallet: nothing was sent." });
    await this.store.log(ws, "user", "declined payment", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)} in their wallet`, { type: "payment", id });
    return { ok: true, value: (await this.store.payment(ws, id))! };
  }

  /** A sent tADA payout: executed, with its transaction and explorer link, booked as spend. */
  private async finishCardano(ws: string, id: string, confirmedAt?: string): Promise<Payment> {
    const p = (await this.store.payment(ws, id))!;
    const tx = p.cardano!.submitted!.txHash;
    const executedAt = new Date().toISOString();
    await this.store.updatePayment(ws, id, {
      status: "executed",
      executedAt,
      reference: tx,
      txHash: tx,
      ...(this.wallets.explorerTxUrl ? { explorerUrl: `${this.wallets.explorerTxUrl}${tx}` } : {}),
      cardano: { ...p.cardano!, ...(confirmedAt ? { confirmedAt } : {}) },
      error: undefined,
    });
    await this.booked(ws, p, executedAt);
    await this.store.log(ws, "system", "payment executed", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)} on Cardano Preprod (${tx})`, { type: "payment", id });
    return (await this.store.payment(ws, id))!;
  }

  /** Invoices already count as spend from their issue date; only payments without one are new spend. */
  private async booked(ws: string, p: Payment, executedAt: string): Promise<void> {
    if (p.documentId) return;
    await this.store.addTransaction(ws, {
      date: executedAt.slice(0, 10),
      description: `Payment to ${p.payeeName}: ${p.reason}`.slice(0, 200),
      counterparty: p.payeeName,
      category: "Transfers",
      amountMinor: -p.amountMinor,
      currency: p.currency,
      usdMinor: -p.usdMinor,
      source: "payment",
      paymentId: p.id,
    });
  }

  /**
   * Settles what a restart (a deploy, the container waking up) left behind, and follows sent tADA
   * payouts to their block. Run at start and every minute.
   * - "executing" without a live execution here: a sent tADA payout is resolved from the chain; any
   *   other goes back to approval (resuming pays under the same idempotency key, never twice).
   * - executed tADA payouts not yet in a block: marked confirmed once they are.
   */
  async sweep(now = Date.now()): Promise<void> {
    const kit = this.wallets.kit;
    for (const { ws, payment: p } of await this.store.paymentsWithStatus(["executing", "executed"])) {
      if (this.running.has(`${ws}:${p.id}`)) continue;
      const sent = p.cardano?.submitted;
      try {
        if (p.status === "executing" && sent) {
          if (!kit) continue;
          if (await kit.confirmed(sent.txHash)) await this.finishCardano(ws, p.id, new Date(now).toISOString());
          // Never included only once the provider's own chain view is well past its validity: a block
          // can land just before the deadline and be indexed minutes later. Until then, wait.
          else if (now > Date.parse(sent.validUntil) + EXPIRY_MARGIN_MS && (await kit.tipTime()) > Date.parse(sent.validUntil) + EXPIRY_MARGIN_MS && !(await kit.confirmed(sent.txHash))) {
            // The agent wallet's payout goes back to approval; one the owner signs goes back to signing.
            const byAgent = Boolean(p.cardano?.byAgent);
            if (await this.store.claimPayment(ws, p.id, ["executing"], byAgent ? "pending_approval" : "awaiting_signature")) {
              await this.store.updatePayment(ws, p.id, {
                cardano: byAgent ? null : { ...p.cardano!, submitted: undefined },
                error: `The transaction expired before it reached a block: nothing was sent. ${byAgent ? "Approve it again." : "Sign again."}`,
              });
              await this.store.log(ws, "system", "payment not sent", `${p.payeeName}: the transaction expired unconfirmed`, { type: "payment", id: p.id });
            }
          }
        } else if (p.status === "executing") {
          if (await this.store.claimPayment(ws, p.id, ["executing"], "pending_approval")) {
            // Nothing was signed (a signed payout would carry its transaction): nothing to follow.
            await this.store.updatePayment(ws, p.id, { error: INTERRUPTED, ...(p.cardano?.byAgent ? { cardano: null } : {}) });
            await this.store.log(ws, "system", "payment interrupted", `${p.payeeName}: back to approval after a restart`, { type: "payment", id: p.id });
          }
        } else if (sent && !p.cardano?.confirmedAt && kit && now - Date.parse(p.executedAt ?? p.createdAt) < 24 * 3_600_000) {
          if (await kit.confirmed(sent.txHash)) await this.store.updatePayment(ws, p.id, { cardano: { ...p.cardano!, confirmedAt: new Date(now).toISOString() } });
        }
      } catch (error) {
        console.error(`payment sweep (${p.id}) failed`, error);
      }
    }
  }

  /**
   * The fiat route of a workspace: its own CashXChain account, connected by API key. Its payouts
   * leave from that account and from nowhere else: a connection without a key (one made before keys
   * were required, or one reading a linked sub-account) cannot pay out, and PayLorya AI's shared
   * sandbox account never pays for a workspace. Throws with the reason shown on the payment.
   */
  private async ownFiatRoute(ws: string): Promise<FiatPayoutClient> {
    const c = (await this.store.connections(ws)).find(x => x.kind === "cashxchain" && x.access === "read_write");
    if (!c?.credentialHint) throw new Error(NEEDS_OWN_KEY);
    const client = await this.keys?.client(ws, c);
    if (!client) throw new Error("This server cannot use the stored CashXChain API key");
    return new CashXChainPayoutRoute(client);
  }

  private async railWritable(ws: string, rail: Rail): Promise<boolean> {
    const connections = await this.store.connections(ws);
    // tADA: the account's agent wallet, or its own wallet it signs with. Fiat: its own CashXChain account.
    if (rail === "cardano_preprod") {
      return connections.some(c => c.access === "read_write" && ((c.kind === "cardano_agent_wallet" && c.credentialHint) || c.kind === "cardano_wallet"));
    }
    return rail === "cashxchain" && connections.some(c => c.kind === "cashxchain" && c.access === "read_write");
  }

  async evaluate(
    ws: string,
    p: {
      requestedBy: "agent" | "user";
      rail: Rail;
      amountMinor: number;
      currency: string;
      usdMinor: number;
      payeeKnown: boolean;
      hasAccount: boolean;
      accountMismatch?: boolean;
    },
  ): Promise<PolicyDecision> {
    const workspace = (await this.store.workspace(ws))!;
    const limitProblem = this.limitProblem(p.rail, p.amountMinor, p.currency);
    return decidePayment(workspace.autonomy, workspace.limits, {
      ...p,
      ...(limitProblem ? { limitProblem } : {}),
      railWritable: await this.railWritable(ws, p.rail),
      agentWallet: await this.agentWalletState(ws),
      agentExecutedThisMonthUsdMinor: await this.store.agentExecutedSince(ws, monthStart()),
    });
  }

  /**
   * Where the money would go. A saved payee's account always wins; a draft's own details (from the
   * agent or the linked invoice) are used only for a payee that is not saved.
   */
  private async destinationFor(ws: string, payee: Payee | undefined, given: Destination | undefined, documentId: string | undefined) {
    const fromDraft = clean(given) ?? clean(await this.fromDocument(ws, documentId));
    if (payee) {
      const saved = clean(payee) ?? {};
      return { destination: saved, accountMismatch: Boolean(fromDraft && differs(fromDraft, saved)) };
    }
    return { destination: fromDraft ?? {}, accountMismatch: false };
  }

  private async fromDocument(ws: string, documentId: string | undefined): Promise<Destination | undefined> {
    if (!documentId) return undefined;
    const pd = (await this.store.document(ws, documentId))?.extracted?.paymentDetails as Record<string, string | null> | undefined;
    if (!pd) return undefined;
    return {
      ...(pd.iban ? { iban: pd.iban } : {}),
      ...(pd.bic ? { bic: pd.bic } : {}),
      ...(pd.routingNumber ? { routingNumber: pd.routingNumber } : {}),
      ...(pd.accountNumber ? { accountNumber: pd.accountNumber } : {}),
      ...(pd.cardanoAddress ? { cardanoAddress: pd.cardanoAddress } : {}),
    };
  }

  /**
   * Creates a payment with its policy decision. Drafting always works, for saved and unsaved payees
   * alike, and moves no money; an "auto" decision starts execution right away.
   */
  async draft(ws: string, input: DraftInput): Promise<Payment> {
    const payee = input.payeeId ? await this.store.payee(ws, input.payeeId) : findPayeeByName(await this.store.payees(ws), input.payeeName);
    const payeeName = payee?.name ?? input.payeeName?.trim() ?? "Unknown payee";
    // One payment per bill: the same invoice, or the same payee and amount while one is still open.
    const twin = (await this.store.payments(ws)).find(
      x =>
        OPEN_OR_PAID.has(x.status) &&
        ((input.documentId !== undefined && x.documentId === input.documentId) ||
          (x.status !== "executed" && x.payeeName.toLowerCase() === payeeName.toLowerCase() && x.amountMinor === input.amountMinor && x.currency === input.currency)),
    );
    if (twin) {
      const state = twin.status === "executed" ? "already paid" : `already open (${twin.status.replace(/_/g, " ")})`;
      throw new DraftRefused(`A payment to ${twin.payeeName} for ${fmt(twin.amountMinor, twin.currency)} is ${state}, payment ${twin.id}. No second payment was drafted.`);
    }
    const rail = railFor(input.currency);
    const usdMinor = toUsdMinor(input.amountMinor, input.currency);
    const { destination, accountMismatch } = await this.destinationFor(ws, payee, input.destination, input.documentId);
    const policy = await this.evaluate(ws, {
      requestedBy: input.requestedBy,
      rail,
      amountMinor: input.amountMinor,
      currency: input.currency,
      usdMinor,
      payeeKnown: Boolean(payee),
      hasAccount: hasAccount(destination, rail),
      accountMismatch,
    });
    const status = policy.decision === "blocked" ? "blocked" : policy.decision === "auto" ? "executing" : "pending_approval";
    const payment = await this.store.addPayment(ws, {
      payeeId: payee?.id,
      payeeName,
      // Only an unsaved payee's details are stored with the payment; a saved payee is read at execution.
      ...(payee ? {} : { destination }),
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
    const verb = status === "executing" ? "executing payment" : "drafted payment";
    await this.store.log(ws, input.requestedBy, verb, `${payeeName}: ${fmt(input.amountMinor, input.currency)} (${policy.decision})`, { type: "payment", id: payment.id });
    if (status === "executing") void this.execute(ws, payment.id);
    return payment;
  }

  /** Human approval. Re-checks the policy: access or the payee may have changed since the draft. */
  async approve(ws: string, id: string, seen: ApprovalConfirmation): Promise<{ ok: true; payment: Payment } | { ok: false; error: string }> {
    const p = await this.store.payment(ws, id);
    if (!p) return { ok: false, error: "payment not found" };
    if (p.status !== "pending_approval" && p.status !== "blocked") return { ok: false, error: `payment is ${p.status}` };
    // The approval names what the person confirmed; a stale or blind approval does not pay.
    if (seen.amountMinor !== p.amountMinor || seen.currency !== p.currency) {
      return { ok: false, error: `This payment is ${fmt(p.amountMinor, p.currency)}, not what was confirmed. Nothing was paid; review it again.` };
    }
    const payee = p.payeeId ? await this.store.payee(ws, p.payeeId) : undefined;
    const destination = payee ? (clean(payee) ?? {}) : (p.destination ?? {});
    const policy = await this.evaluate(ws, {
      requestedBy: "user",
      rail: p.rail,
      amountMinor: p.amountMinor,
      currency: p.currency,
      usdMinor: p.usdMinor,
      payeeKnown: Boolean(payee),
      hasAccount: hasAccount(destination, p.rail),
    });
    if (policy.decision === "blocked" || !hasAccount(destination, p.rail)) {
      const reason = policy.checks.find(c => c.status === "fail")?.message ?? "Blocked by your policy";
      await this.store.updatePayment(ws, id, { status: policy.decision === "blocked" ? "blocked" : p.status, policy, error: `${reason}. Nothing was paid.`.replace(/\.\. /, ". ") });
      await this.store.log(ws, "system", "payment blocked", `${p.payeeName}: ${reason}`, { type: "payment", id });
      return { ok: false, error: reason };
    }
    // Atomic claim: of two approvals at once, only one starts the payment.
    if (!(await this.store.claimPayment(ws, id, ["pending_approval", "blocked"], "executing", new Date().toISOString()))) {
      return { ok: false, error: "payment was already decided" };
    }
    // A note from an earlier attempt (a restart, a timeout, a block) no longer applies.
    const payment = await this.store.updatePayment(ws, id, { policy, error: undefined });
    await this.store.log(ws, "user", p.error ? "approved payment again" : "approved payment", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)}`, { type: "payment", id });
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
    const key = `${ws}:${id}`;
    this.running.add(key); // synchronously, before the sweep could see the payment as cut off
    try {
      await this.executeOnce(ws, id);
    } catch (error) {
      console.error("payment execution failed", error);
      try {
        await this.store.updatePayment(ws, id, { status: "failed", error: "Internal error while executing; check the activity log before retrying" });
      } catch {
        // database unreachable: the run store still holds the outcome
      }
    } finally {
      this.running.delete(key);
    }
  }

  /**
   * Runs the payment through the payout engine: paid x402 verification report on Cardano, route to
   * the verified payee (this workspace's directory only). Fiat pays out within the platform caps;
   * tADA stops at "awaiting_signature" for the owner's wallet (prepareTransaction, submitSignature).
   */
  private async executeOnce(ws: string, id: string): Promise<void> {
    const p = (await this.store.payment(ws, id))!;
    const fail = async (error: string) => {
      await this.store.updatePayment(ws, id, { status: "failed", error });
      await this.store.log(ws, "system", "payment failed", `${p.payeeName}: ${error}`, { type: "payment", id });
    };
    // The account's own engine, signing with its own agent wallet: never PayLorya AI's.
    let agent: BuyerAgent;
    try {
      if (!this.wallets.agents) throw new Error("The payment engine is not configured on this server");
      agent = await this.wallets.agents.for(ws);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    const saved = p.payeeId ? await this.store.payee(ws, p.payeeId) : undefined;
    // The account paid to: the saved payee's, else the one shown in the approved draft.
    const payee = verifiedPayee({ name: saved?.name ?? p.payeeName, ...(saved ? clean(saved) : p.destination) });
    if (!hasAccount(payee, p.rail)) return fail("No account details to pay to");
    let fiat: FiatPayoutClient | undefined;
    let from: string | undefined;
    let agentPaysTada = false;
    try {
      if (p.rail === "cashxchain") fiat = await this.ownFiatRoute(ws);
      if (p.rail === "cardano_preprod") {
        const source = await this.tadaSource(ws);
        if (source.agent) agentPaysTada = true;
        else from = source.from;
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    // Everything that would stop it after the paid check, before the check is bought.
    const stop = await this.preflight(ws, p, agent, { ...(fiat ? { fiat } : {}), agentPaysTada });
    if (stop) return this.block(ws, p, stop);

    const invoice = invoiceFor(p, payee, saved?.country ?? p.destination?.country);
    // The idempotency key of the first attempt holds: a resumed payment must pay the very same.
    const key = payoutKey(payee, invoice);
    if (p.payoutKey && p.payoutKey !== key) {
      return fail("The payee or amount changed since an earlier attempt of this payment. Check your account for that attempt before paying again.");
    }
    const run = this.engine.runs.create(JSON.stringify(invoice));
    run.payees = [payee];
    if (fiat) agent.useFiatRoute(run, fiat);
    // A tADA payout the agent wallet makes is marked as such before anything is signed: its
    // transaction is recorded on signing (recordAgentPayout) and a restart is settled from the chain.
    const agentCardano: CardanoPayout | undefined =
      agentPaysTada && payee.cardanoAddress
        ? { from: (await this.wallets.agents?.wallet(ws))?.address ?? "", payTo: payee.cardanoAddress, lovelace: String(p.amountMinor), byAgent: true }
        : undefined;
    await this.store.updatePayment(ws, id, { runId: run.id, payoutKey: key, ...(agentCardano ? { cardano: agentCardano } : {}) });
    try {
      // The paid check runs before any payout; if it hangs (a facilitator or chain provider that does
      // not answer), the payment goes back to approval instead of staying "executing".
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">(resolve => (timer = setTimeout(() => resolve("late"), this.wallets.checkTimeoutMs ?? 5 * 60_000)));
      const checked = await Promise.race([agent.process(run).then(() => "done" as const), late]).finally(() => clearTimeout(timer));
      if (checked === "late") {
        if (await this.store.claimPayment(ws, id, ["executing"], "pending_approval")) {
          await this.store.updatePayment(ws, id, { error: CHECK_TIMED_OUT });
          await this.store.log(ws, "system", "payment check timed out", `${p.payeeName}: back to approval, nothing paid`, { type: "payment", id });
        }
        return;
      }
      if (run.payment) {
        const verification = { txHash: run.payment.transactionHash, explorerUrl: run.payment.explorerUrl, payer: run.payment.buyerAddress, ...(run.report?.verdict ? { verdict: run.report.verdict } : {}) };
        await this.store.updatePayment(ws, id, { verification });
      }
      if (run.state !== "DRAFT_READY" || !run.draft?.executable) return fail(explain(run));
      if (from) {
        const route = run.draft.route;
        if (route.rail !== "cardano_preprod" || !route.destination) return fail("No Cardano route to the payee");
        const cardano: CardanoPayout = {
          from,
          payTo: route.destination,
          lovelace: String(p.amountMinor),
        };
        await this.store.updatePayment(ws, id, { status: "awaiting_signature", cardano, error: undefined });
        await this.store.log(ws, "system", "payment awaiting signature", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)} verified on Cardano; sign it in your wallet`, { type: "payment", id });
        return;
      }
      const approved = agent.approve(run);
      if (!approved.ok) return fail(`${approved.reason}. Nothing was paid.`.replace(/\.\. /, ". "));
      await approved.done;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    // Re-read: approve() moved the run on after the DRAFT_READY check above.
    const final = stateOf(run);
    if (final === "PAYOUT_UNKNOWN" && agentCardano && (await this.store.payment(ws, id))?.cardano?.submitted) {
      // Sent by the agent wallet, outcome unclear: stays "executing"; the sweep settles it from the chain.
      await this.store.updatePayment(ws, id, { error: "Sent; waiting for the Cardano network to confirm it." });
      return;
    }
    if (final !== "EXECUTED" || !run.payout) {
      return fail(
        final === "PAYOUT_UNKNOWN"
          ? `The payout was sent, but its outcome is not confirmed yet: check your account before paying again. ${run.error ?? ""}`.trim()
          : explain(run),
      );
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
    await this.booked(ws, p, payout.executedAt);
    await this.store.log(ws, "system", "payment executed", `${p.payeeName}: ${fmt(p.amountMinor, p.currency)}${payout.reference ? ` (${payout.reference})` : ""}`, {
      type: "payment",
      id,
    });
  }
}

const stateOf = (run: Run): Run["state"] => run.state;

/**
 * Why a run stopped, in words a person can act on: the verification report's failing checks, the
 * route's reason, or the error. Never a bare state name.
 */
export function explain(run: Run): string {
  if (run.error) return run.error;
  const report = run.report;
  if (report && report.verdict !== "ready_for_review") {
    const fails = report.checks.filter(c => c.status === "fail").map(c => c.message);
    const issues = fails.length ? fails : report.checks.filter(c => c.status !== "pass").map(c => c.message);
    const what = report.verdict === "needs_info" ? "needs more information" : "did not clear this payment";
    return `The verification on Cardano ${what}${issues.length ? `: ${issues.join("; ")}` : ""}. Nothing was paid.`;
  }
  const route = run.route ?? run.draft?.route;
  if (route && route.status !== "selected") return `${route.reason}. Nothing was paid.`;
  const note = run.timeline.at(-1)?.note;
  if (note && !/^(blocked|needs_info|ready_for_review)$/.test(note)) return `${note}. Nothing was paid.`.replace(/\.\. /, ". ");
  return `The payment stopped (${run.state.toLowerCase().replace(/_/g, " ")}). Nothing was paid.`;
}

export function findPayeeByName(payees: Payee[], name?: string): Payee | undefined {
  if (!name) return undefined;
  const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return payees.find(p => p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === key);
}

/** Account fields only, normalised; undefined when none is set. */
function clean(d: Destination | Payee | undefined): Destination | undefined {
  if (!d) return undefined;
  const out: Destination = {
    ...(d.country ? { country: d.country.toUpperCase() } : {}),
    ...(d.iban ? { iban: normalizeIban(d.iban) } : {}),
    ...(d.bic ? { bic: d.bic.replace(/\s+/g, "").toUpperCase() } : {}),
    ...(d.routingNumber ? { routingNumber: d.routingNumber.replace(/\D/g, "") } : {}),
    ...(d.accountNumber ? { accountNumber: d.accountNumber.replace(/\s+/g, "") } : {}),
    ...(d.accountType ? { accountType: d.accountType } : {}),
    ...(d.cardanoAddress ? { cardanoAddress: d.cardanoAddress.replace(/\s+/g, "") } : {}),
  };
  return out.iban || out.routingNumber || out.accountNumber || out.cardanoAddress ? out : undefined;
}

/** True when the destination can receive on this rail: a wallet for tADA, bank details for fiat. */
export function hasAccount(d: Destination, rail: Rail): boolean {
  if (rail === "cardano_preprod") return Boolean(d.cardanoAddress);
  return Boolean(d.iban || (d.routingNumber && d.accountNumber));
}

function differs(a: Destination, b: Destination): boolean {
  return (["iban", "routingNumber", "accountNumber", "cardanoAddress"] as const).some(k => a[k] !== undefined && a[k] !== b[k]);
}

function verifiedPayee(d: Destination & { name: string }): VerifiedPayee {
  const c = clean(d) ?? {};
  return {
    name: d.name,
    ...(c.iban ? { iban: c.iban } : {}),
    ...(c.bic ? { bic: c.bic } : {}),
    ...(c.routingNumber ? { routingNumber: c.routingNumber } : {}),
    ...(c.accountNumber ? { accountNumber: c.accountNumber } : {}),
    ...(c.accountType ? { accountType: c.accountType } : {}),
    ...(c.cardanoAddress ? { cardanoAddress: c.cardanoAddress } : {}),
  };
}

/** The payment as an invoice for the payout engine, paying exactly the given account. */
function invoiceFor(p: Payment, v: VerifiedPayee, country?: string): Invoice {
  const cc = country?.toUpperCase() ?? v.iban?.slice(0, 2) ?? (v.routingNumber ? "US" : "DE");
  return {
    id: `CFO-${p.id.slice(0, 8).toUpperCase()}`,
    supplier: v.name,
    destinationCountry: cc,
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
