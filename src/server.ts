import express from "express";
import { BuyerAgent } from "./agent.js";
import { CashXChainClient, CXC_SANDBOX_API } from "./cashxchain.js";
import { loadConfig } from "./config.js";
import { mountLocalFacilitator } from "./facilitator.js";
import { SAMPLE_INVOICES } from "./fixtures.js";
import { PayoutDesk, rejectDraft } from "./payout.js";
import { RunStore } from "./runs.js";
import { mountSeller } from "./seller.js";

const config = loadConfig();
const runs = new RunStore();
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static("public"));

// The readiness checks run between x402 verify and settle, inside the signed tx's validity window:
// short timeout there (fallback to fixtures). Payouts keep the default.
const apiKey = config.CASHXCHAIN_API_KEY;
const readinessCxc = apiKey ? new CashXChainClient({ apiKey, timeoutMs: 8_000 }) : undefined;

if (config.LOCAL_FACILITATOR) mountLocalFacilitator(app, config);
mountSeller(app, config, readinessCxc);

const payouts = apiKey ? new PayoutDesk(new CashXChainClient({ apiKey }), runs) : undefined;
const agent = config.x402Ready ? new BuyerAgent(config, runs, undefined, payouts) : undefined;

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
    cashxchain: { ready: config.cxcReady, environment: "sandbox", api: CXC_SANDBOX_API },
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
      payoutId: run.payout?.id,
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

// Human decision on a draft. Approve is the only route to a CashXChain payout; approving an
// in-flight or unknown payout re-checks it under the same Idempotency-Key.
app.post("/api/runs/:id/:decision", (req, res) => {
  const run = runs.get(req.params.id);
  const { decision } = req.params;
  if (!run || (decision !== "approve" && decision !== "reject")) {
    res.status(404).json({ error: run ? "unknown decision" : "run not found" });
    return;
  }
  if (decision === "approve" && !payouts) {
    res.status(503).json({ error: "CashXChain payouts not configured (CASHXCHAIN_API_KEY)" });
    return;
  }
  const result = decision === "approve" ? payouts!.approve(run) : rejectDraft(runs, run);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(decision === "approve" ? 202 : 200).json({ id: run.id, state: run.state });
});

app.listen(config.PORT, () => {
  console.log(`CxC AgentPay on ${config.baseUrl}`);
  console.log(`  facilitator: ${config.facilitatorUrl}`);
  console.log(`  x402Ready=${config.x402Ready} aiReady=${config.aiReady} cxcReady=${config.cxcReady} (sandbox)`);
  if (agent) console.log(`  buyer: ${agent.buyerAddress}\n  seller: ${config.SELLER_ADDRESS}`);
});
