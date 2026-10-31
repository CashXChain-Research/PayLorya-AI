import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express, type Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { decodeCardanoTransaction, type ClientCardanoSignInput, type ClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { BuyerAgent, type PayoutRails } from "../src/agent.js";
import { isDefinitiveSubmitRejection, type ChainSubmitter, type ChainView, type FiatPayoutClient, type FiatPayoutRequest } from "../src/payout.js";
import { CRYPTO_PAYEE, payoutKey } from "../src/routing.js";
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
const PAYOUT_TX = "5c".repeat(32);
const PRICE = 2_000_000n;
// Real bech32 Preprod addresses (the seller's readiness check validates the payee wallet).
const SUPPLIER_WALLET = "addr_test1qrh6ayyhzdj2q464ayvyft9awz46ne46hyzwmjsq6s2frflw7j6laqexupvgqym3smjccxmwu6fc3tyu07kffmh4fkyscvyuvz";
const SWAPPED_WALLET = "addr_test1qrpz79mnach4j9e8g4cwg9gdtqtmcvdps8ess7tn0p6zjnw7x56p9fpsf5erudw33l64y8ul40f03rgfvv5658dgvrqstj4mdu";

const invoice: Invoice = {
  id: "INV-2026-1042",
  supplier: "Brenner Maschinenbau GmbH",
  destinationCountry: "DE",
  currency: "EUR",
  amountMinor: 1_248_000,
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};

const adaInvoice: Invoice = {
  id: "NNS-2026-118",
  supplier: CRYPTO_PAYEE,
  destinationCountry: "EE",
  currency: "ADA",
  amountMinor: 3_500_000,
  cardanoAddress: SUPPLIER_WALLET,
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
  /** Base64 tx to return instead of the opaque placeholder (e.g. a decodable one). */
  transaction?: string;
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
      return { transaction: signer.transaction ?? Buffer.from(`stub-signed-tx-${n}`).toString("base64"), nonce: `${"ab".repeat(32)}#${n}` };
    },
  };
  return signer;
}

interface StubFiat extends FiatPayoutClient {
  calls: FiatPayoutRequest[];
  fail?: Error;
}

/** A fiat client that marks errors starting with "refused:" as definitive (nothing sent). */
function stubFiat(): StubFiat {
  const fiat: StubFiat = {
    simulated: false,
    label: "Stub CashXChain sandbox payout",
    calls: [],
    isDefinitiveRejection: error => error instanceof Error && error.message.startsWith("refused:"),
    async payout(request) {
      fiat.calls.push(request);
      if (fiat.fail) throw fiat.fail;
      return { reference: `po_${fiat.calls.length}` };
    },
  };
  return fiat;
}

interface StubSubmitter extends ChainSubmitter {
  calls: string[];
  fail?: Error;
  status: "confirmed" | "mempool";
}

function stubSubmitter(): StubSubmitter {
  const submitter: StubSubmitter = {
    calls: [],
    status: "confirmed",
    isDefinitiveRejection: isDefinitiveSubmitRejection,
    async submit(tx) {
      submitter.calls.push(tx);
      if (submitter.fail) throw submitter.fail;
      return { txHash: PAYOUT_TX, status: submitter.status };
    },
  };
  return submitter;
}

// Smallest tx the SDK decoder accepts: [body {0: inputs, 1: outputs, 2: fee}, witnesses {}, valid, no aux].
function decodableTx(): string {
  const cbor = (v: unknown): Buffer => {
    const head = (major: number, n: number) =>
      n < 24 ? Buffer.from([(major << 5) | n])
      : n < 256 ? Buffer.from([(major << 5) | 24, n])
      : Buffer.from([(major << 5) | 26, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    if (v === null) return Buffer.from([0xf6]);
    if (v === true) return Buffer.from([0xf5]);
    if (typeof v === "number") return head(0, v);
    if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
    if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
    if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
    throw new Error(`cannot encode ${String(v)}`);
  };
  const body = new Map<number, unknown>([
    [0, [[Buffer.alloc(32, 0xab), 1]]],
    [1, [[Buffer.concat([Buffer.from([0x60]), Buffer.alloc(28, 0x11)]), 2_000_000]]],
    [2, 170_000],
  ]);
  return cbor([body, new Map(), true, null]).toString("base64");
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

/** Replaces the seller's report on its way out; `send` is the original res.json. */
type Tamper = (res: Response, send: (body: unknown) => Response) => Response;

async function startStack(
  opts: { seller?: Env; buyer?: Env; tamperReport?: Tamper; chain?: ChainView; walletSync?: PayoutRails["walletSync"]; fiat?: FiatPayoutClient } = {},
) {
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
        if (opts.tamperReport) return opts.tamperReport(res, json);
      }
      return json(body);
    };
    next();
  });
  const { url: sellerUrl } = await listen(app);
  mountSeller(app, loadConfig(env(fac.url, opts.seller)));

  const config = loadConfig(env(fac.url, { PUBLIC_BASE_URL: sellerUrl, SUPPLIER_CARDANO_ADDRESS: SUPPLIER_WALLET, ...opts.buyer }));
  const runs = new RunStore();
  const signer = stubSigner();
  const submitter = stubSubmitter();
  // No grace by default so tests stay fast; wallet-sync tests set their own.
  const agent = new BuyerAgent(config, runs, signer, { submitter, fiat: opts.fiat, chain: opts.chain, walletSync: { graceMs: 0, ...opts.walletSync } });
  const run = async (inv: Invoice = invoice): Promise<Run> => {
    const r = runs.create(JSON.stringify(inv));
    await agent.process(r);
    return r;
  };
  return { events, handled, fac, sellerUrl, config, runs, signer, submitter, agent, run };
}

async function approve(agent: BuyerAgent, run: Run): Promise<void> {
  const started = agent.approve(run);
  if (!started.ok) throw new Error(started.reason);
  await started.done;
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
    expect(run.draft).toMatchObject({ status: "awaiting_human_approval", executable: true, invoiceId: invoice.id });
    expect(run.draft?.route).toMatchObject({ status: "selected", rail: "cxc_fiat", destination: invoice.iban });
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
    expect(first.settlement).toEqual({
      transactionHash: TX,
      explorerUrl: `https://preprod.cardanoscan.io/transaction/${TX}`,
      reason: "HTTP 402, exact_cardano_settlement_failed",
    });
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

  const breakdowns: Array<{ name: string; breakIt: (fac: StubFacilitator) => void; settles: number; note: string | RegExp; tx?: string }> = [
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
      tx: TX,
    },
    { name: "returns a malformed body", breakIt: fac => void (fac.settle = res => void res.json({ ok: true })), settles: 1, note: "HTTP 502" },
  ];

  it.each(breakdowns)("facilitator settle $name -> SETTLEMENT_UNKNOWN", async ({ breakIt, settles, note, tx }) => {
    const s = await startStack();
    breakIt(s.fac);
    const run = await s.run();

    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(lastNote(run)).toMatch(note);
    expect(run.settlement?.reason).toBe(run.error);
    expect(run.settlement?.transactionHash).toBe(tx); // the placeholder signed tx is not decodable
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
    expect(lastNote(run)).toBe("HTTP 402, invalid_exact_cardano_payload_amount_insufficient");
    expect(run.settlement?.reason).toBe(run.error);
    expect(s.agent.spentLovelace).toBe(PRICE);
    expect(s.signer.calls).toHaveLength(1);
    expect(s.events).toEqual(["verify"]);
    expect(s.fac.settleCalls).toHaveLength(0);
  });

  it("verify rejected with an error status -> SETTLEMENT_UNKNOWN with the facilitator's reason and message", async () => {
    const s = await startStack();
    s.fac.verify = res =>
      void res.status(400).json({ isValid: false, invalidReason: "invalid_exact_cardano_payload_input_not_available", invalidMessage: "input spent", payer: BUYER });
    const run = await s.run();

    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(run.error).toBe("HTTP 402, invalid_exact_cardano_payload_input_not_available: input spent");
    expect(run.settlement?.reason).toBe(run.error);
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

  it("lost settle response: settlement carries the hash of the tx we signed", async () => {
    const s = await startStack();
    s.signer.transaction = decodableTx();
    s.fac.settle = res => void res.socket?.destroy();
    const run = await s.run();

    const signed = decodeCardanoTransaction(s.signer.transaction).txHash;
    expect(signed).toMatch(/^[0-9a-f]{64}$/);
    expect(run.state).toBe("SETTLEMENT_UNKNOWN");
    expect(run.settlement).toEqual({
      transactionHash: signed,
      explorerUrl: `https://preprod.cardanoscan.io/transaction/${signed}`,
      reason: "HTTP 402, fetch failed",
    });
    expect(lastNote(run)).toBe(`tx ${signed}: HTTP 402, fetch failed`);
  });

  const tampers: Array<{ name: string; tamper: Tamper }> = [
    { name: "not JSON", tamper: res => res.type("text/plain").send("<html>oops</html>") },
    { name: "JSON but not a report", tamper: (_res, send) => send({ ok: true }) },
  ];

  it.each(tampers)("paid but the report body is $name -> FAILED, payment kept, invoice locked", async ({ tamper }) => {
    const s = await startStack({ tamperReport: tamper });
    const run = await s.run();

    expect(states(run)).toEqual(["CREATED", "EXTRACTED", "PRECHECKED", "PAYING", "PAID", "FAILED"]);
    expect(run.error).toBe(`paid (tx ${TX}), but the seller returned no readable report; the invoice stays locked as paid`);
    expect(run.payment?.transactionHash).toBe(TX);
    expect(run.report).toBeUndefined();
    expect(run.draft).toBeUndefined();
    expect(s.agent.spentLovelace).toBe(PRICE);

    const again = await s.run();
    expect(again.state).toBe("FAILED");
    expect(again.error).toContain("already paid");
    expect(s.signer.calls).toHaveLength(1);
  });

  it("two concurrent runs for the same invoice sign only once", async () => {
    const s = await startStack();
    const [a, b] = await Promise.all([s.run(), s.run()]);

    expect(s.signer.calls).toHaveLength(1);
    expect([a.state, b.state].sort()).toEqual(["DRAFT_READY", "FAILED"]);
    // Payments queue per wallet, so the second run only gets its turn after the first one paid.
    expect([a, b].find(r => r.state === "FAILED")?.error).toContain("already paid");
    expect(s.agent.spentLovelace).toBe(PRICE);
  });

  it("concurrent runs for different invoices pay one after another (no shared UTxO in flight)", async () => {
    const s = await startStack();
    const sign = s.signer.buildAndSignPaymentTransaction.bind(s.signer);
    s.signer.buildAndSignPaymentTransaction = input => {
      s.events.push("sign");
      return sign(input);
    };
    const [a, b] = await Promise.all([s.run(), s.run({ ...invoice, id: "INV-2026-1043" })]);

    expect([a.state, b.state]).toEqual(["DRAFT_READY", "DRAFT_READY"]);
    expect(s.events).toEqual(["sign", "verify", "handler", "settle", "sign", "verify", "handler", "settle"]);
    expect(s.agent.spentLovelace).toBe(2n * PRICE);
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
    const other = new BuyerAgent(s.config, s.runs, stubSigner(), { walletSync: { graceMs: 0 } });
    const run = s.runs.create(JSON.stringify(invoice));
    await other.process(run);

    expect(run.state).toBe("BLOCKED");
    expect(states(run).slice(-2)).toEqual(["PAID", "BLOCKED"]);
    expect(duplicateCheck(run.report)).toBe("fail");
    expect(run.draft).toBeUndefined();
    expect(other.spentLovelace).toBe(PRICE);
  });
});

describe("invoice payout after human approval", () => {
  it("fiat: approval executes the simulated CashXChain payout to the verified account, no extra signing", async () => {
    const s = await startStack();
    const run = await s.run();
    expect(run.state).toBe("DRAFT_READY");

    await approve(s.agent, run);
    expect(states(run).slice(-3)).toEqual(["DRAFT_READY", "EXECUTING", "EXECUTED"]);
    expect(run.payout).toMatchObject({
      rail: "cxc_fiat",
      status: "simulated",
      simulated: true,
      destination: invoice.iban,
      amountMinor: invoice.amountMinor,
      currency: "EUR",
      reference: expect.stringMatching(/^cxc_sim_[0-9a-f]{16}$/),
    });
    expect(s.signer.calls).toHaveLength(1); // the report fee only
    expect(s.submitter.calls).toHaveLength(0);
    expect(s.agent.paidOutLovelace).toBe(0n);
  });

  it("crypto: approval pays tADA to the verified wallet with the exact signed tx", async () => {
    const s = await startStack();
    const run = await s.run(adaInvoice);
    expect(run.state).toBe("DRAFT_READY");
    expect(run.report?.checks.find(c => c.id === "account")?.status).toBe("pass");
    expect(run.draft).toMatchObject({ executable: true, route: { status: "selected", rail: "cardano_preprod", destination: SUPPLIER_WALLET } });

    await approve(s.agent, run);
    expect(run.state).toBe("EXECUTED");
    expect(s.signer.calls).toHaveLength(2);
    expect(s.signer.calls[1]).toEqual({
      network: CARDANO_NETWORK,
      payTo: SUPPLIER_WALLET,
      asset: "lovelace",
      amount: "3500000",
      maxTimeoutSeconds: 600,
      extra: { assetTransferMethod: "default" },
    });
    expect(s.submitter.calls).toEqual([Buffer.from("stub-signed-tx-2").toString("base64")]);
    expect(run.payout).toMatchObject({
      rail: "cardano_preprod",
      status: "confirmed",
      simulated: false,
      reference: PAYOUT_TX,
      explorerUrl: `https://preprod.cardanoscan.io/transaction/${PAYOUT_TX}`,
    });
    expect(lastNote(run)).toBe(PAYOUT_TX);
    expect(s.agent.paidOutLovelace).toBe(3_500_000n);
    expect(s.agent.spentLovelace).toBe(PRICE); // report fees and payouts have separate budgets
  });

  it("crypto: a broadcast that times out before confirmation is reported as submitted", async () => {
    const s = await startStack();
    s.submitter.status = "mempool";
    const run = await s.run(adaInvoice);
    await approve(s.agent, run);
    expect(run.state).toBe("EXECUTED");
    expect(run.payout).toMatchObject({ status: "submitted", reference: PAYOUT_TX });
  });

  it("crypto: a wallet on the invoice that differs from the payee record is BLOCKED before any payout", async () => {
    const s = await startStack();
    const run = await s.run({ ...adaInvoice, cardanoAddress: SWAPPED_WALLET });

    expect(run.state).toBe("BLOCKED");
    expect(run.report?.verdict).toBe("ready_for_review"); // the address itself is valid
    expect(run.route).toMatchObject({ status: "blocked", rail: "cardano_preprod" });
    expect(run.route?.destination).toBeUndefined();
    expect(JSON.stringify(run.route)).not.toContain(SWAPPED_WALLET);
    expect(run.draft).toBeUndefined();
    expect(s.agent.approve(run)).toMatchObject({ ok: false });
    expect(s.signer.calls).toHaveLength(1);
  });

  it("fiat: a definitive refusal returns the draft; approving again reuses the per-invoice key and the payee record", async () => {
    const fiat = stubFiat();
    const s = await startStack({ fiat });
    const run = await s.run();
    fiat.fail = new Error("refused: insufficient_balance");
    await approve(s.agent, run);

    expect(states(run).slice(-2)).toEqual(["EXECUTING", "DRAFT_READY"]);
    expect(lastNote(run)).toBe("Payout refused before it was sent, nothing paid; approve again: refused: insufficient_balance");
    expect(run.payout).toBeUndefined();

    fiat.fail = undefined;
    await approve(s.agent, run);
    expect(run.state).toBe("EXECUTED");
    expect(run.payout).toMatchObject({ rail: "cxc_fiat", status: "submitted", simulated: false, reference: "po_2" });
    const brenner = { name: "Brenner Maschinenbau GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" };
    const key = `payout-${payoutKey(brenner, invoice)}`;
    expect(fiat.calls.map(c => c.idempotencyKey)).toEqual([key, key]);
    expect(fiat.calls[0]?.payee).toEqual(brenner);
  });

  it("the same invoice extracted differently (supplier text, id case) pays out once", async () => {
    const fiat = stubFiat();
    const s = await startStack({ fiat });
    const first = await s.run();
    // What a second extraction of the same paper invoice could look like.
    const second = await s.run({ ...invoice, supplier: "Brenner Maschinenbau GmbH, Augsburg", id: " inv 2026-1042 " });
    expect([first.state, second.state]).toEqual(["DRAFT_READY", "DRAFT_READY"]);
    expect(second.fingerprint).not.toBe(first.fingerprint);

    await approve(s.agent, first);
    await approve(s.agent, second);
    expect(first.state).toBe("EXECUTED");
    expect(second.state).toBe("FAILED");
    expect(second.error).toContain("already paid");
    expect(fiat.calls).toHaveLength(1);
  });

  it("fiat: any other error may have reached CashXChain -> PAYOUT_UNKNOWN, invoice locked", async () => {
    const fiat = stubFiat();
    const s = await startStack({ fiat });
    const run = await s.run();
    fiat.fail = new Error("timeout after POST /v1/banking/payouts");
    await approve(s.agent, run);

    expect(run.state).toBe("PAYOUT_UNKNOWN");
    expect(run.payout).toMatchObject({ rail: "cxc_fiat", status: "unknown" });
    expect(s.agent.approve(run)).toMatchObject({ ok: false });
    expect(fiat.calls).toHaveLength(1);
  });

  it("crypto: node refuses the payout before broadcast -> back to DRAFT_READY, nothing counted, approve again pays", async () => {
    const s = await startStack();
    const run = await s.run(adaInvoice);
    s.submitter.fail = new Error('Blockfrost submitTx failed: 400 {"error":"Bad Request","message":"BadInputsUTxO","status_code":400}');
    await approve(s.agent, run);

    expect(states(run).slice(-2)).toEqual(["EXECUTING", "DRAFT_READY"]);
    expect(lastNote(run)).toMatch(/^Payout refused before broadcast, nothing paid; approve again: Blockfrost submitTx failed: 400 /);
    expect(run.payout).toBeUndefined();
    expect(s.agent.paidOutLovelace).toBe(0n);

    s.submitter.fail = undefined;
    await approve(s.agent, run);
    expect(run.state).toBe("EXECUTED");
    expect(run.payout).toMatchObject({ status: "confirmed", reference: PAYOUT_TX });
    expect(s.submitter.calls).toHaveLength(2);
    expect(s.agent.paidOutLovelace).toBe(3_500_000n);
  });

  it("crypto: submit error after signing -> PAYOUT_UNKNOWN, amount counted, invoice locked", async () => {
    const s = await startStack();
    const run = await s.run(adaInvoice);
    s.signer.transaction = decodableTx();
    s.submitter.fail = new Error("Blockfrost submitTx failed: socket hang up");
    await approve(s.agent, run);

    const signed = decodeCardanoTransaction(s.signer.transaction).txHash;
    expect(run.state).toBe("PAYOUT_UNKNOWN");
    expect(run.payout).toMatchObject({ status: "unknown", reference: signed, explorerUrl: `https://preprod.cardanoscan.io/transaction/${signed}` });
    expect(lastNote(run)).toBe(`tx ${signed}: Blockfrost submitTx failed: socket hang up`);
    expect(s.agent.paidOutLovelace).toBe(3_500_000n);
  });

  it("signer error before anything was sent -> FAILED, nothing counted", async () => {
    const s = await startStack();
    const run = await s.run(adaInvoice);
    s.signer.fail = new Error("Funding wallet has no UTXOs available for the payment");
    await approve(s.agent, run);
    expect(run.state).toBe("FAILED");
    expect(run.payout).toBeUndefined();
    expect(s.submitter.calls).toHaveLength(0);
    expect(s.agent.paidOutLovelace).toBe(0n);
  });

  it("approval is one-shot: a double click starts one payout; reject only from DRAFT_READY", async () => {
    const s = await startStack();
    const run = await s.run(adaInvoice);
    const first = s.agent.approve(run);
    const second = s.agent.approve(run);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "run is EXECUTING, not awaiting approval" });
    if (first.ok) await first.done;
    expect(s.submitter.calls).toHaveLength(1);
    expect(s.agent.reject(run)).toEqual({ ok: false, reason: "run is EXECUTED, not awaiting approval" });

    const other = await s.run({ ...adaInvoice, id: "NNS-2026-120" });
    expect(s.agent.reject(other)).toEqual({ ok: true });
    expect(other.state).toBe("REJECTED");
    expect(s.agent.approve(other)).toMatchObject({ ok: false });
  });

  it("unknown payee: draft is not executable and approval is refused", async () => {
    const s = await startStack();
    const run = await s.run({ ...invoice, supplier: "Unverified Trading GmbH" });
    expect(run.state).toBe("DRAFT_READY");
    expect(run.draft).toMatchObject({ executable: false, route: { status: "unavailable" } });
    expect(s.agent.approve(run)).toEqual({ ok: false, reason: "Payee not verified: onboard the payee before any payout" });
  });

  it("payout budget: a payout that would exceed it is refused before signing", async () => {
    const s = await startStack({ buyer: { PAYOUT_BUDGET_LOVELACE: "5000000" } });
    const a = await s.run(adaInvoice);
    const b = await s.run({ ...adaInvoice, id: "NNS-2026-120" });
    await approve(s.agent, a);
    await approve(s.agent, b);
    expect(a.state).toBe("EXECUTED");
    expect(b.state).toBe("FAILED");
    expect(b.error).toBe("payout refused before signing: session budget exhausted");
    expect(s.signer.calls).toHaveLength(3); // two report fees, one payout
  });
});

describe("wallet sync between transactions from the buyer wallet", () => {
  type Stack = Awaited<ReturnType<typeof startStack>>;
  const second = { ...invoice, id: "INV-2026-1043" };
  // Records "sign" in the event log so the order of lookups and signatures is visible.
  const traceSigner = (s: Stack) => {
    const sign = s.signer.buildAndSignPaymentTransaction.bind(s.signer);
    s.signer.buildAndSignPaymentTransaction = input => {
      s.events.push("sign");
      return sign(input);
    };
  };

  it("the next payment waits until the previous tx is indexed", async () => {
    const answers = [false, false, true];
    let s!: Stack;
    const chain: ChainView = {
      async hasTransaction(hash) {
        s.events.push(`lookup ${hash === TX ? "TX" : hash}`);
        return answers.shift() ?? true;
      },
    };
    s = await startStack({ chain, walletSync: { pollMs: 1 } });
    traceSigner(s);

    expect((await s.run()).state).toBe("DRAFT_READY");
    expect((await s.run(second)).state).toBe("DRAFT_READY");
    expect(s.events).toEqual([
      ...["sign", "verify", "handler", "settle"],
      ...["lookup TX", "lookup TX", "lookup TX"],
      ...["sign", "verify", "handler", "settle"],
    ]);
  });

  it("waits a grace period after the previous tx settled, for other indexers", async () => {
    const s = await startStack({ chain: { hasTransaction: async () => true }, walletSync: { graceMs: 150 } });
    await s.run();
    const start = Date.now();
    expect((await s.run(second)).state).toBe("DRAFT_READY");
    expect(Date.now() - start).toBeGreaterThanOrEqual(120);
  });

  it("a tx that never shows up delays the next payment only up to the timeout", async () => {
    let lookups = 0;
    const s = await startStack({ chain: { hasTransaction: async () => (lookups++, false) }, walletSync: { timeoutMs: 40, pollMs: 5 } });
    await s.run();
    expect((await s.run(second)).state).toBe("DRAFT_READY");
    expect(lookups).toBeGreaterThan(1);
    expect(s.signer.calls).toHaveLength(2);
  });

  it("a verify rejection was never broadcast, so it is not waited for", async () => {
    let lookups = 0;
    const s = await startStack({ chain: { hasTransaction: async () => (lookups++, true) }, walletSync: { graceMs: 10_000 } });
    s.fac.verify = res => void res.json({ isValid: false, invalidReason: "invalid_exact_cardano_payload_input_not_available", payer: BUYER });
    expect((await s.run()).state).toBe("SETTLEMENT_UNKNOWN");
    s.fac.verify = verifyOk;
    expect((await s.run(second)).state).toBe("DRAFT_READY");
    expect(lookups).toBe(0);
  });

  it("a confirmed invoice payout is waited for before the next x402 payment", async () => {
    const seen: string[] = [];
    const s = await startStack({ chain: { hasTransaction: async hash => (seen.push(hash), true) } });
    const run = await s.run(adaInvoice);
    await approve(s.agent, run);
    expect(run.state).toBe("EXECUTED");
    await s.run(second);
    expect(seen).toEqual([TX, PAYOUT_TX]);
  });
});

describe("definitive submit rejection", () => {
  it.each([
    ['Blockfrost submitTx failed: 400 {"message":"BadInputsUTxO"}', true],
    ["Blockfrost submitTx failed: 500 Internal Server Error", false],
    ["Blockfrost submitTx failed: 4000 odd", false],
    ["Blockfrost submitTx returned an unexpected body: <html>", false],
    ["submitTx timed out after 120000ms", false],
    ["fetch failed", false],
  ])("%s -> %s", (message, definitive) => {
    expect(isDefinitiveSubmitRejection(new Error(message))).toBe(definitive);
  });

  it("non-errors are never definitive", () => {
    expect(isDefinitiveSubmitRejection("Blockfrost submitTx failed: 400 x")).toBe(false);
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
