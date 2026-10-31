import type { ClientCardanoSignInput, ClientCardanoSignResult } from "@x402/cardano";
import type { BuyerAgent } from "../agent.js";
import type { CxcKeys } from "./cxc-keys.js";
import type { ConnectionRow, Store } from "./store.js";

export const NEEDS_AGENT_WALLET =
  "Connect your agent wallet (Cardano Preprod) with its recovery phrase on the Connections page: it pays the verification on Cardano before every payout";

export const AGENT_WALLET_READ_ONLY = "Your agent wallet is read-only: allow read & write on the Connections page so it can pay";

export const PHRASE_UNREADABLE =
  "The agent wallet's recovery phrase cannot be read anymore (the server secret changed). Remove the agent wallet and connect it again.";

/**
 * One payout engine per account, signing with the account's own agent wallet: the x402 verification
 * on Cardano and tADA payouts. Never PayLorya AI's wallet (BUYER_MNEMONIC), which serves the public
 * demo only. Each engine has its own wallet queue, ledgers and session budget.
 */
/** Called after the agent wallet signed a tADA payout and before it is sent: record it first. */
export type PayoutSigned = (ws: string, input: ClientCardanoSignInput, signed: ClientCardanoSignResult) => Promise<void>;

export class WorkspaceAgents {
  private readonly cache = new Map<string, { connectionId: string; agent: BuyerAgent }>();
  /** Set by Payments: a signed payout is stored before the agent broadcasts it (restart-safe). */
  onPayoutSigned?: PayoutSigned;

  constructor(
    private readonly store: Store,
    private readonly keys: CxcKeys,
    /**
     * Builds the engine for a recovery phrase: production signs with @x402/cardano on Preprod.
     * `signed` must be awaited after signing a payout (not an x402 fee) and before it is sent.
     */
    private readonly make: (recoveryPhrase: string, signed: (input: ClientCardanoSignInput, out: ClientCardanoSignResult) => Promise<void>) => BuyerAgent,
  ) {}

  /** The account's agent wallet: its own, connected with a recovery phrase. */
  async wallet(ws: string): Promise<ConnectionRow | undefined> {
    return (await this.store.connections(ws)).find(c => c.kind === "cardano_agent_wallet" && c.credentialHint && c.address);
  }

  /** The account's payout engine. Throws NEEDS_AGENT_WALLET without an agent wallet of its own. */
  async for(ws: string): Promise<BuyerAgent> {
    const wallet = await this.wallet(ws);
    if (!wallet) throw new Error(NEEDS_AGENT_WALLET);
    if (wallet.access !== "read_write") throw new Error(AGENT_WALLET_READ_ONLY);
    const cached = this.cache.get(ws);
    if (cached?.connectionId === wallet.id) return cached.agent;
    const phrase = await this.keys.open(ws, wallet, PHRASE_UNREADABLE);
    if (!phrase) throw new Error(NEEDS_AGENT_WALLET);
    const agent = this.make(phrase, (input, out) => this.onPayoutSigned?.(ws, input, out) ?? Promise.resolve());
    this.cache.set(ws, { connectionId: wallet.id, agent });
    return agent;
  }
}
