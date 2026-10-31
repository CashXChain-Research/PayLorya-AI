import { Address, AddressEras, Assets, CBOR, Client, preprod, Transaction, TransactionInput, TransactionOutput, UTxO } from "@evolution-sdk/evolution";
import { decodeCardanoTransaction, toFacilitatorCardanoSigner } from "@x402/cardano";
import { isDefinitiveSubmitRejection } from "../payout.js";

/** The chain PayLorya AI pays on. A workspace wallet pays on this network only. */
export const WALLET_NETWORK = "cardano:preprod";

/** How long a built payout stays valid on chain: the owner signs within this window. */
export const TX_VALIDITY_MS = 10 * 60_000;

/** What the owner's wallet reports through CIP-30 when it is asked to pay. */
export interface WalletFunds {
  /** `getUtxos()`: hex CBOR `[input, output]` pairs. */
  utxos: string[];
  /** `getChangeAddress()` as bech32. */
  changeAddress: string;
}

/** A payout transaction before the owner's wallet signed it (CIP-30 signTx takes `cborHex`). */
export interface UnsignedTx {
  cborHex: string;
  txHash: string;
  /** Unix ms after which the chain refuses it. */
  validUntil: number;
}

/** The wallet does not hold enough tADA: refused before anything is built or signed. */
export class InsufficientFunds extends Error {}

/**
 * Builds, completes and broadcasts payouts from the owner's own wallet. No key is ever involved:
 * the wallet signs in the browser. Tests inject a stub; production uses `evolutionKit`.
 */
export interface TxKit {
  /** A plain lovelace transfer from the wallet's UTxOs, change back to the wallet. */
  build(input: { payTo: string; lovelace: bigint; funds: WalletFunds; validUntil: number }): Promise<UnsignedTx>;
  /** The transaction with the wallet's witnesses, base64. Throws for a malformed witness set. */
  assemble(unsignedCborHex: string, witnessSetHex: string): string;
  /** Hands the signed transaction to the network; resolves with its hash once a node accepted it. */
  submit(signedBase64: string): Promise<string>;
  /** True only when the error proves the transaction never reached a mempool. */
  isDefinitiveRejection(error: unknown): boolean;
  /** True once the transaction is in a block. */
  confirmed(txHash: string): Promise<boolean>;
  /** Unix ms of the newest block the provider has indexed: how far its view of the chain reaches. */
  tipTime(): Promise<number>;
}

const ADA = (lovelace: bigint) => `${(Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} tADA`;
/** Headroom for the network fee and the change output's minimum. */
const FEE_MARGIN = 1_000_000n;

/** The Evolution SDK (the builder @x402/cardano uses) with Blockfrost, on Cardano Preprod. */
export function evolutionKit(blockfrost: { baseUrl: string; projectId: string }): TxKit {
  const chain = Client.make(preprod).withBlockfrost(blockfrost);
  // Submits without waiting for a block: confirmation is followed separately (Payments.sweep).
  const network = toFacilitatorCardanoSigner({ network: WALLET_NETWORK, provider: { blockfrost }, awaitConfirmation: false });
  const base = blockfrost.baseUrl.replace(/\/$/, "");
  return {
    async build({ payTo, lovelace, funds, validUntil }) {
      const utxos = funds.utxos.map(walletUtxo).filter((u): u is UTxO.UTxO => u !== undefined);
      const held = utxos.reduce((sum, u) => sum + Assets.lovelaceOf(u.assets), 0n);
      if (held < lovelace + FEE_MARGIN) {
        throw new InsufficientFunds(`Your wallet holds ${ADA(held)}; this payout needs ${ADA(lovelace)} plus about 0.2 tADA network fee. Top it up from the Preprod faucet.`);
      }
      const result = await chain
        .newTx()
        .payToAddress({ address: Address.fromBech32(payTo), assets: Assets.fromLovelace(lovelace) })
        .setValidity({ to: BigInt(validUntil) })
        .build({ changeAddress: Address.fromBech32(funds.changeAddress), availableUtxos: utxos });
      const cborHex = Transaction.toCBORHex(await result.toTransaction());
      return { cborHex, txHash: decodeCardanoTransaction(Buffer.from(cborHex, "hex").toString("base64")).txHash, validUntil };
    },
    assemble(unsignedCborHex, witnessSetHex) {
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(witnessSetHex)) throw new Error("The wallet returned no signature");
      // Splices the witnesses in and keeps the body bytes as built: the hash the wallet signed stays valid.
      return Buffer.from(Transaction.addVKeyWitnessesHex(unsignedCborHex, witnessSetHex), "hex").toString("base64");
    },
    async submit(signedBase64) {
      return (await network.submitTransaction(signedBase64, WALLET_NETWORK)).txHash;
    },
    isDefinitiveRejection: isDefinitiveSubmitRejection,
    async confirmed(txHash) {
      const res = await fetch(`${base}/txs/${txHash}`, { headers: { project_id: blockfrost.projectId }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`Blockfrost answered ${res.status}`);
      return true;
    },
    async tipTime() {
      const res = await fetch(`${base}/blocks/latest`, { headers: { project_id: blockfrost.projectId }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Blockfrost answered ${res.status}`);
      const time = ((await res.json()) as { time?: unknown }).time;
      if (typeof time !== "number") throw new Error("Blockfrost returned no block time");
      return time * 1000;
    },
  };
}

/**
 * One CIP-30 `getUtxos()` entry (hex CBOR `[transaction_input, transaction_output]`). Outputs that
 * carry a datum or a reference script are left out: a plain payout never needs to spend them.
 */
export function walletUtxo(hex: string): UTxO.UTxO | undefined {
  let decoded: unknown;
  try {
    decoded = CBOR.fromCBORHex(hex);
  } catch {
    throw new Error("The wallet reported funds this server cannot read");
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error("The wallet reported funds this server cannot read");
  const input = TransactionInput.fromCBORBytes(CBOR.toCBORBytes(decoded[0]));
  const output = TransactionOutput.fromCBORBytes(CBOR.toCBORBytes(decoded[1]));
  if (output._tag === "BabbageTransactionOutput" ? output.datumOption || output.scriptRef : output.datumHash) return undefined;
  const amount = output.amount;
  return new UTxO.UTxO({
    transactionId: input.transactionId,
    index: input.index,
    address: Address.fromBytes(AddressEras.toBytes(output.address)),
    assets: amount._tag === "WithAssets" ? Assets.withMultiAsset(amount.coin, amount.assets) : Assets.fromLovelace(amount.coin),
  });
}

/** CIP-30 returns addresses as hex bytes; the API and the database use bech32. */
export function bech32FromHex(hex: string): string {
  return Address.toBech32(Address.fromHex(hex));
}
