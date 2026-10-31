import { decodeCardanoTransaction, type ClientCardanoSigner } from "@x402/cardano";
import type { Funding, Store } from "./store.js";
import type { TxKit } from "./wallet-signer.js";

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const tada = (lovelace: bigint) => `${(Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} tADA`;
const dayStart = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface FunderOptions {
  /** The platform's funding wallet (FUNDER_MNEMONIC): it only ever tops up agent wallets. */
  signer: ClientCardanoSigner;
  kit: Pick<TxKit, "submit" | "isDefinitiveRejection" | "confirmed" | "balance">;
  lovelace: bigint;
  dailyGrants: number;
  explorerTxUrl?: string;
  /** How long a grant waits for the previous one to reach a block (its UTxOs). Tests: short. */
  settleMs?: number;
}

export interface FundingStatus {
  /** A grant can be asked for now. */
  available: boolean;
  lovelace: string;
  granted?: Funding & { explorerUrl?: string };
  /** Why not, when not available. */
  reason?: string;
}

/**
 * "Get test tADA": tops up an account's own agent wallet once from PayLorya AI's funding wallet, so
 * new accounts start without the Preprod faucet (rate limited). It never pays anything else: every
 * payment still leaves from the account's own wallet. Once per account, a daily cap over all
 * accounts, and one grant in flight at a time (two transactions from one wallet would pick the same
 * UTxO).
 */
export class Funder {
  private queue: Promise<unknown> = Promise.resolve();
  private lastTx?: string;

  constructor(
    private readonly store: Store,
    private readonly opts: FunderOptions,
  ) {}

  get address(): string {
    return this.opts.signer.getAddress();
  }

  private link(f: Funding): Funding & { explorerUrl?: string } {
    return f.txHash && this.opts.explorerTxUrl ? { ...f, explorerUrl: `${this.opts.explorerTxUrl}${f.txHash}` } : f;
  }

  /** The account's agent wallet address, if it has its own (recovery phrase), read & write or not. */
  private async agentWallet(ws: string): Promise<string | undefined> {
    return (await this.store.connections(ws)).find(c => c.kind === "cardano_agent_wallet" && c.credentialHint && c.address)?.address;
  }

  async status(ws: string): Promise<FundingStatus> {
    const lovelace = this.opts.lovelace.toString();
    const workspace = await this.store.workspace(ws);
    if (workspace?.funding) return { available: false, lovelace, granted: this.link(workspace.funding), reason: "This account already received its test tADA" };
    if (!(await this.agentWallet(ws))) return { available: false, lovelace, reason: "Connect your agent wallet first" };
    if ((await this.store.fundingGrantsSince(dayStart())) >= this.opts.dailyGrants) return { available: false, lovelace, reason: "Today's test tADA is used up" };
    return { available: true, lovelace };
  }

  /** Sends the account's one grant to its agent wallet. */
  async grant(ws: string): Promise<Result<Funding & { explorerUrl?: string }>> {
    const amount = this.opts.lovelace;
    const workspace = await this.store.workspace(ws);
    if (workspace?.funding) {
      return refuse(409, `This account already received its ${tada(amount)}${workspace.funding.txHash ? ` (transaction ${workspace.funding.txHash.slice(0, 10)}…)` : ""}. For more, use the Cardano Preprod faucet.`);
    }
    const address = await this.agentWallet(ws);
    if (!address) return refuse(409, "Connect your agent wallet (recovery phrase) first: test tADA goes to that wallet only.");
    if ((await this.store.fundingGrantsSince(dayStart())) >= this.opts.dailyGrants) {
      return refuse(429, "Today's test tADA is used up. Try again tomorrow, or use the Cardano Preprod faucet.");
    }
    const held = await this.opts.kit.balance(this.address).catch(() => undefined);
    if (held !== undefined && held < amount + 1_000_000n) {
      return refuse(503, "The test tADA supply is empty right now. Use the Cardano Preprod faucet, or try again later.");
    }
    // Claimed before anything is signed: a double click or a second tab gets one grant, not two.
    const claim: Funding = { address, lovelace: amount.toString(), at: new Date().toISOString(), status: "sending" };
    if (!(await this.store.claimFunding(ws, claim))) return refuse(409, `This account already received its ${tada(amount)}. For more, use the Cardano Preprod faucet.`);
    const turn = this.queue.then(() => this.send(ws, claim));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async send(ws: string, claim: Funding): Promise<Result<Funding & { explorerUrl?: string }>> {
    // The previous grant's change is this one's input: wait until it is in a block (bounded).
    if (this.lastTx) {
      const until = Date.now() + (this.opts.settleMs ?? 90_000);
      while (Date.now() < until && !(await this.opts.kit.confirmed(this.lastTx).catch(() => false))) await sleep(Math.min(3_000, this.opts.settleMs ?? 3_000));
    }
    let signed: string;
    try {
      signed = (
        await this.opts.signer.buildAndSignPaymentTransaction({
          network: "cardano:preprod",
          payTo: claim.address,
          asset: "lovelace",
          amount: claim.lovelace,
          maxTimeoutSeconds: 600,
          extra: { assetTransferMethod: "default" },
        })
      ).transaction;
    } catch (error) {
      await this.store.setFunding(ws, null); // nothing signed: the account may ask again
      return refuse(502, `The test tADA could not be prepared: ${error instanceof Error ? error.message : String(error)}. Try again in a minute.`);
    }
    const txHash = decodeCardanoTransaction(signed).txHash;
    const sending: Funding = { ...claim, txHash };
    await this.store.setFunding(ws, sending);
    try {
      await this.opts.kit.submit(signed);
    } catch (error) {
      if (this.opts.kit.isDefinitiveRejection(error)) {
        await this.store.setFunding(ws, null); // refused before any mempool: nothing was sent
        return refuse(502, "The network refused the test tADA transaction, nothing was sent. Try again in a minute.");
      }
      // It may have gone out: keep the grant (no second one), it shows its transaction.
    }
    this.lastTx = txHash;
    const sent: Funding = { ...sending, status: "sent" };
    await this.store.setFunding(ws, sent);
    await this.store.log(ws, "system", "received test tADA", `${tada(BigInt(claim.lovelace))} to the agent wallet (${txHash})`, { type: "connection", id: claim.address });
    return { ok: true, value: this.link(sent) };
  }
}
