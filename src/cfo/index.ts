import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CashXChainClient } from "../cashxchain.js";
import { blockfrostProvider, type Config } from "../config.js";
import type { CfoDeps } from "./api.js";
import { CODE_MINUTES, createAuth } from "./auth.js";
import { migrate } from "./db.js";
import { CxcKeys } from "./cxc-keys.js";
import { CxcLinker } from "./cxc-link.js";
import { claudeExtractor } from "./ingest.js";
import { resendMailer, type Mailer } from "./mail.js";
import { Payments, type PaymentEngine } from "./payments.js";
import { localFiles, localSql, memoryFiles, remoteFiles, remoteSql, type Files, type Sql } from "./sql.js";
import { Store } from "./store.js";

export { mountCfo } from "./api.js";
export type { PaymentEngine } from "./payments.js";

/**
 * Where the data lives. On Cloudflare (CFO_DATA_URL set): D1 and R2 behind the Worker's outbound
 * handler, durable across deploys. Locally: SQLite and a folder under DATA_DIR. Tests: in memory.
 */
function storage(config: Config, opts: { memory?: boolean }): { sql: Sql; files: Files } {
  if (config.CFO_DATA_URL) return { sql: remoteSql(config.CFO_DATA_URL), files: remoteFiles(config.CFO_DATA_URL) };
  if (opts.memory) return { sql: localSql(new DatabaseSync(":memory:")), files: memoryFiles() };
  mkdirSync(config.DATA_DIR, { recursive: true });
  return { sql: localSql(new DatabaseSync(join(config.DATA_DIR, "cfo.db"))), files: localFiles(join(config.DATA_DIR, "files")) };
}

/** Builds the AI CFO product on top of the payment engine (BuyerAgent), set into `engine` once ready. */
export async function createCfo(
  config: Config,
  engine: PaymentEngine,
  opts: { memory?: boolean; mailer?: Mailer; /** Tests: the CashXChain client for a workspace key. */ cashxchainFor?: (apiKey: string) => CashXChainClient } = {},
): Promise<CfoDeps> {
  const { sql, files } = storage(config, opts);
  await migrate(sql);
  const store = new Store(sql, files);
  const mailer =
    opts.mailer ??
    (config.RESEND_API_KEY ? resendMailer({ apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM, expiresMinutes: CODE_MINUTES, baseUrl: config.baseUrl }) : undefined);
  const auth = createAuth(sql, {
    baseUrl: config.baseUrl,
    trustedOrigins: config.AUTH_TRUSTED_ORIGINS?.split(",").map(o => o.trim().replace(/\/+$/, "")).filter(Boolean),
    secret: config.BETTER_AUTH_SECRET,
    mailer,
    google:
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET }
        : undefined,
  });
  // A workspace's own CashXChain account, connected with its API key (sealed with BETTER_AUTH_SECRET).
  const keys = new CxcKeys(store, config.BETTER_AUTH_SECRET, opts.cashxchainFor ?? (apiKey => new CashXChainClient({ apiKey })));
  return {
    store,
    auth,
    payments: new Payments(store, engine, keys),
    keys,
    connections: {
      acceptsApiKey: keys.ready,
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
