import express from "express";
import { BuyerAgent } from "./agent.js";
import { decisionRefusal } from "./approval.js";
import { CashXChainClient, CXC_SANDBOX_API } from "./cashxchain.js";
import { createCfo, mountCfo, type PaymentEngine } from "./cfo/index.js";
import { loadConfig } from "./config.js";
import { mountLocalFacilitator } from "./facilitator.js";
import { sampleInvoices } from "./fixtures.js";
import { CashXChainPayoutRoute } from "./payout-cashxchain.js";
import { admitRun, clientId, RunRateLimiter } from "./ratelimit.js";
import { RunStore } from "./runs.js";
import { mountSeller } from "./seller.js";

const config = loadConfig();
const runs = new RunStore(config.MAX_RUNS);
const limiter = new RunRateLimiter(config.RUNS_PER_MINUTE_PER_CLIENT, config.RUNS_PER_HOUR);
// AI CFO payments get their own store: they never show up in the public demo inbox.
const engine: PaymentEngine = { runs: new RunStore(config.MAX_RUNS) };
const app = express();
// Before express.json(): Better Auth reads the raw body, and the CFO API parses its own (larger) bodies.
mountCfo(app, await createCfo(config, engine));
app.use(express.json({ limit: "256kb" }));
// "/app" and "/about" resolve to their .html pages.
app.use(express.static("public", { extensions: ["html"] }));

if (config.LOCAL_FACILITATOR) mountLocalFacilitator(app, config);
mountSeller(app, config);

// Real CashXChain sandbox payouts when the key is set; otherwise the agent's simulated stand-in.
const fiat = config.CASHXCHAIN_API_KEY ? new CashXChainPayoutRoute(new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY })) : undefined;
const agent = config.x402Ready ? new BuyerAgent(config, runs, undefined, fiat ? { fiat } : {}) : undefined;
engine.agent = agent;


app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    status: "ok",
    network: "cardano:preprod",
    x402Ready: config.x402Ready,
    aiReady: config.aiReady,
    facilitator: config.facilitatorUrl,
    buyerAddress: agent?.buyerAddress,
    sellerAddress: config.SELLER_ADDRESS,
    priceLovelace: config.PRICE_LOVELACE.toString(),
    maxPriceLovelace: config.MAX_PRICE_LOVELACE.toString(),
    sessionBudgetLovelace: config.SESSION_BUDGET_LOVELACE.toString(),
    spentLovelace: agent?.spentLovelace.toString() ?? "0",
    supplierCardanoAddress: config.SUPPLIER_CARDANO_ADDRESS,
    payoutMaxLovelace: config.PAYOUT_MAX_LOVELACE.toString(),
    payoutBudgetLovelace: config.PAYOUT_BUDGET_LOVELACE.toString(),
    paidOutLovelace: agent?.paidOutLovelace.toString() ?? "0",
    fiatPayoutMaxMinor: config.FIAT_PAYOUT_MAX_MINOR,
    fiatPayoutsPerSession: config.FIAT_PAYOUTS_PER_SESSION,
    fiatPayoutsUsed: agent?.fiatPayoutsUsed ?? 0,
    // Fail-closed: a token is always required; without APPROVE_TOKEN approvals are disabled (503).
    approvalTokenRequired: true,
    approvals: config.APPROVE_TOKEN ? "operator-token" : "disabled",
    cashxchain: { ready: config.cxcReady, environment: "sandbox", api: CXC_SANDBOX_API },
    // clientIdFrom: which header identified this caller (live check that CF-Connecting-IP reaches the container).
    limits: {
      runsPerMinutePerClient: config.RUNS_PER_MINUTE_PER_CLIENT,
      runsPerHour: config.RUNS_PER_HOUR,
      maxTextChars: config.MAX_TEXT_CHARS,
      maxRuns: config.MAX_RUNS,
      clientIdFrom: clientId(name => req.header(name), req.socket.remoteAddress).from,
    },
  });
});

app.get("/api/samples", (_req, res) => {
  res.json(sampleInvoices(config.SUPPLIER_CARDANO_ADDRESS));
});

app.post("/api/runs", (req, res) => {
  if (!agent) {
    res.status(503).json({ error: "x402 not configured (SELLER_ADDRESS, BUYER_MNEMONIC, BLOCKFROST_PROJECT_ID)" });
    return;
  }
  // 400 / 413 / 429 / 503 before any model call or payment (src/ratelimit.ts).
  const admitted = admitRun({ body: req.body, header: name => req.header(name), socketAddress: req.socket.remoteAddress }, { limiter, runs, maxTextChars: config.MAX_TEXT_CHARS });
  if (!admitted.ok) {
    res.status(admitted.status).set(admitted.headers).json(admitted.body);
    return;
  }
  const run = admitted.run;
  void agent.process(run);
  res.status(202).json({ id: run.id, state: run.state });
});

// Summaries for the inbox; the full run (input text included) stays behind /api/runs/:id.
app.get("/api/runs", (_req, res) => {
  res.json(
    runs.list().map(run => ({
      id: run.id,
      state: run.state,
      createdAt: run.createdAt,
      supplier: run.invoice?.supplier,
      invoiceId: run.invoice?.id,
      amountMinor: run.invoice?.amountMinor,
      currency: run.invoice?.currency,
      transactionHash: run.payment?.transactionHash,
      rail: run.route?.rail,
      payoutStatus: run.payout?.status,
    })),
  );
});

app.get("/api/runs/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  res.json(run);
});

// Human decision on a draft. Only an operator holding APPROVE_TOKEN can decide; without it approvals
// are disabled (fail-closed). Payouts are capped on top: tADA by PAYOUT_MAX/BUDGET_LOVELACE, fiat by
// FIAT_PAYOUT_MAX_MINOR and FIAT_PAYOUTS_PER_SESSION.
app.post("/api/runs/:id/:decision", (req, res) => {
  const decision = req.params.decision;
  if (decision !== "approve" && decision !== "reject") {
    res.status(404).json({ error: "not found" });
    return;
  }
  const refusal = decisionRefusal(config.APPROVE_TOKEN, req.header("authorization"), req.header("x-approve-token"));
  if (refusal) {
    res.status(refusal.status).json({ error: refusal.error });
    return;
  }
  const run = runs.get(req.params.id);
  if (!agent || !run) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const result = decision === "approve" ? agent.approve(run) : agent.reject(run);
  if (!result.ok) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.status(202).json({ id: run.id, state: run.state });
});

app.listen(config.PORT, () => {
  console.log(`CxC AgentPay on ${config.baseUrl}`);
  console.log(`  facilitator: ${config.facilitatorUrl}`);
  console.log(`  x402Ready=${config.x402Ready} aiReady=${config.aiReady}`);
  if (agent) console.log(`  buyer: ${agent.buyerAddress}\n  seller: ${config.SELLER_ADDRESS}`);
});
