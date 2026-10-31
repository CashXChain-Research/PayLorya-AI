import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Address, Client, preprod, Transaction, TransactionWitnessSet } from "@evolution-sdk/evolution";
import { addressFromSeed } from "@evolution-sdk/evolution/sdk/wallet/Derivation";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { decodeCardanoTransaction } from "@x402/cardano";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { bech32FromHex, evolutionKit, InsufficientFunds, walletUtxo } from "../src/cfo/wallet-signer.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

/** Blockfrost as the builder reads it: protocol parameters. The wallet's UTxOs come from the wallet. */
async function fakeBlockfrost() {
  const seen: string[] = [];
  const app = express();
  app.use((req, _res, next) => (seen.push(`${req.method} ${req.path}`), next()));
  app.get("/epochs/latest/parameters", (_req, res) =>
    void res.json({
      min_fee_a: "44", min_fee_b: "155381", pool_deposit: "500000000", key_deposit: "2000000", max_tx_size: "16384", max_val_size: "5000",
      max_block_size: "90112", coins_per_utxo_size: "4310", collateral_percent: "150", max_collateral_inputs: "3", price_mem: "0.0577", price_step: "0.0000721",
      max_tx_ex_mem: "14000000", max_tx_ex_steps: "10000000000", min_fee_ref_script_cost_per_byte: "15",
    }),
  );
  app.get("/txs/:hash", (req, res) => void (req.params.hash === "a".repeat(64) ? res.json({ hash: req.params.hash, block: "b" }) : res.status(404).json({ status_code: 404 })));
  app.use((req, res) => void res.status(404).json({ status_code: 404, error: "Not Found", message: req.path }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

/** A CIP-30 getUtxos() entry: hex CBOR [[tx_hash, index], [address, coin]]. */
function cip30Utxo(txHash: string, index: number, address: string, lovelace: number): string {
  const addr = Address.toHex(Address.fromBech32(address));
  const coin = lovelace.toString(16).padStart(8, "0");
  return `82825820${txHash}${index.toString(16).padStart(2, "0")}825839${addr}1a${coin}`;
}

function wallet() {
  const mnemonic = generateMnemonic(wordlist, 256);
  const address = Address.toBech32(addressFromSeed(mnemonic, { networkId: 0 }).address);
  return { mnemonic, address };
}

describe("tADA payout from the owner's own wallet (CIP-30)", () => {
  it("builds from the funds the wallet reports; the wallet's signature is spliced in without touching the body", async () => {
    const owner = wallet();
    const payTo = wallet().address;
    const bf = await fakeBlockfrost();
    const kit = evolutionKit({ baseUrl: bf.url, projectId: "preprodTest" });
    const utxos = [cip30Utxo("1".repeat(64), 0, owner.address, 30_000_000), cip30Utxo("2".repeat(64), 3, owner.address, 20_000_000)];
    expect(bech32FromHex(Address.toHex(Address.fromBech32(owner.address)))).toBe(owner.address);

    const unsigned = await kit.build({ payTo, lovelace: 5_000_000n, funds: { utxos, changeAddress: owner.address }, validUntil: Date.now() + 600_000 });
    const decodedUnsigned = decodeCardanoTransaction(Buffer.from(unsigned.cborHex, "hex").toString("base64"));
    expect(decodedUnsigned.txHash).toBe(unsigned.txHash);
    expect(decodedUnsigned.inputs.every(i => i.startsWith("1".repeat(64)) || i.startsWith("2".repeat(64)))).toBe(true);

    // The wallet signs as a CIP-30 wallet does: a witness set for the inputs it controls.
    const signer = Client.make(preprod).withSeed({ mnemonic: owner.mnemonic });
    const witnessSet = TransactionWitnessSet.toCBORHex(await signer.signTx(unsigned.cborHex, { utxos: utxos.map(u => walletUtxo(u)!) }));
    const signed = kit.assemble(unsigned.cborHex, witnessSet);

    expect(decodeCardanoTransaction(signed).txHash).toBe(unsigned.txHash);
    const tx = Transaction.fromCBORBytes(Buffer.from(signed, "base64"));
    expect(tx.witnessSet.vkeyWitnesses?.length).toBe(1);
    // The payee first, the change back to the wallet.
    expect(tx.body.outputs.map(o => Address.toBech32(o.address))).toEqual([payTo, owner.address]);
    // Only protocol parameters came from Blockfrost; the funds came from the wallet.
    expect(bf.seen.some(s => s.includes("/utxos"))).toBe(false);
  });

  it("refuses before building when the wallet holds too little, and reads confirmations", async () => {
    const owner = wallet();
    const bf = await fakeBlockfrost();
    const kit = evolutionKit({ baseUrl: bf.url, projectId: "preprodTest" });
    const err = await kit
      .build({ payTo: wallet().address, lovelace: 5_000_000n, funds: { utxos: [cip30Utxo("1".repeat(64), 0, owner.address, 5_500_000)], changeAddress: owner.address }, validUntil: Date.now() + 600_000 })
      .catch(e => e);
    expect(err).toBeInstanceOf(InsufficientFunds);
    expect(err.message).toMatch(/holds 5\.5 tADA; this payout needs 5 tADA/);
    expect(bf.seen).toEqual([]);
    expect(await kit.confirmed("a".repeat(64))).toBe(true);
    expect(await kit.confirmed("c".repeat(64))).toBe(false);
  });

  it("a malformed witness set or unreadable funds are refused", () => {
    const kit = evolutionKit({ baseUrl: "http://127.0.0.1:9", projectId: "p" });
    expect(() => kit.assemble("84a0a0f5f6", "zz")).toThrow(/no signature/);
    expect(() => walletUtxo("82")).toThrow(/cannot read/);
  });
});
