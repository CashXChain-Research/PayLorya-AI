import { Address, Assets, Client, preprod, Transaction } from "@evolution-sdk/evolution";
import { decodeCardanoTransaction, type ClientCardanoSigner, type ClientCardanoSignInput, type ClientCardanoSignResult } from "@x402/cardano";

/** The chain PayLorya AI pays on. A workspace wallet signs for this network only. */
export const WALLET_NETWORK = "cardano:preprod";

/** A payout transaction before the customer's wallet signed it (CIP-30 signTx takes `cborHex`). */
export interface UnsignedTx {
  cborHex: string;
  txHash: string;
  /** First input (`txHash#index`): the x402 signer contract's nonce. */
  nonce: string;
}

/**
 * Builds a tADA payout from a wallet address (its UTxOs, change back to it), and adds the wallet's
 * signatures afterwards. No key is involved: the customer's wallet signs. Tests inject a stub.
 */
export interface TxKit {
  build(from: string, payTo: string, lovelace: bigint, ttlMs: number): Promise<UnsignedTx>;
  /** The signed transaction as base64, as the agent's submitter takes it. Throws for a malformed witness set. */
  assemble(unsignedCborHex: string, witnessSetHex: string): string;
}

/** The Evolution SDK (the builder @x402/cardano uses) over Blockfrost, on Cardano Preprod. */
export function evolutionKit(blockfrost: { baseUrl: string; projectId: string }): TxKit {
  const chain = Client.make(preprod).withBlockfrost(blockfrost);
  return {
    async build(from, payTo, lovelace, ttlMs) {
      const result = await chain
        .withAddress(from)
        .newTx()
        .payToAddress({ address: Address.fromBech32(payTo), assets: Assets.fromLovelace(lovelace) })
        .setValidity({ to: BigInt(ttlMs) })
        .build({ changeAddress: Address.fromBech32(from) });
      const cborHex = Transaction.toCBORHex(await result.toTransaction());
      const decoded = decodeCardanoTransaction(Buffer.from(cborHex, "hex").toString("base64"));
      return { cborHex, txHash: decoded.txHash, nonce: decoded.inputs[0] ?? "" };
    },
    assemble(unsignedCborHex, witnessSetHex) {
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(witnessSetHex)) throw new Error("The wallet returned no signature");
      // Splices the witnesses in and keeps the body bytes as built: the hash the wallet signed stays valid.
      return Buffer.from(Transaction.addVKeyWitnessesHex(unsignedCborHex, witnessSetHex), "hex").toString("base64");
    },
  };
}

/**
 * The agent's signer for a payout from the customer's own wallet: it builds the transaction, hands it
 * to `sign` (the customer's wallet popup, CIP-30 signTx) and returns it with the wallet's witnesses.
 * Only plain lovelace transfers on Cardano Preprod; anything else is refused before building.
 */
export function walletSigner(opts: { address: string; kit: TxKit; sign: (tx: UnsignedTx) => Promise<string> }): ClientCardanoSigner {
  return {
    getAddress: () => opts.address,
    async buildAndSignPaymentTransaction(input: ClientCardanoSignInput): Promise<ClientCardanoSignResult> {
      if (input.network !== WALLET_NETWORK) throw new Error(`This wallet pays on Cardano Preprod only, not ${input.network}`);
      if (input.asset !== "lovelace") throw new Error("This wallet pays tADA (lovelace) only");
      const method = (input.extra as { assetTransferMethod?: unknown } | undefined)?.assetTransferMethod;
      if (method !== undefined && method !== "default") throw new Error("This wallet makes plain transfers only");
      const unsigned = await opts.kit.build(opts.address, input.payTo, BigInt(input.amount), Date.now() + input.maxTimeoutSeconds * 1000);
      const witnesses = await opts.sign(unsigned);
      return { transaction: opts.kit.assemble(unsigned.cborHex, witnesses), nonce: unsigned.nonce };
    },
  };
}
