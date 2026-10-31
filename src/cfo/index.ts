import { StripeFc } from "./stripe.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { toClientCardanoSigner, type ClientCardanoSigner, type ClientCardanoSignInput, type ClientCardanoSignResult } from "@x402/cardano";
import { Funder } from "./funder.js";
import { BuyerAgent } from "../agent.js";
import { CashXChainClient } from "../cashxchain.js";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "../config.js";
import { WorkspaceAgents } from "./agents.js";
import type { CfoDeps } from "./api.js";
import { CODE_MINUTES, createAuth } from "./auth.js";
import { migrate } from "./db.js";
import { CxcKeys } from "./cxc-keys.js";
import { CxcLinker } from "./cxc-link.js";
import { claudeExtractor, resumeDocuments } from "./ingest.js";
import { resendMailer, type Mailer } from "./mail.js";
import { Payments, type PaymentEngine } from "./payments.js";
import { evolutionKit, type TxKit } from "./wallet-signer.js";
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
  opts: {
    memory?: boolean;
    mailer?: Mailer;
    /** Tests: the CashXChain client for a workspace key. */
    cashxchainFor?: (apiKey: string) => CashXChainClient;
    /** Tests: builds tADA payouts from a workspace wallet; production: Evolution SDK over Blockfrost. */
    walletKit?: TxKit;
    /** Tests: no background sweep (they call payments.sweep() themselves). */
    noSweep?: boolean;
    /** Tests: a shorter limit for the paid verification step. */
    checkTimeoutMs?: number;
    /** Tests: the funding wallet's signer ("Get test tADA"), and how long a grant waits for the previous one. */
    funderSigner?: ClientCardanoSigner;
    funderSettleMs?: number;
    /** Tests: the payout engine for an account's agent wallet (its recovery phrase). */
    agentFor?: (recoveryPhrase: string, signed: (input: ClientCardanoSignInput, out: ClientCardanoSignResult) => Promise<void>) => BuyerAgent;
  } = {},
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
  // Each account pays from its own agent wallet; PayLorya AI's wallet (BUYER_MNEMONIC) is the public demo's only.
  const agents = new WorkspaceAgents(
    store,
    keys,
    opts.agentFor ??
      ((phrase, signed) => {
        const signer = toClientCardanoSigner({ mnemonic: phrase, network: CARDANO_NETWORK, provider: blockfrostProvider(config) });
        return new BuyerAgent(config, engine.runs, {
          getAddress: () => signer.getAddress(),
          // A payout (anything not paying the x402 seller) is stored before the agent sends it.
          async buildAndSignPaymentTransaction(input) {
            const out = await signer.buildAndSignPaymentTransaction(input);
            if (input.payTo !== config.SELLER_ADDRESS) await signed(input, out);
            return out;
          },
        });
      }),
  );
  const kit = opts.walletKit ?? (config.BLOCKFROST_PROJECT_ID ? evolutionKit(blockfrostProvider(config).blockfrost) : undefined);
  // "Get test tADA": tops up a new agent wallet once from PayLorya AI's funding wallet (FUNDER_MNEMONIC).
  const funderSigner =
    opts.funderSigner ??
    (config.FUNDER_MNEMONIC && config.BLOCKFROST_PROJECT_ID
      ? toClientCardanoSigner({ mnemonic: config.FUNDER_MNEMONIC, network: CARDANO_NETWORK, provider: blockfrostProvider(config) })
      : undefined);
  const funder =
    funderSigner && kit
      ? new Funder(store, {
          signer: funderSigner,
          kit,
          lovelace: config.FUNDER_LOVELACE,
          dailyGrants: config.FUNDER_DAILY_GRANTS,
          explorerTxUrl: config.EXPLORER_TX_URL,
          ...(opts.funderSettleMs !== undefined ? { settleMs: opts.funderSettleMs } : {}),
        })
      : undefined;
  const payments = new Payments(store, engine, keys, {
    agents,
    limits: { tadaMaxLovelace: config.PAYOUT_MAX_LOVELACE, fiatMaxMinor: config.FIAT_PAYOUT_MAX_MINOR, feeMaxLovelace: config.MAX_PRICE_LOVELACE },
    ...(kit ? { kit } : {}),
    explorerTxUrl: config.EXPLORER_TX_URL,
    ...(opts.checkTimeoutMs ? { checkTimeoutMs: opts.checkTimeoutMs } : {}),
  });
  agents.onPayoutSigned = (ws, input, out) => payments.recordAgentPayout(ws, input, out);
  if (!opts.noSweep) {
    // Settles what a restart left behind, then follows sent tADA payouts to their block.
    void payments.sweep();
    setInterval(() => void payments.sweep(), 60_000).unref();
  }
  const deps = {
    store,
    auth,
    payments,
    keys,
    ...(funder ? { funder } : {}),
    connections: {
      acceptsApiKey: keys.ready,
      ...(config.BLOCKFROST_PROJECT_ID ? { blockfrost: blockfrostProvider(config).blockfrost } : {}),
      ...(config.CASHXCHAIN_API_KEY ? { cashxchain: new CashXChainClient({ apiKey: config.CASHXCHAIN_API_KEY }) } : {}),
      ...(config.STRIPE_SECRET_KEY && config.STRIPE_PUBLISHABLE_KEY ? { stripe: new StripeFc(config.STRIPE_SECRET_KEY) } : {}),
    },
    stripePublishableKey: config.STRIPE_SECRET_KEY ? config.STRIPE_PUBLISHABLE_KEY : undefined,
    baseUrl: config.baseUrl,
    extract: claudeExtractor(config.CLAUDE_MODEL),
    model: config.CLAUDE_MODEL,
    aiReady: config.aiReady,
    aiDailyLimit: config.CFO_AI_DAILY_LIMIT,
    cxc: new CxcLinker(store, config.CASHXCHAIN_MASTER_KEY ? new CashXChainClient({ apiKey: config.CASHXCHAIN_MASTER_KEY }) : undefined),
  };
  if (!opts.noSweep) {
    // Documents a restart cut off mid-read: read again (reads deps.extract at run time, so tests can swap it).
    const resume = () => void resumeDocuments(store, deps.extract).catch(error => console.error("document resume failed", error));
    resume();
    setInterval(resume, 60_000).unref();
  }
  return deps;
}
