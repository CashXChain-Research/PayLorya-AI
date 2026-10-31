import { z } from "zod";
import { CXC_SANDBOX_KEY, CXC_SANDBOX_MASTER_KEY } from "./cashxchain.js";

// Network is fixed on purpose: this build only ever touches Cardano Preprod.
export const CARDANO_NETWORK = "cardano:preprod" as const;

const optional = z
  .string()
  .trim()
  .transform(v => (v === "" ? undefined : v))
  .optional();

const bool = z
  .string()
  .optional()
  .transform(v => v === "true" || v === "1");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: optional,

  // Cardano / x402
  BLOCKFROST_PREPROD_URL: z.string().default("https://cardano-preprod.blockfrost.io/api/v0"),
  BLOCKFROST_PROJECT_ID: optional,
  SELLER_ADDRESS: optional,
  BUYER_MNEMONIC: optional,
  FACILITATOR_URL: z.string().default("https://x402.preprod.dev.ecosyseng.cf-deployments.org"),
  LOCAL_FACILITATOR: bool,
  CARDANO_L1_CONFIRMATIONS: optional.refine(
    v => v === undefined || (/^-?\d+$/.test(v) && Number(v) >= -1 && Number(v) <= 20),
    "integer from -1 to 20",
  ),
  EXPLORER_TX_URL: z.string().default("https://preprod.cardanoscan.io/transaction/"),

  // Pricing and buyer spend policy (lovelace, 1 tADA = 1_000_000)
  PRICE_LOVELACE: z.coerce.bigint().default(2_000_000n),
  MAX_PRICE_LOVELACE: z.coerce.bigint().default(3_000_000n),
  SESSION_BUDGET_LOVELACE: z.coerce.bigint().default(20_000_000n),
  MAX_PAYMENTS_PER_RUN: z.coerce.number().int().positive().default(1),

  // Demo business limits (minor units of the invoice currency)
  DEMO_AMOUNT_CEILING_MINOR: z.coerce.number().int().positive().default(5_000_000),

  // Invoice payouts (approved drafts). Crypto invoices pay tADA from the buyer wallet to the
  // verified payee wallet only; caps are separate from the report-fee budget.
  SUPPLIER_CARDANO_ADDRESS: optional.refine(v => v === undefined || v.startsWith("addr_test1"), "Preprod address (addr_test1...)"),
  PAYOUT_MAX_LOVELACE: z.coerce.bigint().default(10_000_000n),
  PAYOUT_BUDGET_LOVELACE: z.coerce.bigint().default(30_000_000n),
  // Fiat payouts hold no wallet budget, so they are capped here: per payout (minor units of the
  // invoice currency) and per server session. Keeps the public demo under the sandbox day limit.
  FIAT_PAYOUT_MAX_MINOR: z.coerce.number().int().positive().default(100_000),
  FIAT_PAYOUTS_PER_SESSION: z.coerce.number().int().positive().default(5),
  // Fiat total per currency and session (minor units); runtime-adjustable per currency via PUT /api/budget.
  FIAT_BUDGET_MINOR: z.coerce.number().int().positive().default(500_000),
  // Optional operator token: when set, approving or rejecting a draft requires it.
  APPROVE_TOKEN: optional,

  // Public POST /api/runs limits (src/ratelimit.ts): fixed windows per client IP and overall.
  RUNS_PER_MINUTE_PER_CLIENT: z.coerce.number().int().positive().default(10),
  RUNS_PER_HOUR: z.coerce.number().int().positive().default(120),
  // Free text longer than this is refused (413) before the Claude call; structured invoices are exempt.
  MAX_TEXT_CHARS: z.coerce.number().int().positive().default(20_000),
  // Runs kept in memory; settled runs are evicted oldest first, in-flight runs never.
  MAX_RUNS: z.coerce.number().int().positive().default(500),

  // AI (ANTHROPIC_BASE_URL can point at a Cloudflare AI Gateway; the SDK reads it from env)
  // CashXChain fiat payouts (sandbox only). Unset or refused: fiat payouts use the simulated stand-in.
  CASHXCHAIN_API_KEY: optional,
  // CashXChain platform master key (sandbox only): a managed sub-account per AI CFO account.
  CASHXCHAIN_MASTER_KEY: optional,

  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),

  // AI CFO product (accounts, dashboard). SQLite file under DATA_DIR; the secret signs sessions.
  BETTER_AUTH_SECRET: optional.refine(v => v === undefined || v.length >= 32, "at least 32 characters"),
  // Resend: with a key, new accounts confirm their email with a 6-digit code before they can sign in.
  RESEND_API_KEY: optional,
  // Must be on a domain verified in that Resend account, or Resend refuses the send.
  RESEND_FROM: z.string().trim().min(3).default("PayFlow AI <no-reply@cashxchain.com>"),
  DATA_DIR: z.string().default("data"),
  // Cloudflare: the Worker's D1/R2 proxy (http://cfo-data.internal). Unset: SQLite and files under DATA_DIR.
  CFO_DATA_URL: optional,
  // Model calls (document reads + chat messages) per workspace per day: a cost guard for open signups.
  CFO_AI_DAILY_LIMIT: z.coerce.number().int().positive().default(150),
});

// Every env key the app reads; cloudflare/env.ts must forward all of them except PORT.
export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof typeof EnvSchema.shape)[];

export type Config = z.infer<typeof EnvSchema> & {
  baseUrl: string;
  facilitatorUrl: string;
  x402Ready: boolean;
  aiReady: boolean;
  cxcReady: boolean;
  /** Why a configured CashXChain key was not used (live or unknown format); the key itself is dropped. */
  cxcRefused: { apiKey?: string; masterKey?: string };
};

const REFUSED = "not a CashXChain sandbox key; live keys are refused (this build only reaches api.sandbox.cashxchain.com)";

/** A CashXChain key of the expected sandbox format, else undefined: a wrong key never crashes the server. */
function sandboxKey(value: string | undefined, format: RegExp, name: string, refused: Record<string, string>, field: string): string | undefined {
  if (value === undefined || format.test(value)) return value;
  refused[field] = `${name}: ${REFUSED}`;
  console.warn(`${name} ignored: ${REFUSED}`);
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const cxcRefused: Config["cxcRefused"] = {};
  parsed.CASHXCHAIN_API_KEY = sandboxKey(parsed.CASHXCHAIN_API_KEY, CXC_SANDBOX_KEY, "CASHXCHAIN_API_KEY", cxcRefused, "apiKey");
  parsed.CASHXCHAIN_MASTER_KEY = sandboxKey(parsed.CASHXCHAIN_MASTER_KEY, CXC_SANDBOX_MASTER_KEY, "CASHXCHAIN_MASTER_KEY", cxcRefused, "masterKey");
  const baseUrl = parsed.PUBLIC_BASE_URL ?? `http://localhost:${parsed.PORT}`;
  return {
    ...parsed,
    baseUrl,
    facilitatorUrl: parsed.LOCAL_FACILITATOR ? `${baseUrl}/facilitator` : parsed.FACILITATOR_URL,
    x402Ready: Boolean(parsed.SELLER_ADDRESS && parsed.BUYER_MNEMONIC && parsed.BLOCKFROST_PROJECT_ID),
    aiReady: Boolean(parsed.ANTHROPIC_API_KEY),
    cxcReady: Boolean(parsed.CASHXCHAIN_API_KEY),
    cxcRefused,
  };
}

export function blockfrostProvider(config: Config, requestTimeoutMs?: number) {
  if (!config.BLOCKFROST_PROJECT_ID) throw new Error("BLOCKFROST_PROJECT_ID is not set");
  return {
    blockfrost: { baseUrl: config.BLOCKFROST_PREPROD_URL, projectId: config.BLOCKFROST_PROJECT_ID },
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  };
}
