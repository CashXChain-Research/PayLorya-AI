// Env keys the Worker forwards into the container. No Cloudflare imports, so vitest can load it.
// Must cover every key of the config schema in src/config.ts except PORT (tests/cloudflare-env.test.ts).
export const FORWARDED = [
  "PUBLIC_BASE_URL",
  "AUTH_TRUSTED_ORIGINS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
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
  "FIAT_PAYOUT_MAX_MINOR",
  "FIAT_PAYOUTS_PER_SESSION",
  "FIAT_BUDGET_MINOR",
  "APPROVE_TOKEN",
  "RUNS_PER_MINUTE_PER_CLIENT",
  "RUNS_PER_HOUR",
  "MAX_TEXT_CHARS",
  "MAX_RUNS",
  "CASHXCHAIN_API_KEY",
  "CASHXCHAIN_MASTER_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_MODEL",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "DATA_DIR",
  "CFO_DATA_URL",
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

/**
 * GET /api/auth-options, answered by the Worker so the login pages and the marketing page do not
 * wait for (or depend on) the container. Same answer as src/cfo/api.ts: codes need a Resend key,
 * Google needs both OAuth values and works on the canonical origin only.
 */
export function authOptions(env: Partial<Record<ForwardedKey, string>>): { codes: boolean; google?: { origin: string } } {
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_BASE_URL ? { origin: new URL(env.PUBLIC_BASE_URL).origin } : undefined;
  return { codes: Boolean(env.RESEND_API_KEY), ...(google ? { google } : {}) };
}

/** A short, stable fingerprint of the container env (FNV-1a), to notice changed vars or secrets. */
export function envFingerprint(vars: Record<string, string>): string {
  const text = JSON.stringify(Object.keys(vars).sort().map(k => [k, vars[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
