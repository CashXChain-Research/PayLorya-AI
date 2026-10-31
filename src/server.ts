import express from "express";
import { BuyerAgent } from "./agent.js";
import { CashXChainClient, CXC_SANDBOX_API } from "./cashxchain.js";
import { loadConfig } from "./config.js";
import { mountLocalFacilitator } from "./facilitator.js";
import { sampleInvoices } from "./fixtures.js";
import { CashXChainPayoutRoute } from "./payout-cashxchain.js";
import { RunStore } from "./runs.js";
import { mountSeller } from "./seller.js";

const config = loadConfig();
const runs = new RunStore();
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static("public"));

if (config.LOCAL_FACILITATOR) mountLocalFacilitator(app, config);
mountSeller(app, config);

// Real CashXChain sandbox payouts when the key is set; otherwise the agent's simulated stand-in.
const fiat = config.CASHXCHAIN_API_KEY ? new CashXChainPayoutRoute(new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY })) : undefined;
const agent = config.x402Ready ? new BuyerAgent(config, runs, undefined, fiat ? { fiat } : {}) : undefined;

app.get(["/health", "/api/health"], (_req, res) => {
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
    cashxchain: { ready: config.cxcReady, environment: "sandbox", api: CXC_SANDBOX_API },
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
  const input = typeof req.body?.input === "string" ? req.body.input : JSON.stringify(req.body?.input ?? "");
  if (!input || input === '""') {
    res.status(400).json({ error: "body.input (invoice text or JSON) required" });
    return;
  }
  const run = runs.create(input);
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

// Human decision on a draft. Public on the demo deployment. tADA payouts are capped by
// PAYOUT_MAX/BUDGET_LOVELACE; CashXChain sandbox payouts only by the demo amount ceiling and the
// sandbox plan limits (test money).
app.post("/api/runs/:id/:decision", (req, res) => {
  const run = runs.get(req.params.id);
  const decision = req.params.decision;
  if (!agent || !run || (decision !== "approve" && decision !== "reject")) {
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
