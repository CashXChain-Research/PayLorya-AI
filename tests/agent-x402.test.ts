import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express, type Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientCardanoSignInput, ClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { BuyerAgent } from "../src/agent.js";
import { CARDANO_NETWORK, loadConfig } from "../src/config.js";
import { RunStore, type Run } from "../src/runs.js";
import { mountSeller, READINESS_PATH } from "../src/seller.js";
import type { Invoice, ReadinessReport } from "../src/types.js";

// Real x402 stack on localhost (paymentMiddleware, x402ResourceServer, HTTPFacilitatorClient,
// x402Client, wrapFetchWithPayment, ExactCardanoScheme). Only the chain side is stubbed.

const SELLER = "addr_test1vqsellerstub000000000000000000000000000000000000";
const ATTACKER = "addr_test1vqattackerstub0000000000000000000000000000000000";
const BUYER = "addr_test1vqbuyerstub0000000000000000000000000000000000000";
const TX = "7a".repeat(32);
const PRICE = 2_000_000n;

const invoice: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 1_248_000,
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};

type Env = Record<string, string>;
type Reply = (res: Response, call: number) => void;
interface FacilitatorRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}
interface StubSigner extends ClientCardanoSigner {
  calls: ClientCardanoSignInput[];
  fail?: Error;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(app: Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

// The client ExactCardanoScheme never decodes the CBOR: it only checks for a non-empty string and
// a txHash#index nonce. Decoding happens in the facilitator, which is stubbed as well.
function stubSigner(): StubSigner {
  const signer: StubSigner = {
    calls: [],
    getAddress: () => BUYER,
    buildAndSignPaymentTransaction(input) {
      signer.calls.push(input);
      if (signer.fail) throw signer.fail;
      const n = signer.calls.length;
      return { transaction: Buffer.from(`stub-signed-tx-${n}`).toString("base64"), nonce: `${"ab".repeat(32)}#${n}` };
    },
  };
  return signer;
}

const verifyOk: Reply = res => void res.json({ isValid: true, payer: BUYER });
const settleOk: Reply = res => void res.json({ success: true, transaction: TX, network: CARDANO_NETWORK, payer: BUYER });
const settleFailed = (errorReason: string, status = 200): Reply => res =>
  void res.status(status).json({ success: false, errorReason, transaction: TX, network: CARDANO_NETWORK, payer: BUYER });
// Shape from @x402/cardano README "Settlement and settlement_pending".
const settlePending: Reply = res =>
  void res.json({
    success: false,
    errorReason: "settlement_pending",
    transaction: TX,
    network: CARDANO_NETWORK,
    extra: { status: "pending", transactionId: TX, confirmations: 0 },
  });

async function startFacilitator(events: string[]) {
  const app = express();
  app.use(express.json());
  const fac = {
    url: "",
    verifyCalls: [] as FacilitatorRequest[],
    settleCalls: [] as FacilitatorRequest[],
    verify: verifyOk,
    settle: settleOk,
    /** Stop accepting connections; in-flight responses still complete. */
    refuseNewConnections: () => {},
  };
  // Capability block of @x402/cardano's facilitator getExtra() with an evidence hook, no mempool.
  app.get("/supported", (_req, res) => {
    res.json({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: CARDANO_NETWORK,
          extra: { assetTransferMethods: ["default", "masumi", "script"], areFeesSponsored: false, l1Confirmations: { minimum: 0, maximum: 20 } },
        },
      ],
      extensions: [],
      signers: {},
    });
  });
  app.post("/verify", (req, res) => {
    events.push("verify");
    fac.verifyCalls.push(req.body);
    fac.verify(res, fac.verifyCalls.length);
  });
  app.post("/settle", (req, res) => {
    events.push("settle");
    fac.settleCalls.push(req.body);
    fac.settle(res, fac.settleCalls.length);
  });
  const { server, url } = await listen(app);
  fac.url = url;
  fac.refuseNewConnections = () => void server.close();
  return fac;
}
type StubFacilitator = Awaited<ReturnType<typeof startFacilitator>>;

const env = (facilitatorUrl: string, overrides: Env = {}): Env => ({
  SELLER_ADDRESS: SELLER,
  PRICE_LOVELACE: PRICE.toString(),
  MAX_PRICE_LOVELACE: "3000000",
  SESSION_BUDGET_LOVELACE: "20000000",
  FACILITATOR_URL: facilitatorUrl,
  ...overrides,
});

async function startStack(opts: { seller?: Env; buyer?: Env } = {}) {
  const events: string[] = [];
  const handled: ReadinessReport[] = [];
  const fac = await startFacilitator(events);

  const app = express();
  app.use(express.json());
  // Probe: the readiness handler calls res.json itself; the x402 middleware buffers what it writes.
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      if ((body as ReadinessReport | undefined)?.verdict) {
        events.push("handler");
        handled.push(body as ReadinessReport);
      }
      return json(body);
    };
    next();
  });
  const { url: sellerUrl } = await listen(app);
  mountSeller(app, loadConfig(env(fac.url, opts.seller)));

  const config = loadConfig(env(fac.url, { PUBLIC_BASE_URL: sellerUrl, ...opts.buyer }));
  const runs = new RunStore();
  const signer = stubSigner();
  const agent = new BuyerAgent(config, runs, signer);
  const run = async (inv: Invoice = invoice): Promise<Run> => {
    const r = runs.create(JSON.stringify(inv));
    await agent.process(r);
    return r;
  };
  return { events, handled, fac, sellerUrl, config, runs, signer, agent, run };
}

const states = (run: Run) => run.timeline.map(t => t.state);
const lastNote = (run: Run) => run.timeline.at(-1)?.note;
const duplicateCheck = (report?: ReadinessReport) => report?.checks.find(c => c.id === "duplicate")?.status;

describe("buyer agent over real x402 (stub signer + stub facilitator)", () => {
  it("pays a ready invoice and drafts it; seller order is verify -> handler -> settle", async () => {
    const s = await startStack();
    const run = await s.run();

    expect(run.state).toBe("DRAFT_READY");
    expect(states(run)).toEqual(["CREATED", "EXTRACTED", "PRECHECKED", "PAYING", "PAID", "DRAFT_READY"]);
    expect(run.timeline[4]?.note).toBe(TX);
    expect(run.payment).toMatchObject({
      network: CARDANO_NETWORK,
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      asset: "lovelace",
      amount: "2000000",
      transactionHash: TX,
      explorerUrl: `https://preprod.cardanoscan.io/transaction/${TX}`,
    });
    expect(run.report?.verdict).toBe("ready_for_review");
    expect(run.report?.payoutExecuted).toBe(false);
    // The paid retry kept our Idempotency-Key (requestId is derived from it).
    expect(run.report?.requestId).toBe(createHash("sha256").update(run.id).digest("hex").slice(0, 16));
    expect(run.draft).toMatchObject({ status: "awaiting_human_approval", executable: false, invoiceId: invoice.id });
    expect(s.agent.spentLovelace).toBe(PRICE);

    expect(s.signer.calls).toHaveLength(1);
    expect(s.signer.calls[0]).toMatchObject({ network: CARDANO_NETWORK, payTo: SELLER, asset: "lovelace", amount: "2000000" });
    expect(s.events).toEqual(["verify", "handler", "settle"]);
    // The facilitator verifies and settles exactly the bytes the buyer signed.
    const signed = { transaction: Buffer.from("stub-signed-tx-1").toString("base64"), nonce: `${"ab".repeat(32)}#1` };
    expect(s.fac.verifyCalls[0]?.paymentPayload.payload).toEqual(signed);
    expect(s.fac.settleCalls[0]?.paymentPayload.payload).toEqual(signed);
    expect(s.fac.settleCalls[0]?.paymentRequirements).toMatchObject({ payTo: SELLER, amount: "2000000", asset: "lovelace" });
  });

  it("settle success:false after signing -> SETTLEMENT_UNKNOWN, spend counted, invoice locked", async () => {
    const s = await startStack();
    s.fac.settle = settleFailed("exact_cardano_settlement_failed");
    const first = await s.run();

    expect(first.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(first)).toBe(`tx ${TX}: HTTP 402, exact_cardano_settlement_failed`);
    expect(first.payment).toBeUndefined();
    expect(first.report).toBeUndefined();
    expect(first.draft).toBeUndefined();
    expect(s.agent.spentLovelace).toBe(PRICE);
    expect(s.fac.settleCalls).toHaveLength(1); // only settlement_pending is retried by core
    expect(s.events).toEqual(["verify", "handler", "settle"]); // handler ran, body withheld

    const second = await s.run();
    expect(second.state).toBe("FAILED");
    expect(second.error).toContain("unknown settlement");
    expect(states(second)).not.toContain("SETTLEMENT_UNKNOWN");
    expect(s.signer.calls).toHaveLength(1);
    expect(s.fac.verifyCalls).toHaveLength(1);
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("settle success:true without a tx hash -> SETTLEMENT_UNKNOWN, no payment proof", async () => {
    const s = await startStack();
    s.fac.settle = res => void res.json({ success: true, transaction: "", network: CARDANO_NETWORK, payer: BUYER });
    const run = await s.run();

    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(run)).toBe("settle reported success without a transaction hash");
    expect(run.payment).toBeUndefined();
    expect(run.report).toBeUndefined();
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("settlement_pending: core retries settle exactly once, then SETTLEMENT_UNKNOWN with the tx hash", async () => {
    const s = await startStack();
    s.fac.settle = settlePending;
    const run = await s.run();

    expect(s.fac.settleCalls).toHaveLength(2);
    expect(s.fac.settleCalls[1]).toEqual(s.fac.settleCalls[0]);
    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(run)).toBe(`tx ${TX}: HTTP 402, settlement_pending`);
    expect(run.payment).toBeUndefined();
    expect(s.agent.spentLovelace).toBe(PRICE);
    expect(s.signer.calls).toHaveLength(1);
  });

  it("settlement_pending resolved by the single core retry -> PAID", async () => {
    const s = await startStack();
    s.fac.settle = (res, call) => (call === 1 ? settlePending : settleOk)(res, call);
    const run = await s.run();

    expect(run.state).toBe("DRAFT_READY");
    expect(run.payment?.transactionHash).toBe(TX);
    expect(s.fac.settleCalls).toHaveLength(2);
    expect(s.signer.calls).toHaveLength(1);
  });

  const breakdowns: Array<{ name: string; breakIt: (fac: StubFacilitator) => void; settles: number; note: string | RegExp }> = [
    {
      name: "is unreachable after verify",
      breakIt: fac => {
        fac.verify = (res, call) => {
          fac.refuseNewConnections();
          res.setHeader("connection", "close");
          verifyOk(res, call);
        };
      },
      settles: 0,
      note: /^HTTP 402, fetch failed$/,
    },
    { name: "drops the connection", breakIt: fac => void (fac.settle = res => void res.socket?.destroy()), settles: 1, note: /^HTTP 402, fetch failed$/ },
    {
      name: "returns HTTP 500",
      breakIt: fac => void (fac.settle = res => void res.status(500).send("upstream down")),
      settles: 1,
      note: "HTTP 402, Facilitator settle failed (500): upstream down",
    },
    {
      name: "returns HTTP 400 with a settle error",
      breakIt: fac => void (fac.settle = settleFailed("exact_cardano_settlement_failed", 400)),
      settles: 1,
      note: `tx ${TX}: HTTP 402, exact_cardano_settlement_failed`,
    },
    { name: "returns a malformed body", breakIt: fac => void (fac.settle = res => void res.json({ ok: true })), settles: 1, note: "HTTP 502" },
  ];

  it.each(breakdowns)("facilitator settle $name -> SETTLEMENT_UNKNOWN", async ({ breakIt, settles, note }) => {
    const s = await startStack();
    breakIt(s.fac);
    const run = await s.run();

    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(run)).toMatch(note);
    expect(run.payment).toBeUndefined();
    expect(s.agent.spentLovelace).toBe(PRICE);
    expect(s.signer.calls).toHaveLength(1);
    expect(s.fac.settleCalls).toHaveLength(settles);
  });

  it("verify isValid:false after signing -> SETTLEMENT_UNKNOWN (seller holds a signed tx); no handler, no settle", async () => {
    const s = await startStack();
    s.fac.verify = res => void res.json({ isValid: false, invalidReason: "invalid_exact_cardano_payload_amount_insufficient", payer: BUYER });
    const run = await s.run();

    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(run)).toBe("HTTP 402");
    expect(s.agent.spentLovelace).toBe(PRICE);
    expect(s.signer.calls).toHaveLength(1);
    expect(s.events).toEqual(["verify"]);
    expect(s.fac.settleCalls).toHaveLength(0);
  });

  it("offer payTo not on the allowlist -> nothing signed, FAILED, no spend", async () => {
    const s = await startStack({ seller: { SELLER_ADDRESS: ATTACKER } });
    const run = await s.run();

    expect(run.state).toBe("FAILED");
    expect(run.error).toContain("filtered out by policies");
    expect(states(run)).not.toContain("SETTLEMENT_UNKNOWN");
    expect(s.signer.calls).toHaveLength(0);
    expect(s.fac.verifyCalls).toHaveLength(0);
    expect(s.agent.spentLovelace).toBe(0n);
  });

  it("price above MAX_PRICE_LOVELACE -> nothing signed", async () => {
    const s = await startStack({ seller: { PRICE_LOVELACE: "3000001" } });
    const run = await s.run();

    expect(run.state).toBe("FAILED");
    expect(run.error).toContain("rejected by spendControls");
    expect(s.signer.calls).toHaveLength(0);
    expect(s.agent.spentLovelace).toBe(0n);
  });

  it("session budget exhausted -> next run refused before signing", async () => {
    const s = await startStack({ buyer: { SESSION_BUDGET_LOVELACE: "3000000" } });
    expect((await s.run()).state).toBe("DRAFT_READY");
    const next = await s.run({ ...invoice, id: "INV-2026-1043" });

    expect(next.state).toBe("FAILED");
    expect(next.error).toContain("session budget exhausted");
    expect(s.signer.calls).toHaveLength(1);
    expect(s.fac.verifyCalls).toHaveLength(1);
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("invoice already PAID -> new run refused before signing", async () => {
    const s = await startStack();
    expect((await s.run()).state).toBe("DRAFT_READY");
    const again = await s.run();

    expect(again.state).toBe("FAILED");
    expect(again.error).toContain("already paid");
    expect(s.signer.calls).toHaveLength(1);
    expect(s.fac.settleCalls).toHaveLength(1);
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("two concurrent runs for the same invoice sign only once", async () => {
    const s = await startStack();
    const [a, b] = await Promise.all([s.run(), s.run()]);

    expect(s.signer.calls).toHaveLength(1);
    expect([a.state, b.state].sort()).toEqual(["DRAFT_READY", "FAILED"]);
    expect([a, b].find(r => r.state === "FAILED")?.error).toContain("in progress");
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("concurrent runs cannot overrun the session budget", async () => {
    const s = await startStack({ buyer: { SESSION_BUDGET_LOVELACE: "3000000" } });
    await Promise.all([s.run(), s.run({ ...invoice, id: "INV-2026-1043" })]);

    expect(s.signer.calls).toHaveLength(1);
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("signer error before anything was sent -> FAILED, no spend, invoice not locked", async () => {
    const s = await startStack();
    s.signer.fail = new Error("wallet locked");
    const failed = await s.run();

    expect(failed.state).toBe("FAILED");
    expect(failed.error).toContain("wallet locked");
    expect(s.fac.verifyCalls).toHaveLength(0);
    expect(s.agent.spentLovelace).toBe(0n);

    s.signer.fail = undefined;
    expect((await s.run()).state).toBe("DRAFT_READY");
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("a second buyer paying the same invoice under a new key gets a duplicate -> BLOCKED", async () => {
    const s = await startStack();
    expect((await s.run()).state).toBe("DRAFT_READY");
    // Own ledger, e.g. after a restart: only the seller's duplicate check catches it.
    const other = new BuyerAgent(s.config, s.runs, stubSigner());
    const run = s.runs.create(JSON.stringify(invoice));
    await other.process(run);

    expect(run.state).toBe("BLOCKED");
    expect(states(run).slice(-2)).toEqual(["PAID", "BLOCKED"]);
    expect(duplicateCheck(run.report)).toBe("fail");
    expect(run.draft).toBeUndefined();
    expect(other.spentLovelace).toBe(PRICE);
  });
});

describe("seller x402 contract (direct x402 client)", () => {
  const payDirect = (url: string, signer: ClientCardanoSigner) => {
    const client = new x402Client().setSpendControls({ allowedAssets: [{ network: CARDANO_NETWORK, asset: "lovelace" }] });
    client.register("cardano:*", new ExactCardanoScheme(signer));
    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    return (idempotencyKey: string) =>
      fetchWithPayment(`${url}${READINESS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ invoice }),
      });
  };

  it("withholds the body on failed settle; same key returns the same report, a new key is a duplicate", async () => {
    const s = await startStack();
    s.fac.settle = (res, call) => (call === 1 ? settleFailed("exact_cardano_settlement_failed") : settleOk)(res, call);
    const pay = payDirect(s.sellerUrl, s.signer);

    const withheld = await pay("key-1");
    expect(withheld.status).toBe(402);
    expect(await withheld.json()).toEqual({});
    expect(decodePaymentResponseHeader(withheld.headers.get("payment-response")!)).toMatchObject({
      success: false,
      errorReason: "exact_cardano_settlement_failed",
      transaction: TX,
    });
    expect(s.events).toEqual(["verify", "handler", "settle"]);

    const retried = await pay("key-1");
    expect(retried.status).toBe(200);
    expect(decodePaymentResponseHeader(retried.headers.get("payment-response")!)).toMatchObject({ success: true, transaction: TX });
    const report = (await retried.json()) as ReadinessReport;
    expect(report).toEqual(s.handled[0]); // cached, not re-evaluated as a duplicate of itself
    expect(report.verdict).toBe("ready_for_review");
    expect(duplicateCheck(report)).toBe("pass");

    const other = (await (await pay("key-2")).json()) as ReadinessReport;
    expect(other.verdict).toBe("blocked");
    expect(duplicateCheck(other)).toBe("fail");
    expect(s.signer.calls).toHaveLength(3);
  });
});
