import { createHash } from "node:crypto";
import { toFacilitatorCardanoSigner } from "@x402/cardano";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";
import type { VerifiedPayee } from "./routing.js";
import type { Invoice } from "./types.js";

/** Broadcasts a buyer-signed payout transaction. */
export interface ChainSubmitter {
  submit(signedTxBase64: string): Promise<{ txHash: string; status: "confirmed" | "mempool" }>;
  /** True only when the error proves the tx was never broadcast. Anything else stays ambiguous. */
  isDefinitiveRejection?(error: unknown): boolean;
}

/**
 * Blockfrost answers 400 when the node refuses the tx before its mempool (e.g. a spent input): it was
 * not broadcast and no one else holds it. Timeouts, 5xx and transport errors stay ambiguous. The SDK's
 * reference signer leaves its `isDefinitiveSubmissionRejection` hook unimplemented, hence our own.
 */
export function isDefinitiveSubmitRejection(error: unknown): boolean {
  return error instanceof Error && /^Blockfrost submitTx failed: 400\b/.test(error.message);
}

/**
 * Provider-only submitter (no keys): Blockfrost broadcast, then waits up to 2 min for the tx.
 * A timeout after broadcast still returns the hash, as `mempool`.
 */
export function blockfrostSubmitter(config: Config): ChainSubmitter {
  const chain = toFacilitatorCardanoSigner({ network: CARDANO_NETWORK, provider: blockfrostProvider(config, 120_000) });
  return { submit: tx => chain.submitTransaction(tx, CARDANO_NETWORK), isDefinitiveRejection: isDefinitiveSubmitRejection };
}

/** Read-only chain access the agent needs between two transactions from the same wallet. */
export interface ChainView {
  /** True once the provider has indexed the transaction. */
  hasTransaction(txHash: string): Promise<boolean>;
}

/** Same lookup as the SDK's evidence check: GET /txs/{hash}, 404 while not indexed. */
export function blockfrostChainView(config: Config): ChainView {
  const { blockfrost } = blockfrostProvider(config);
  const base = blockfrost.baseUrl.replace(/\/$/, "");
  return {
    async hasTransaction(txHash) {
      const response = await fetch(`${base}/txs/${txHash}`, { headers: { project_id: blockfrost.projectId }, signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`Blockfrost /txs/${txHash} failed: ${response.status}`);
      return true;
    },
  };
}

export interface FiatPayoutRequest {
  /** Stable per invoice (`payout-<fingerprint>`): a retry or a restart can never pay twice. */
  idempotencyKey: string;
  invoice: Invoice;
  /** Display form of the verified destination. */
  destination: string;
  /** The verified payee record: the only source of beneficiary name and bank details. */
  payee: VerifiedPayee;
}

/** Fiat payout rail. A real client must be idempotent per key: the agent never retries it blindly. */
export interface FiatPayoutClient {
  readonly simulated: boolean;
  readonly label: string;
  payout(request: FiatPayoutRequest): Promise<{ reference: string }>;
  /** True only when the error proves nothing was sent (refused before or by the payout POST). */
  isDefinitiveRejection?(error: unknown): boolean;
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
