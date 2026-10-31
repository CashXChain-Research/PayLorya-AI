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
import type { ClientCardanoSigner } from "@x402/cardano";
import { BuyerAgent } from "../src/agent.js";
import { evolutionKit, walletSigner } from "../src/cfo/wallet-signer.js";
import { loadConfig } from "../src/config.js";
import type { ChainSubmitter, ChainView } from "../src/payout.js";
import { invoiceFingerprint } from "../src/readiness.js";
import { CRYPTO_PAYEE, decideRoute, payeeDirectory } from "../src/routing.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

/** Blockfrost as the Evolution SDK reads it while building: the wallet's UTxOs and the protocol parameters. */
async function fakeBlockfrost(address: string, lovelace: bigint) {
  const seen: string[] = [];
  const app = express();
  app.use((req, _res, next) => (seen.push(`${req.method} ${req.path}`), next()));
  app.get(`/addresses/${address}/utxos`, (req, res) =>
    void res.json(
      req.query.page === "1"
        ? [{ address, tx_hash: "a".repeat(64), tx_index: 0, output_index: 0, amount: [{ unit: "lovelace", quantity: lovelace.toString() }], block: "b".repeat(64), data_hash: null, inline_datum: null, reference_script_hash: null }]
        : [],
    ),
  );
  app.get("/epochs/latest/parameters", (_req, res) =>
    void res.json({
      min_fee_a: "44", min_fee_b: "155381", pool_deposit: "500000000", key_deposit: "2000000", max_tx_size: "16384", max_val_size: "5000",
      max_block_size: "90112", coins_per_utxo_size: "4310", collateral_percent: "150", max_collateral_inputs: "3", price_mem: "0.0577", price_step: "0.0000721",
      max_tx_ex_mem: "14000000", max_tx_ex_steps: "10000000000", min_fee_ref_script_cost_per_byte: "15",
    }),
  );
  app.use((req, res) => void res.status(404).json({ status_code: 404, error: "Not Found", message: `${req.path}` }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("payout from the customer's own wallet (CIP-30)", () => {
  it("builds from the wallet's UTxOs, the wallet signs, the signature is spliced in without touching the body", async () => {
    const mnemonic = generateMnemonic(wordlist, 256);
    const from = Address.toBech32(addressFromSeed(mnemonic, { networkId: 0 }).address);
    const payTo = Address.toBech32(addressFromSeed(generateMnemonic(wordlist, 256), { networkId: 0 }).address);
    const bf = await fakeBlockfrost(from, 50_000_000n);
    const kit = evolutionKit({ baseUrl: bf.url, projectId: "preprodTest" });
    // The customer's wallet: signTx(cbor, partialSign) answers a witness set, as CIP-30 wallets do.
    // A wallet knows its own UTxOs; this one reads them from the same Blockfrost stand-in.
    const wallet = Client.make(preprod).withBlockfrost({ baseUrl: bf.url, projectId: "preprodTest" }).withSeed({ mnemonic });
    const asked: string[] = [];
    const signer = walletSigner({
      address: from,
      kit,
      sign: async tx => {
        asked.push(tx.cborHex);
        return TransactionWitnessSet.toCBORHex(await wallet.signTx(tx.cborHex, { utxos: await wallet.getWalletUtxos() }));
      },
    });

    const signed = await signer.buildAndSignPaymentTransaction({ network: "cardano:preprod", payTo, asset: "lovelace", amount: "5000000", maxTimeoutSeconds: 600, extra: { assetTransferMethod: "default" } });
    const decoded = decodeCardanoTransaction(signed.transaction);
    const unsigned = decodeCardanoTransaction(Buffer.from(asked[0]!, "hex").toString("base64"));
    expect(decoded.txHash).toBe(unsigned.txHash); // the body the wallet signed is the body broadcast
    expect(decoded.inputs).toEqual([`${"a".repeat(64)}#0`]);
    expect(signed.nonce).toBe(`${"a".repeat(64)}#0`);
    const tx = Transaction.fromCBORBytes(Buffer.from(signed.transaction, "base64"));
    expect(tx.witnessSet.vkeyWitnesses?.length).toBe(1);
    // The payee first, the change back to the customer's own address.
    expect(tx.body.outputs.map(o => Address.toBech32(o.address))).toEqual([payTo, from]);
    expect(bf.seen).toContain(`GET /addresses/${from}/utxos`);
  });

  it("refuses anything but a plain tADA transfer on Cardano Preprod, before building", async () => {
    let built = 0;
    const signer = walletSigner({
      address: "addr_test1x",
      kit: { build: async () => (built++, { cborHex: "", txHash: "", nonce: "" }), assemble: () => "" },
      sign: async () => "",
    });
    const base = { payTo: "addr_test1y", asset: "lovelace", amount: "1", maxTimeoutSeconds: 60 };
    await expect(signer.buildAndSignPaymentTransaction({ ...base, network: "cardano:mainnet" })).rejects.toThrow(/Preprod only/);
    await expect(signer.buildAndSignPaymentTransaction({ ...base, network: "cardano:preprod", asset: "abc.def" })).rejects.toThrow(/lovelace/);
    await expect(signer.buildAndSignPaymentTransaction({ ...base, network: "cardano:preprod", extra: { assetTransferMethod: "masumi" } })).rejects.toThrow(/plain transfers/);
    expect(built).toBe(0);
  });

  it("a malformed witness set is refused", () => {
    expect(() => evolutionKit({ baseUrl: "http://x", projectId: "p" }).assemble("84a0a0f5f6", "zz")).toThrow(/no signature/);
  });
});

describe("the agent pays a run's tADA payout with the run's own signer", () => {
  const SELLER = "addr_test1vqsellerstub000000000000000000000000000000000000";
  const SUPPLIER = "addr_test1vqsupplierstub0000000000000000000000000000000000";
  const OWN = "addr_test1vqownwalletstub00000000000000000000000000000000000";

  function setup() {
    const config = loadConfig({ SELLER_ADDRESS: SELLER, SUPPLIER_CARDANO_ADDRESS: SUPPLIER });
    const directory = payeeDirectory(SUPPLIER);
    const agentSigned: string[] = [];
    const agentSigner: ClientCardanoSigner = {
      getAddress: () => "addr_test1vqagentwalletstub000000000000000000000000000000000",
      buildAndSignPaymentTransaction: async input => (agentSigned.push(input.payTo), { transaction: "YWdlbnQ=", nonce: `${"1".repeat(64)}#0` }),
    };
    const submitted: string[] = [];
    const submitter: ChainSubmitter = { submit: async tx => (submitted.push(tx), { txHash: (tx === "b3du" ? "0" : "f").repeat(64), status: "mempool" }) };
    const lovelace = new Map<string, bigint>([[OWN, 40_000_000n]]);
    const chain: ChainView = { hasTransaction: async () => true, addressLovelace: async a => lovelace.get(a) ?? 0n };
    const runs = new RunStore();
    const agent = new BuyerAgent(config, runs, agentSigner, { submitter, chain });
    const draft = (id: string): Run => {
      const invoice: Invoice = { id, supplier: CRYPTO_PAYEE, destinationCountry: "EE", currency: "ADA", amountMinor: 2_000_000, cardanoAddress: SUPPLIER };
      const run = runs.create(JSON.stringify(invoice));
      run.invoice = invoice;
      run.fingerprint = invoiceFingerprint(invoice);
      const route = decideRoute(invoice, directory, { payoutMaxLovelace: 10_000_000n });
      run.route = route;
      run.draft = { status: "awaiting_human_approval", executable: route.status === "selected", invoiceId: id, supplier: invoice.supplier, amountMinor: invoice.amountMinor, currency: "ADA", route, note: "n" };
      runs.transition(run, "DRAFT_READY");
      return run;
    };
    return { agent, agentSigned, submitted, draft };
  }

  it("signs with the run's wallet, shows it in the preview, and leaves the agent wallet out", async () => {
    const s = setup();
    const asked: Array<{ payTo: string; amount: string }> = [];
    const own: ClientCardanoSigner = { getAddress: () => OWN, buildAndSignPaymentTransaction: async i => (asked.push({ payTo: i.payTo, amount: i.amount }), { transaction: "b3du", nonce: `${"2".repeat(64)}#0` }) };
    const run = s.draft("ADA-1");
    s.agent.useCardanoSigner(run, own);
    const preview = await s.agent.preview(run, "disabled");
    expect(preview.from).toMatchObject({ kind: "cardano_wallet", address: OWN, balanceLovelace: "40000000" });

    const started = s.agent.approve(run);
    if (!started.ok) throw new Error(started.reason);
    await started.done;
    expect(run.state).toBe("EXECUTED");
    expect(asked).toEqual([{ payTo: SUPPLIER, amount: "2000000" }]);
    expect(s.submitted).toEqual(["b3du"]);
    expect(run.payout).toMatchObject({ rail: "cardano_preprod", reference: "0".repeat(64) });
    expect(s.agentSigned).toEqual([]);
  });

  it("a payout waiting for its owner's signature does not hold the agent wallet", async () => {
    const s = setup();
    let release!: () => void;
    const signed = new Promise<void>(r => (release = r));
    const own: ClientCardanoSigner = { getAddress: () => OWN, buildAndSignPaymentTransaction: async () => (await signed, { transaction: "b3du", nonce: `${"2".repeat(64)}#0` }) };
    const waiting = s.draft("ADA-2");
    s.agent.useCardanoSigner(waiting, own);
    const first = s.agent.approve(waiting);
    if (!first.ok) throw new Error(first.reason);

    const other = s.draft("ADA-3");
    const second = s.agent.approve(other);
    if (!second.ok) throw new Error(second.reason);
    await second.done; // the agent wallet pays while the other payout still waits
    expect(other.state).toBe("EXECUTED");
    expect(s.agentSigned).toEqual([SUPPLIER]);
    expect(waiting.state).toBe("EXECUTING");

    release();
    await first.done;
    expect(waiting.state).toBe("EXECUTED");
  });
});
