import express from "express";
import { BuyerAgent } from "./agent.js";
import { decisionRefusal } from "./approval.js";
import { CashXChainClient, CXC_SANDBOX_API } from "./cashxchain.js";
import { loadConfig } from "./config.js";
import { mountLocalFacilitator } from "./facilitator.js";
import { sampleInvoices } from "./fixtures.js";
import { CashXChainPayoutRoute } from "./payout-cashxchain.js";
import { admitRun, clientId, RunRateLimiter } from "./ratelimit.js";
import { RunStore } from "./runs.js";
import { mountSeller } from "./seller.js";
import { chat, ChatRequestSchema } from "./chat.js";
import { payeeDirectory } from "./routing.js";
import { HARD_MAX } from "./budget.js";
import { ZodError } from "zod";

const CHAT_PER_MINUTE_PER_CLIENT = 20;
const CHAT_PER_HOUR = 300;

const config = loadConfig();
const runs = new RunStore(config.MAX_RUNS);
const limiter = new RunRateLimiter(config.RUNS_PER_MINUTE_PER_CLIENT, config.RUNS_PER_HOUR);
// Every chat message is one or more model calls: its own, wider limits.
const chatLimiter = new RunRateLimiter(CHAT_PER_MINUTE_PER_CLIENT, CHAT_PER_HOUR);
const approvals = config.APPROVE_TOKEN ? ("operator-token" as const) : ("disabled" as const);
const app = express();
app.use(express.json({ limit: "256kb" }));
// "/app" and "/about" resolve to their .html pages.
app.use(express.static("public", { extensions: ["html"] }));

if (config.LOCAL_FACILITATOR) mountLocalFacilitator(app, config);
mountSeller(app, config);

// Real CashXChain sandbox payouts when the key is set; otherwise the agent's simulated stand-in.
const fiat = config.CASHXCHAIN_API_KEY ? new CashXChainPayoutRoute(new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY })) : undefined;
const agent = config.x402Ready ? new BuyerAgent(config, runs, undefined, fiat ? { fiat } : {}) : undefined;
const payees = payeeDirectory(config.SUPPLIER_CARDANO_ADDRESS);

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
    sessionBudgetLovelace: agent?.budget.checkBudgetLovelace ?? config.SESSION_BUDGET_LOVELACE.toString(),
    spentLovelace: agent?.spentLovelace.toString() ?? "0",
    supplierCardanoAddress: config.SUPPLIER_CARDANO_ADDRESS,
    payoutMaxLovelace: agent?.budget.cardanoPayoutMaxLovelace ?? config.PAYOUT_MAX_LOVELACE.toString(),
    payoutBudgetLovelace: agent?.budget.cardanoBudgetLovelace ?? config.PAYOUT_BUDGET_LOVELACE.toString(),
    paidOutLovelace: agent?.paidOutLovelace.toString() ?? "0",
    fiatPayoutMaxMinor: agent?.budget.fiatPayoutMaxMinor ?? config.FIAT_PAYOUT_MAX_MINOR,
    fiatPayoutsPerSession: agent?.budget.fiatPayoutsPerSession ?? config.FIAT_PAYOUTS_PER_SESSION,
    fiatPayoutsUsed: agent?.fiatPayoutsUsed ?? 0,
    // Fail-closed: a token is always required; without APPROVE_TOKEN approvals are disabled (503).
    approvalTokenRequired: true,
    approvals,
    // POST /api/chat answers with Claude and its functions; false: the UI uses its rule-based answers.
    chatReady: Boolean(agent && config.aiReady),
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

// The payment confirmation window: what approving would pay, from where, to whom. Moves nothing.
app.get("/api/runs/:id/preview", async (req, res) => {
  const run = runs.get(req.params.id);
  if (!agent || !run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  if (!run.invoice || !run.draft) {
    res.status(409).json({ error: `run is ${run.state} and has no payment draft` });
    return;
  }
  res.json(await agent.preview(run, approvals));
});

app.get("/api/balances", async (_req, res) => {
  if (!agent) {
    res.status(503).json({ error: "x402 not configured" });
    return;
  }
  res.json(await agent.balances());
});

app.get("/api/budget", (_req, res) => {
  if (!agent) {
    res.status(503).json({ error: "x402 not configured" });
    return;
  }
  res.json({ budget: agent.budget, usage: agent.budgetUsage, hardMax: HARD_MAX });
});

// Same operator token as approvals: whoever may approve payouts may set their limits (bounded by HARD_MAX).
app.put("/api/budget", (req, res) => {
  const refusal = decisionRefusal(config.APPROVE_TOKEN, req.header("authorization"), req.header("x-approve-token"));
  if (refusal) {
    res.status(refusal.status).json({ error: refusal.error });
    return;
  }
  if (!agent) {
    res.status(503).json({ error: "x402 not configured" });
    return;
  }
  try {
    agent.updateBudget(req.body ?? {});
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    res.status(400).json({ error: error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  res.json({ budget: agent.budget, usage: agent.budgetUsage, hardMax: HARD_MAX });
});

app.post("/api/chat", async (req, res) => {
  if (!agent || !config.aiReady) {
    res.status(503).json({ error: "chat not configured (ANTHROPIC_API_KEY and x402)" });
    return;
  }
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  const client = clientId(name => req.header(name), req.socket.remoteAddress).id;
  const limited = chatLimiter.check(client);
  if (limited) {
    res.status(429).set("retry-after", String(limited.retryAfterSec)).json({ error: limited.message.replace("runs", "chat messages"), retryAfterSec: limited.retryAfterSec });
    return;
  }
  chatLimiter.record(client);
  const startRun = (input: string) => {
    const admitted = admitRun({ body: { input }, header: name => req.header(name), socketAddress: req.socket.remoteAddress }, { limiter, runs, maxTextChars: config.MAX_TEXT_CHARS });
    if (!admitted.ok) return { ok: false as const, error: admitted.body.error };
    void agent.process(admitted.run);
    return { ok: true as const, run: admitted.run };
  };
  try {
    res.json(await chat(parsed.data, { agent, runs, payees, startRun, approvals, model: config.CLAUDE_MODEL }));
  } catch (error) {
    res.status(502).json({ error: `the model is not reachable right now: ${error instanceof Error ? error.message : String(error)}` });
  }
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
