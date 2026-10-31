import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { ClientCardanoSigner, ClientCardanoSignInput } from "@x402/cardano";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { agentWalletAddress } from "../src/cfo/connections.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import type { TxKit } from "../src/cfo/wallet-signer.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

// A minimal valid Cardano transaction: what the funding wallet's signer returns.
const SIGNED_TX = Buffer.from(`84a300818258${"20" + "aa".repeat(32)}00018182581d60${"11".repeat(28)}1a001e8480021a00029810a0f5f6`, "hex").toString("base64");
const SIGNED_HASH = "c8bf07267ca8d0df9452b467eab54de1fb96234e7f320e0fb20bf5cf15c9a59d";

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

async function start(opts: { env?: Record<string, string>; funder?: boolean } = {}) {
  const state = { signed: [] as ClientCardanoSignInput[], sent: [] as string[], funderHolds: 500_000_000n, refuse: false };
  const signer: ClientCardanoSigner = {
    getAddress: () => "addr_test1vqfunderstub00000000000000000000000000000000000000",
    buildAndSignPaymentTransaction: async input => {
      state.signed.push(input);
      await new Promise(r => setTimeout(r, 20));
      return { transaction: SIGNED_TX, nonce: "x" };
    },
  };
  const kit = {
    async submit(signed: string) {
      state.sent.push(signed);
      if (state.refuse) throw new Error("Blockfrost submitTx failed: 400 BadInputsUTxO");
      return SIGNED_HASH;
    },
    isDefinitiveRejection: (e: unknown) => e instanceof Error && e.message.startsWith("Blockfrost submitTx failed: 400"),
    confirmed: async () => true,
    balance: async (address: string) => (address === signer.getAddress() ? state.funderHolds : 0n),
    tipTime: async () => Date.now(),
    build: async () => ({ cborHex: "", txHash: "", validUntil: 0 }),
    assemble: () => "",
  } satisfies TxKit;
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "f".repeat(40), ...opts.env });
  const engine: PaymentEngine = { runs: new RunStore() };
  const deps = await createCfo(config, engine, {
    memory: true,
    noSweep: true,
    walletKit: kit,
    agentFor: () => ({}) as unknown as BuyerAgent,
    ...(opts.funder === false ? {} : { funderSigner: signer, funderSettleMs: 0 }),
  });
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
  return { state, user };
}

type Call = Awaited<ReturnType<Awaited<ReturnType<typeof start>>["user"]>>;
const agentWallet = async (me: Call) => {
  const phrase = generateMnemonic(wordlist, 256);
  await me("POST", "/api/v1/connections", { kind: "cardano_agent_wallet", recoveryPhrase: phrase, access: "read_write" });
  return agentWalletAddress(phrase);
};

describe("Get test tADA: a new agent wallet is topped up once from PayLorya AI's funding wallet", () => {
  it("only to the account's own agent wallet, once, with its transaction", async () => {
    const s = await start();
    const me = await s.user("one@example.com");
    expect((await me("GET", "/api/v1/funding")).json).toMatchObject({ available: false, reason: "Connect your agent wallet first" });
    expect((await me("POST", "/api/v1/funding")).status).toBe(409);

    const address = await agentWallet(me);
    expect((await me("GET", "/api/v1/funding")).json).toMatchObject({ available: true, lovelace: "20000000" });
    const granted = await me("POST", "/api/v1/funding");
    expect(granted.status).toBe(201);
    expect(granted.json).toMatchObject({ address, lovelace: "20000000", status: "sent", txHash: SIGNED_HASH, explorerUrl: `https://preprod.cardanoscan.io/transaction/${SIGNED_HASH}` });
    expect(s.state.signed).toEqual([expect.objectContaining({ network: "cardano:preprod", payTo: address, asset: "lovelace", amount: "20000000" })]);
    expect(s.state.sent).toEqual([SIGNED_TX]);
    expect((await me("GET", "/api/v1/activity")).json.map((a: { action: string }) => a.action)).toContain("received test tADA");

    expect((await me("GET", "/api/v1/funding")).json).toMatchObject({ available: false, granted: { txHash: SIGNED_HASH } });
    const again = await me("POST", "/api/v1/funding");
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/already received its 20 tADA.*Preprod faucet/);
    expect(s.state.signed).toHaveLength(1);
  });

  it("a double click gets one grant", async () => {
    const s = await start();
    const me = await s.user("double@example.com");
    await agentWallet(me);
    const [a, b] = await Promise.all([me("POST", "/api/v1/funding"), me("POST", "/api/v1/funding")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(s.state.signed).toHaveLength(1);
  });

  it("a daily cap over all accounts, and an empty funding wallet, refuse with a reason and keep the grant", async () => {
    const s = await start({ env: { FUNDER_DAILY_GRANTS: "1" } });
    const first = await s.user("first@example.com");
    await agentWallet(first);
    expect((await first("POST", "/api/v1/funding")).status).toBe(201);
    const second = await s.user("second@example.com");
    await agentWallet(second);
    const capped = await second("POST", "/api/v1/funding");
    expect(capped.status).toBe(429);
    expect(capped.json.error).toMatch(/Today's test tADA is used up/);

    const t = await start();
    t.state.funderHolds = 5_000_000n;
    const poor = await t.user("poor@example.com");
    await agentWallet(poor);
    const empty = await poor("POST", "/api/v1/funding");
    expect(empty.status).toBe(503);
    expect(empty.json.error).toMatch(/supply is empty/);
    expect((await poor("GET", "/api/v1/funding")).json.available).toBe(true);
  });

  it("refused by the network: nothing sent, the account can ask again", async () => {
    const s = await start();
    const me = await s.user("retry@example.com");
    await agentWallet(me);
    s.state.refuse = true;
    const refused = await me("POST", "/api/v1/funding");
    expect(refused.status).toBe(502);
    expect(refused.json.error).toMatch(/nothing was sent/);
    s.state.refuse = false;
    expect((await me("POST", "/api/v1/funding")).status).toBe(201);
  });

  it("without FUNDER_MNEMONIC it is not offered", async () => {
    const s = await start({ funder: false });
    const me = await s.user("none@example.com");
    await agentWallet(me);
    expect((await me("GET", "/api/v1/funding")).json).toMatchObject({ available: false, reason: expect.stringMatching(/not offered/) });
    expect((await me("POST", "/api/v1/funding")).status).toBe(503);
  });
});
