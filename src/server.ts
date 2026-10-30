import express from "express";
import { BuyerAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { mountLocalFacilitator } from "./facilitator.js";
import { SAMPLE_INVOICES } from "./fixtures.js";
import { RunStore } from "./runs.js";
import { mountSeller } from "./seller.js";

const config = loadConfig();
const runs = new RunStore();
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static("public"));

if (config.LOCAL_FACILITATOR) mountLocalFacilitator(app, config);
mountSeller(app, config);

const agent = config.x402Ready ? new BuyerAgent(config, runs) : undefined;

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
  });
});

app.get("/api/samples", (_req, res) => {
  res.json(SAMPLE_INVOICES);
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

app.get("/api/runs/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  res.json(run);
});

app.listen(config.PORT, () => {
  console.log(`CxC AgentPay on ${config.baseUrl}`);
  console.log(`  facilitator: ${config.facilitatorUrl}`);
  console.log(`  x402Ready=${config.x402Ready} aiReady=${config.aiReady}`);
  if (agent) console.log(`  buyer: ${agent.buyerAddress}\n  seller: ${config.SELLER_ADDRESS}`);
});
