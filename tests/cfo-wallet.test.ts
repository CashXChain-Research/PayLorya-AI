import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Address } from "@evolution-sdk/evolution";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { NEEDS_AGENT_WALLET } from "../src/cfo/agents.js";
import { agentWalletAddress } from "../src/cfo/connections.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { CHECK_TIMED_OUT, INTERRUPTED, NEEDS_OWN_WALLET } from "../src/cfo/payments.js";
import { InsufficientFunds, type TxKit } from "../src/cfo/wallet-signer.js";
import { loadConfig } from "../src/config.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";

const WALLET = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
const OTHER = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
const PAYEE = "addr_test1vpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5eg0yu80w";
const hexOf = (a: string) => Address.toHex(Address.fromBech32(a));
const TX = "ab".repeat(32);
const AGENT_TX = "cd".repeat(32);
const PHRASE = generateMnemonic(wordlist, 256);
const FEE_TX = "fe".repeat(32);

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

async function listen(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Payout engine stub: the paid x402 check on Cardano passes and routes to the verified payee. */
/**
 * One payout engine per agent wallet, as WorkspaceAgents builds them: it pays the verification from
 * that wallet (payer = the wallet's address) and, when asked, the tADA payout too.
 */
function engines(opts: { hang?: boolean } = {}) {
  const processed: string[] = [];
  const made: Array<{ phrase: string; address: string; paid: string[] }> = [];
  const agentFor = (phrase: string) => {
    const me = { phrase, address: agentWalletAddress(phrase), paid: [] as string[] };
    made.push(me);
    return {
      useFiatRoute() {},
      async process(run: Run) {
        const invoice = JSON.parse(run.input) as Invoice;
        processed.push(invoice.id);
        if (opts.hang) await new Promise(() => undefined); // a facilitator that never answers
        run.state = "DRAFT_READY";
        run.report = { verdict: "ready_for_review" } as Run["report"];
        run.payment = { transactionHash: FEE_TX, explorerUrl: `https://preprod.cardanoscan.io/transaction/${FEE_TX}`, buyerAddress: me.address } as Run["payment"];
        run.draft = { executable: true, route: { rail: "cardano_preprod", status: "selected", destination: invoice.cardanoAddress } } as unknown as Run["draft"];
      },
      approve(run: Run) {
        const invoice = JSON.parse(run.input) as Invoice;
        me.paid.push(invoice.cardanoAddress!);
        run.state = "EXECUTED";
        run.payout = { rail: "cardano_preprod", status: "submitted", simulated: false, amountMinor: invoice.amountMinor, currency: "ADA", destination: invoice.cardanoAddress!, reference: AGENT_TX, explorerUrl: `https://preprod.cardanoscan.io/transaction/${AGENT_TX}`, label: "Paid on Cardano Preprod", executedAt: new Date().toISOString() };
        return { ok: true, done: Promise.resolve() };
      },
    } as unknown as BuyerAgent;
  };
  return { agentFor, processed, made };
}

function stubKit() {
  const state = {
    built: [] as Array<{ payTo: string; lovelace: bigint; utxos: string[]; changeAddress: string }>,
    sent: [] as string[],
    submitError: undefined as Error | undefined,
    definitive: false,
    inBlock: new Set<string>(),
    nextHash: TX,
    holds: 50_000_000n,
    /** Unix ms of the newest block the provider has indexed. */
    tip: Date.now(),
  };
  const kit: TxKit = {
    async build({ payTo, lovelace, funds, validUntil }) {
      if (state.holds < lovelace + 1_000_000n) throw new InsufficientFunds("Your wallet holds too little");
      state.built.push({ payTo, lovelace, utxos: funds.utxos, changeAddress: funds.changeAddress });
      return { cborHex: `84a0${state.built.length}`, txHash: state.nextHash, validUntil };
    },
    assemble: (_cbor, witnessSet) => Buffer.from(`signed:${witnessSet}`).toString("base64"),
    async submit(signed) {
      state.sent.push(signed);
      if (state.submitError) throw state.submitError;
      return state.nextHash;
    },
    isDefinitiveRejection: () => state.definitive,
    confirmed: async hash => state.inBlock.has(hash),
    tipTime: async () => state.tip,
  };
  return { kit, state };
}

async function start(opts: { hang?: boolean; checkTimeoutMs?: number } = {}) {
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "w".repeat(40), BLOCKFROST_PROJECT_ID: "preprodTest", BLOCKFROST_PREPROD_URL: "http://127.0.0.1:9" });
  const { kit, state } = stubKit();
  const { agentFor, processed, made } = engines(opts);
  const engine: PaymentEngine = { runs: new RunStore() };
  const deps = await createCfo(config, engine, { memory: true, walletKit: kit, noSweep: true, agentFor, ...(opts.checkTimeoutMs ? { checkTimeoutMs: opts.checkTimeoutMs } : {}) });
  mountCfo(app, deps);

  async function user(email: string) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      return { status: r.status, json: (text ? JSON.parse(text) : undefined) as any };
    };
  }
  return { deps, state, processed, made, user };
}

type Call = Awaited<ReturnType<Awaited<ReturnType<typeof start>>["user"]>>;

const settle = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("condition not reached");
};

/** Own wallet connected for payments, a payee with a Preprod address, a 2 tADA payment approved. */
/** The account's own agent wallet, read & write: required for any payment. */
const connectAgentWallet = (me: Call, phrase = PHRASE, access = "read_write") => me("POST", "/api/v1/connections", { kind: "cardano_agent_wallet", recoveryPhrase: phrase, access });

/** Agent wallet, plus the owner's own wallet set to read & write (they sign): a 2 tADA payment approved. */
async function approvedAdaPayment(me: Call) {
  await connectAgentWallet(me);
  await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
  const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
  const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
  if (draft.status === "pending_approval") expect((await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency })).status).toBe(200);
  await settle(async () => (await payment(me, draft.id)).status === "awaiting_signature");
  return draft.id as string;
}
const payment = async (me: Call, id: string) => (await me("GET", "/api/v1/payments")).json.find((p: { id: string }) => p.id === id);
const funds = (addr = WALLET) => ({ utxos: ["8282"], changeAddress: hexOf(addr), addresses: [hexOf(addr)] });

describe("tADA payouts from the workspace's own wallet: stored at every step, signed by the owner", () => {
  it("check on Cardano → waits for the wallet → built from the wallet's funds → signed → sent", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    const waiting = await payment(me, id);
    expect(waiting.cardano).toMatchObject({ from: WALLET, payTo: PAYEE, lovelace: "2000000" });
    // The verification was paid from the account's own agent wallet; the payout waits for the owner's own wallet.
    expect(waiting.verification).toMatchObject({ txHash: FEE_TX, verdict: "ready_for_review", payer: agentWalletAddress(PHRASE) });
    expect(s.processed).toHaveLength(1);

    const tx = await me("POST", `/api/v1/payments/${id}/transaction`, funds());
    expect(tx.status).toBe(200);
    expect(tx.json).toMatchObject({ txCbor: "84a01", txHash: TX });
    expect(s.state.built).toEqual([{ payTo: PAYEE, lovelace: 2_000_000n, utxos: ["8282"], changeAddress: WALLET }]);

    expect((await me("POST", `/api/v1/payments/${id}/signature`, { txHash: "cd".repeat(32), witnessSet: "a100" })).status).toBe(409);
    const sent = await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ status: "executed", txHash: TX, explorerUrl: `https://preprod.cardanoscan.io/transaction/${TX}`, cardano: { submitted: { txHash: TX } } });
    expect(s.state.sent).toEqual([Buffer.from("signed:a10081").toString("base64")]);
    // A second signature finds it sent.
    expect((await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" })).status).toBe(409);

    // The sweep marks it confirmed once it is in a block.
    s.state.inBlock.add(TX);
    await s.deps.payments.sweep();
    expect((await payment(me, id)).cardano.confirmedAt).toBeTruthy();
  });

  it("refuses a wallet that does not hold the connected address, and one that holds too little", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    const other = await me("POST", `/api/v1/payments/${id}/transaction`, funds(OTHER));
    expect(other.status).toBe(409);
    expect(other.json.error).toMatch(/does not hold/);
    s.state.holds = 2_500_000n;
    const poor = await me("POST", `/api/v1/payments/${id}/transaction`, funds());
    expect(poor.status).toBe(400);
    expect(poor.json.error).toMatch(/holds too little/);
    expect((await payment(me, id)).status).toBe("awaiting_signature");
  });

  it("refused by the network: nothing sent, sign again; outcome unknown: settled from the chain", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    await me("POST", `/api/v1/payments/${id}/transaction`, funds());
    s.state.submitError = new Error("Blockfrost submitTx failed: 400 BadInputsUTxO");
    s.state.definitive = true;
    const refused = await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" });
    expect(refused.status).toBe(422);
    expect(await payment(me, id)).toMatchObject({ status: "awaiting_signature", error: expect.stringMatching(/nothing was sent/) });

    // Built again (signing again), and this time the network does not answer.
    await me("POST", `/api/v1/payments/${id}/transaction`, funds());
    s.state.submitError = new Error("socket hang up");
    s.state.definitive = false;
    expect((await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" })).status).toBe(200);
    expect(await payment(me, id)).toMatchObject({ status: "executing", cardano: { submitted: { txHash: TX } } });

    await s.deps.payments.sweep(); // not in a block yet, not expired: left alone
    expect((await payment(me, id)).status).toBe("executing");
    s.state.inBlock.add(TX);
    await s.deps.payments.sweep();
    expect(await payment(me, id)).toMatchObject({ status: "executed", txHash: TX });
  });

  it("a sent transaction counts as never included only once the indexer is well past its validity", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    const built = (await me("POST", `/api/v1/payments/${id}/transaction`, funds())).json;
    s.state.submitError = new Error("timeout");
    await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" });
    const validUntil = Date.parse(built.validUntil);

    // Long past its validity by our clock, but the provider has indexed only 5 minutes past it: the
    // transaction may sit in a block it has not indexed yet. Wait; never reset to signing.
    s.state.tip = validUntil + 5 * 60_000;
    await s.deps.payments.sweep(validUntil + 60 * 60_000);
    expect((await payment(me, id)).status).toBe("executing");
    // It was in a block after all: found once indexed, paid once.
    s.state.inBlock.add(TX);
    await s.deps.payments.sweep(validUntil + 61 * 60_000);
    expect(await payment(me, id)).toMatchObject({ status: "executed", txHash: TX });
  });

  it("a sent transaction the indexer has passed without seeing goes back to signing: nothing was sent", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    const built = (await me("POST", `/api/v1/payments/${id}/transaction`, funds())).json;
    s.state.submitError = new Error("timeout");
    await me("POST", `/api/v1/payments/${id}/signature`, { txHash: TX, witnessSet: "a10081" });
    const validUntil = Date.parse(built.validUntil);
    s.state.tip = validUntil + 11 * 60_000;
    await s.deps.payments.sweep(validUntil + 11 * 60_000);
    expect(await payment(me, id)).toMatchObject({ status: "awaiting_signature", error: expect.stringMatching(/expired before it reached a block/) });
  });

  it("the owner can decline: rejected, nothing sent", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const id = await approvedAdaPayment(me);
    const declined = await me("POST", `/api/v1/payments/${id}/signature`, { declined: true });
    expect(declined.json).toMatchObject({ status: "rejected", error: expect.stringMatching(/Declined in the wallet/) });
    expect(s.state.sent).toEqual([]);
  });

  it("a payment cut off by a restart goes back to approval, and approving it again continues it", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    await connectAgentWallet(me);
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
    // As if the container restarted right after the approval was stored.
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    expect(await s.deps.store.claimPayment(ws, draft.id, ["pending_approval"], "executing", new Date().toISOString())).toBe(true);
    await s.deps.payments.sweep();
    expect(await payment(me, draft.id)).toMatchObject({ status: "pending_approval", error: INTERRUPTED });
    expect((await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency })).status).toBe(200);
    await settle(async () => (await payment(me, draft.id)).status === "awaiting_signature");
  });

  it("a verification that never finishes sends the payment back to approval, nothing paid", async () => {
    const s = await start({ hang: true, checkTimeoutMs: 200 });
    const me = await s.user("owner@nordwind.example");
    await connectAgentWallet(me);
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await payment(me, draft.id)).status === "pending_approval" && Boolean((await payment(me, draft.id)).error));
    expect((await payment(me, draft.id)).error).toBe(CHECK_TIMED_OUT);
    expect(s.state.built).toEqual([]);
  });

  it("PayLorya AI's shared wallet never counts: an old agent-wallet row without a phrase is no agent wallet", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    const shared = await s.deps.store.addConnection(ws, { kind: "cardano_agent_wallet", label: "Agent wallet", network: "cardano:preprod", address: WALLET, access: "read_write" });
    expect((await me("POST", `/api/v1/connections/${shared.id}/refresh`)).json.error).toMatch(/shared wallet, not yours/);
    const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
    expect(draft.status).toBe("blocked");
    expect(draft.policy.checks.find((c: { id: string }) => c.id === "agent_wallet").status).toBe("fail");
    expect(s.made).toEqual([]);
  });
});

describe("each account pays from its own agent wallet, connected with its recovery phrase", () => {
  it("connects by recovery phrase: address derived, phrase sealed and never shown again, one per account", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const entry = (await me("GET", "/api/v1/connections/catalog")).json.find((c: { kind: string }) => c.kind === "cardano_agent_wallet");
    expect(entry).toMatchObject({ available: true, acceptsRecoveryPhrase: true, supports: { write: true } });
    expect((await connectAgentWallet(me, "")).json.error).toMatch(/Paste the agent wallet's recovery phrase/);
    expect((await connectAgentWallet(me, "abandon ".repeat(12).trim())).json.error).toMatch(/not a valid recovery phrase/);

    const created = await connectAgentWallet(me, `  ${PHRASE.toUpperCase().replace(/ /g, "   ")} `);
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ kind: "cardano_agent_wallet", address: agentWalletAddress(PHRASE), access: "read_write", keyHint: "24-word recovery phrase" });
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    const sealed = await s.deps.store.connectionSecret(ws, created.json.id);
    for (const word of PHRASE.split(" ").slice(0, 3)) expect(sealed).not.toContain(word);
    expect(JSON.stringify((await me("GET", "/api/v1/connections")).json)).not.toContain(PHRASE.split(" ")[0]! + " " + PHRASE.split(" ")[1]);
    expect((await connectAgentWallet(me, generateMnemonic(wordlist))).status).toBe(409);
  });

  it("without one, or read-only, nothing is paid", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const none = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "A" })).json;
    expect(none.policy.checks.find((c: { id: string }) => c.id === "agent_wallet").message).toMatch(/No agent wallet/);
    await connectAgentWallet(me, PHRASE, "read");
    // Another bill (a second draft of the same one would be refused as a duplicate).
    const readOnly = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 3_000_000, currency: "ADA", reason: "B" })).json;
    expect(readOnly.status).toBe("blocked");
    expect(readOnly.policy.checks.find((c: { id: string }) => c.id === "agent_wallet").message).toMatch(/read-only/);
    expect(s.made).toEqual([]);
    expect(NEEDS_AGENT_WALLET).toMatch(/recovery phrase/);
  });

  it("the agent wallet verifies and pays tADA on its own, like a CashXChain payout", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    await connectAgentWallet(me);
    const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
    const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
    await settle(async () => (await payment(me, draft.id)).status === "executed");
    const paid = await payment(me, draft.id);
    expect(paid).toMatchObject({ txHash: AGENT_TX, verification: { txHash: FEE_TX, payer: agentWalletAddress(PHRASE) } });
    expect(s.made.map(m => m.phrase)).toEqual([PHRASE]);
    expect(s.made[0]!.paid).toEqual([PAYEE]);
    expect(s.state.built).toEqual([]); // no wallet popup: the agent wallet signs
  });

  it("two accounts, two engines, two wallets", async () => {
    const s = await start();
    const other = generateMnemonic(wordlist, 256);
    for (const [email, phrase] of [["a@one.example", PHRASE], ["b@two.example", other]] as const) {
      const me = await s.user(email);
      await connectAgentWallet(me, phrase);
      const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
      const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
      if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`, { amountMinor: draft.amountMinor, currency: draft.currency });
      await settle(async () => (await payment(me, draft.id)).status === "executed");
      expect((await payment(me, draft.id)).verification.payer).toBe(agentWalletAddress(phrase));
    }
    expect(s.made.map(m => m.address)).toEqual([agentWalletAddress(PHRASE), agentWalletAddress(other)]);
  });
});
