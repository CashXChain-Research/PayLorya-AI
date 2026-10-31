import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ClientCardanoSigner } from "@x402/cardano";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { NEEDS_OWN_WALLET } from "../src/cfo/payments.js";
import type { TxKit } from "../src/cfo/wallet-signer.js";
import { loadConfig } from "../src/config.js";
import { RunStore, type Run } from "../src/runs.js";
import type { Invoice } from "../src/types.js";

const WALLET = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
const PAYEE = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
const TX = "ab".repeat(32);

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

/** Payout engine stub that pays tADA with the run's own signer, as BuyerAgent.useCardanoSigner does. */
function walletAgent() {
  const signers = new WeakMap<Run, ClientCardanoSigner>();
  const agent = {
    useFiatRoute() {},
    useCardanoSigner(run: Run, signer: ClientCardanoSigner) {
      signers.set(run, signer);
    },
    async process(run: Run) {
      run.state = "DRAFT_READY";
      run.draft = { executable: true, route: { rail: "cardano_preprod" } } as unknown as Run["draft"];
    },
    approve(run: Run) {
      const invoice = JSON.parse(run.input) as Invoice;
      const signer = signers.get(run);
      const done = (async () => {
        if (!signer) throw new Error("no own wallet");
        try {
          const signed = await signer.buildAndSignPaymentTransaction({ network: "cardano:preprod", payTo: invoice.cardanoAddress!, asset: "lovelace", amount: String(invoice.amountMinor), maxTimeoutSeconds: 600 });
          run.state = "EXECUTED";
          run.payout = { rail: "cardano_preprod", status: "submitted", simulated: false, amountMinor: invoice.amountMinor, currency: "ADA", destination: invoice.cardanoAddress!, reference: TX, label: `sent ${signed.transaction}`, executedAt: new Date().toISOString() };
        } catch (error) {
          run.state = "FAILED";
          run.error = error instanceof Error ? error.message : String(error);
        }
      })();
      return { ok: true, done };
    },
  } as unknown as BuyerAgent;
  return agent;
}

async function start(signMs = 5_000) {
  const blockfrost = express();
  blockfrost.use((_req, res) => void res.status(404).json({ status_code: 404 }));
  const bfUrl = await listen(blockfrost);
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "w".repeat(40), BLOCKFROST_PROJECT_ID: "preprodTest", BLOCKFROST_PREPROD_URL: bfUrl });
  const built: Array<{ from: string; payTo: string; lovelace: bigint }> = [];
  const assembled: string[] = [];
  const kit: TxKit = {
    build: async (from, payTo, lovelace) => (built.push({ from, payTo, lovelace }), { cborHex: "84a0a0f5f6", txHash: TX, nonce: `${"c".repeat(64)}#0` }),
    assemble: (_cbor, witnessSet) => (assembled.push(witnessSet), Buffer.from(`signed:${witnessSet}`).toString("base64")),
  };
  const engine: PaymentEngine = { runs: new RunStore(), agent: walletAgent() };
  const deps = await createCfo(config, engine, { memory: true, walletKit: kit, signMs });
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
  return { deps, built, assembled, user };
}

const settle = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("condition not reached");
};

async function adaPayment(me: Awaited<ReturnType<Awaited<ReturnType<typeof start>>["user"]>>) {
  const payee = (await me("POST", "/api/v1/payees", { name: "Nordwind Node Services", cardanoAddress: PAYEE })).json;
  const draft = (await me("POST", "/api/v1/payments", { payeeId: payee.id, amountMinor: 2_000_000, currency: "ADA", reason: "Node hosting" })).json;
  return draft;
}

describe("tADA payouts leave from the workspace's own wallet, signed by its owner", () => {
  it("approve → the payment waits with the transaction → the wallet's signature sends it", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    expect((await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" })).json.access).toBe("read_write");
    const draft = await adaPayment(me);
    expect(draft.policy.checks.find((c: { id: string }) => c.id === "access").status).toBe("pass");
    if (draft.status === "pending_approval") expect((await me("POST", `/api/v1/payments/${draft.id}/approve`)).status).toBe(200);

    await settle(async () => Boolean((await me("GET", "/api/v1/payments")).json[0].signRequest));
    const waiting = (await me("GET", "/api/v1/payments")).json[0];
    expect(waiting).toMatchObject({ status: "executing", signRequest: { txCbor: "84a0a0f5f6", txHash: TX, address: WALLET } });
    expect(s.built).toEqual([{ from: WALLET, payTo: PAYEE, lovelace: 2_000_000n }]);

    // A signature for another transaction is refused; the right one sends the payout.
    expect((await me("POST", `/api/v1/payments/${draft.id}/signature`, { txHash: "cd".repeat(32), witnessSet: "a100" })).status).toBe(409);
    expect((await me("POST", `/api/v1/payments/${draft.id}/signature`, { txHash: TX, witnessSet: "a10081825820" })).status).toBe(202);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    const paid = (await me("GET", "/api/v1/payments")).json[0];
    expect(paid.signRequest).toBeUndefined();
    expect(paid.txHash).toBe(TX);
    expect(s.assembled).toEqual(["a10081825820"]);
    expect((await me("POST", `/api/v1/payments/${draft.id}/signature`, { txHash: TX, witnessSet: "a100" })).status).toBe(409);
  });

  it("declined in the wallet, or not signed in time: the payment fails and nothing is sent", async () => {
    const s = await start(300);
    const me = await s.user("owner@nordwind.example");
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const first = await adaPayment(me);
    if (first.status === "pending_approval") await me("POST", `/api/v1/payments/${first.id}/approve`);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toMatch(/Not signed in time/);
    expect(s.assembled).toEqual([]);
  });

  it("an owner can decline the signature request", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const draft = await adaPayment(me);
    if (draft.status === "pending_approval") await me("POST", `/api/v1/payments/${draft.id}/approve`);
    await settle(async () => Boolean((await me("GET", "/api/v1/payments")).json[0].signRequest));
    expect((await me("POST", `/api/v1/payments/${draft.id}/signature`, { declined: true })).status).toBe(202);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "failed");
    expect((await me("GET", "/api/v1/payments")).json[0].error).toMatch(/Declined in the wallet/);
  });

  it("the agent wallet never pays a workspace's payout, not even an old read & write connection to it", async () => {
    const s = await start();
    const me = await s.user("owner@nordwind.example");
    const catalog = (await me("GET", "/api/v1/connections/catalog")).json;
    expect(catalog.find((c: { kind: string }) => c.kind === "cardano_agent_wallet").supports.write).toBe(false);
    expect(catalog.find((c: { kind: string }) => c.kind === "cardano_wallet").supports.write).toBe(true);
    const ws = (await me("GET", "/api/v1/me")).json.workspace.id;
    await s.deps.store.addConnection(ws, { kind: "cardano_agent_wallet", label: "Agent wallet", network: "cardano:preprod", address: WALLET, access: "read_write" });
    const draft = await adaPayment(me);
    expect(draft.status).toBe("blocked");
    expect(draft.policy.checks.find((c: { id: string }) => c.id === "access").status).toBe("fail");

    // A payment that got past the policy (connections changed since) still fails without the own wallet.
    await me("POST", "/api/v1/connections", { kind: "cardano_wallet", address: WALLET, access: "read_write" });
    const later = await adaPayment(me);
    const own = (await me("GET", "/api/v1/connections")).json.find((c: { kind: string }) => c.kind === "cardano_wallet");
    await me("PATCH", `/api/v1/connections/${own.id}`, { access: "read" });
    if (later.status === "pending_approval") await me("POST", `/api/v1/payments/${later.id}/approve`);
    await settle(async () => ["failed", "blocked"].includes((await me("GET", "/api/v1/payments")).json.find((p: { id: string }) => p.id === later.id).status));
    const after = (await me("GET", "/api/v1/payments")).json.find((p: { id: string }) => p.id === later.id);
    expect(after.status === "blocked" || after.error === NEEDS_OWN_WALLET).toBe(true);
    expect(s.built).toEqual([]);
  });
});
