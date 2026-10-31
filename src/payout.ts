import { createHash } from "node:crypto";
import { toFacilitatorCardanoSigner } from "@x402/cardano";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";
import type { Invoice } from "./types.js";

/** Broadcasts a buyer-signed payout transaction. */
export interface ChainSubmitter {
  submit(signedTxBase64: string): Promise<{ txHash: string; status: "confirmed" | "mempool" }>;
}

/**
 * Provider-only submitter (no keys): Blockfrost broadcast, then waits up to 2 min for the tx.
 * A timeout after broadcast still returns the hash, as `mempool`.
 */
export function blockfrostSubmitter(config: Config): ChainSubmitter {
  const chain = toFacilitatorCardanoSigner({ network: CARDANO_NETWORK, provider: blockfrostProvider(config, 120_000) });
  return { submit: tx => chain.submitTransaction(tx, CARDANO_NETWORK) };
}

/** Fiat payout rail. A real client must be idempotent per key: the agent never retries it blindly. */
export interface FiatPayoutClient {
  readonly simulated: boolean;
  readonly label: string;
  payout(request: { idempotencyKey: string; invoice: Invoice; destination: string }): Promise<{ reference: string }>;
}

/**
 * Stand-in for the CashXChain sandbox payout API until its contract is wired in.
 * Moves no money and calls nothing; the reference is derived from the idempotency key.
 */
export const simulatedCxcPayouts: FiatPayoutClient = {
  simulated: true,
  label: "Simulated CashXChain payout: no bank transfer, no CashXChain API call",
  async payout({ idempotencyKey }) {
    return { reference: `cxc_sim_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16)}` };
  },
};
