import { BuyerAgent } from "./agent.js";
import { createApp } from "./app.js";
import { CashXChainClient } from "./cashxchain.js";
import { createCfo, type PaymentEngine } from "./cfo/index.js";
import { loadConfig } from "./config.js";
import { CashXChainPayoutRoute } from "./payout-cashxchain.js";
import { RunStore } from "./runs.js";

const config = loadConfig();
const runs = new RunStore(config.MAX_RUNS);
// AI CFO payments get their own store: they never show up in the public demo inbox.
const engine: PaymentEngine = { runs: new RunStore(config.MAX_RUNS) };
// The public demo keeps working when the AI CFO's database is unreachable at start.
const cfo = await createCfo(config, engine).catch(error => {
  console.error("AI CFO disabled: could not open its database", error);
  return undefined;
});
// Real CashXChain sandbox payouts when the key is set; otherwise the agent's simulated stand-in.
const fiat = config.CASHXCHAIN_API_KEY ? new CashXChainPayoutRoute(new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY })) : undefined;
const agent = config.x402Ready ? new BuyerAgent(config, runs, undefined, fiat ? { fiat } : {}) : undefined;
engine.agent = agent;

createApp(config, { runs, agent, cfo }).listen(config.PORT, () => {
  console.log(`CxC AgentPay on ${config.baseUrl}`);
  console.log(`  facilitator: ${config.facilitatorUrl}`);
  console.log(`  x402Ready=${config.x402Ready} aiReady=${config.aiReady}`);
  if (agent) console.log(`  buyer: ${agent.buyerAddress}\n  seller: ${config.SELLER_ADDRESS}`);
});
