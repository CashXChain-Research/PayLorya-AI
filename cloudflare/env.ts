// Env keys the Worker forwards into the container. No Cloudflare imports, so vitest can load it.
// Must cover every key of the config schema in src/config.ts except PORT (tests/cloudflare-env.test.ts).
export const FORWARDED = [
  "PUBLIC_BASE_URL",
  "BLOCKFROST_PREPROD_URL",
  "BLOCKFROST_PROJECT_ID",
  "SELLER_ADDRESS",
  "BUYER_MNEMONIC",
  "FACILITATOR_URL",
  "LOCAL_FACILITATOR",
  "CARDANO_L1_CONFIRMATIONS",
  "EXPLORER_TX_URL",
  "PRICE_LOVELACE",
  "MAX_PRICE_LOVELACE",
  "SESSION_BUDGET_LOVELACE",
  "MAX_PAYMENTS_PER_RUN",
  "DEMO_AMOUNT_CEILING_MINOR",
  "SUPPLIER_CARDANO_ADDRESS",
  "PAYOUT_MAX_LOVELACE",
  "PAYOUT_BUDGET_LOVELACE",
  "CASHXCHAIN_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_MODEL",
  "BETTER_AUTH_SECRET",
  "DATA_DIR",
  "CFO_AI_DAILY_LIMIT",
  // Not in the schema: the Anthropic SDK reads it from env (Cloudflare AI Gateway).
  "ANTHROPIC_BASE_URL",
] as const;

export type ForwardedKey = (typeof FORWARDED)[number];

export function containerEnv(env: Partial<Record<ForwardedKey, string>>): Record<string, string> {
  const vars: Record<string, string> = { PORT: "8787" };
  for (const key of FORWARDED) {
    const value = env[key];
    if (value) vars[key] = value;
  }
  return vars;
}
