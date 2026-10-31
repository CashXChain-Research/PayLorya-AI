import { createHash } from "node:crypto";
import { toFacilitatorCardanoSigner } from "@x402/cardano";
import { z } from "zod";
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

export interface TxOutput {
  address: string;
  lovelace: bigint;
}

/** Read-only chain access: wallet sync between two transactions, and resolving unknown outcomes. */
export interface ChainView {
  /** True once the provider has indexed the transaction. */
  hasTransaction(txHash: string): Promise<boolean>;
  /** Outputs of an indexed tx (collateral outputs left out); undefined while not indexed. Without it, unknown outcomes stay unknown. */
  txOutputs?(txHash: string): Promise<TxOutput[] | undefined>;
  /** Slot of the provider's latest indexed block. Without it, an unknown tx is never proven expired. */
  tipSlot?(): Promise<bigint>;
}

// GET /txs/{hash}/utxos (Blockfrost OpenAPI tx_content_utxo): quantities are decimal strings.
const BlockfrostTxUtxos = z.object({
  outputs: z.array(
    z.object({
      address: z.string(),
      amount: z.array(z.object({ unit: z.string(), quantity: z.string().regex(/^\d+$/) })),
      collateral: z.boolean().optional(),
    }),
  ),
});
// GET /blocks/latest (block_content): slot is nullable there; null fails the parse.
const BlockfrostTip = z.object({ slot: z.number().int().nonnegative() });

/** Blockfrost lookups, same contract as the SDK's: 404 = not indexed, any other error throws. */
export function blockfrostChainView(config: Config): ChainView {
  const { blockfrost } = blockfrostProvider(config);
  const base = blockfrost.baseUrl.replace(/\/$/, "");
  // 2xx: the response; 404: undefined (not indexed); anything else throws.
  const get = async (path: string): Promise<Response | undefined> => {
    const response = await fetch(`${base}${path}`, { headers: { project_id: blockfrost.projectId }, signal: AbortSignal.timeout(10_000) });
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 404) return undefined;
    throw new Error(`Blockfrost ${path} failed: ${response.status}`);
  };
  return {
    async hasTransaction(txHash) {
      const response = await get(`/txs/${txHash}`);
      await response?.body?.cancel();
      return response !== undefined;
    },
    async txOutputs(txHash) {
      const response = await get(`/txs/${txHash}/utxos`);
      if (!response) return undefined;
      return BlockfrostTxUtxos.parse(await response.json())
        .outputs.filter(o => o.collateral !== true)
        .map(o => {
          const coin = o.amount.find(a => a.unit === "lovelace");
          if (!coin) throw new Error(`Blockfrost /txs/${txHash}/utxos: output without lovelace`);
          return { address: o.address, lovelace: BigInt(coin.quantity) };
        });
    },
    async tipSlot() {
      const response = await get("/blocks/latest");
      if (!response) throw new Error("Blockfrost /blocks/latest: no tip");
      return BigInt(BlockfrostTip.parse(await response.json()).slot);
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
