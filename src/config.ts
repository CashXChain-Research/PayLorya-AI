import { z } from "zod";
import { CXC_SANDBOX_KEY } from "./cashxchain.js";

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

  // CashXChain supplier payouts (sandbox only). Unset: drafts stay non-executable.
  // A restricted key needs accounts:read, beneficiaries:write and payments:write.
  CASHXCHAIN_API_KEY: optional.refine(
    v => v === undefined || CXC_SANDBOX_KEY.test(v),
    "must be a CashXChain sandbox key (cxc_sk_sandbox_… or cxc_rk_sandbox_…); live keys are refused",
  ),

  // AI (ANTHROPIC_BASE_URL can point at a Cloudflare AI Gateway; the SDK reads it from env)
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
});

// Every env key the app reads; cloudflare/env.ts must forward all of them except PORT.
export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof typeof EnvSchema.shape)[];

export type Config = z.infer<typeof EnvSchema> & {
  baseUrl: string;
  facilitatorUrl: string;
  x402Ready: boolean;
  aiReady: boolean;
  cxcReady: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const baseUrl = parsed.PUBLIC_BASE_URL ?? `http://localhost:${parsed.PORT}`;
  return {
    ...parsed,
    baseUrl,
    facilitatorUrl: parsed.LOCAL_FACILITATOR ? `${baseUrl}/facilitator` : parsed.FACILITATOR_URL,
    x402Ready: Boolean(parsed.SELLER_ADDRESS && parsed.BUYER_MNEMONIC && parsed.BLOCKFROST_PROJECT_ID),
    aiReady: Boolean(parsed.ANTHROPIC_API_KEY),
    cxcReady: Boolean(parsed.CASHXCHAIN_API_KEY),
  };
}

export function blockfrostProvider(config: Config) {
  if (!config.BLOCKFROST_PROJECT_ID) throw new Error("BLOCKFROST_PROJECT_ID is not set");
  return {
    blockfrost: { baseUrl: config.BLOCKFROST_PREPROD_URL, projectId: config.BLOCKFROST_PROJECT_ID },
  };
}
