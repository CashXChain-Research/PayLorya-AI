import { join } from "node:path";
import { CashXChainClient } from "../cashxchain.js";
import { blockfrostProvider, type Config } from "../config.js";
import type { CfoDeps } from "./api.js";
import { createAuth } from "./auth.js";
import { openDatabase } from "./db.js";
import { CxcLinker } from "./cxc-link.js";
import { claudeExtractor } from "./ingest.js";
import { Payments, type PaymentEngine } from "./payments.js";
import { Store } from "./store.js";

export { mountCfo } from "./api.js";
export type { PaymentEngine } from "./payments.js";

/** Builds the AI CFO product on top of the payment engine (BuyerAgent), set into `engine` once ready. */
export async function createCfo(config: Config, engine: PaymentEngine, opts: { dbPath?: string } = {}): Promise<CfoDeps> {
  const db = openDatabase(opts.dbPath ?? join(config.DATA_DIR, "cfo.db"));
  const store = new Store(db);
  const auth = await createAuth(db, { baseUrl: config.baseUrl, secret: config.BETTER_AUTH_SECRET });
  return {
    store,
    auth,
    payments: new Payments(store, engine),
    connections: {
      ...(config.BLOCKFROST_PROJECT_ID ? { blockfrost: blockfrostProvider(config).blockfrost } : {}),
      get agentWalletAddress() {
        return engine.agent?.buyerAddress;
      },
      ...(config.CASHXCHAIN_API_KEY ? { cashxchain: new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY }) } : {}),
    },
    extract: claudeExtractor(config.CLAUDE_MODEL),
    model: config.CLAUDE_MODEL,
    aiReady: config.aiReady,
    aiDailyLimit: config.CFO_AI_DAILY_LIMIT,
    cxc: new CxcLinker(store, config.CASHXCHAIN_MASTER_KEY ? new CashXChainClient({ apiKey: config.CASHXCHAIN_MASTER_KEY }) : undefined),
  };
}
