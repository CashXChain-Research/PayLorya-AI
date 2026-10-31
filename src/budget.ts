import { z } from "zod";
import type { Config } from "./config.js";
import type { Budget, BudgetUpdate } from "./contracts.js";
import { CURRENCY_EXPONENT } from "./types.js";

const ADA = 1_000_000n;

/**
 * Upper bounds for budgets set at runtime (PUT /api/budget). Testnet and sandbox only, but a typo
 * must not lift a cap by orders of magnitude. Fiat bounds follow the CashXChain sandbox plan
 * (2,500 per payout, 5,000 per day).
 */
export const HARD_MAX: Readonly<Budget> = {
  checkBudgetLovelace: (100n * ADA).toString(),
  cardanoPayoutMaxLovelace: (100n * ADA).toString(),
  cardanoBudgetLovelace: (500n * ADA).toString(),
  fiatPayoutMaxMinor: 250_000,
  fiatBudgetMinor: {},
  fiatBudgetDefaultMinor: 500_000,
  fiatPayoutsPerSession: 50,
};

export function initialBudget(config: Config): Budget {
  return {
    checkBudgetLovelace: config.SESSION_BUDGET_LOVELACE.toString(),
    cardanoPayoutMaxLovelace: config.PAYOUT_MAX_LOVELACE.toString(),
    cardanoBudgetLovelace: config.PAYOUT_BUDGET_LOVELACE.toString(),
    fiatPayoutMaxMinor: config.FIAT_PAYOUT_MAX_MINOR,
    fiatBudgetMinor: {},
    fiatBudgetDefaultMinor: config.FIAT_BUDGET_MINOR,
    fiatPayoutsPerSession: config.FIAT_PAYOUTS_PER_SESSION,
  };
}

const lovelace = (max: string) =>
  z
    .string()
    .regex(/^\d{1,16}$/, "lovelace as a decimal string")
    .refine(v => BigInt(v) <= BigInt(max), `at most ${BigInt(max) / ADA} tADA`);
const minor = (max: number) => z.number().int().min(0).max(max);

export const BudgetUpdateSchema = z
  .object({
    checkBudgetLovelace: lovelace(HARD_MAX.checkBudgetLovelace),
    cardanoPayoutMaxLovelace: lovelace(HARD_MAX.cardanoPayoutMaxLovelace),
    cardanoBudgetLovelace: lovelace(HARD_MAX.cardanoBudgetLovelace),
    fiatPayoutMaxMinor: minor(HARD_MAX.fiatPayoutMaxMinor),
    fiatBudgetMinor: z.record(z.string().regex(/^[A-Z]{3}$/, "ISO-4217 code"), minor(HARD_MAX.fiatBudgetDefaultMinor)),
    fiatBudgetDefaultMinor: minor(HARD_MAX.fiatBudgetDefaultMinor),
    fiatPayoutsPerSession: z.number().int().min(0).max(HARD_MAX.fiatPayoutsPerSession),
  })
  .partial()
  .strict();

/** The update applied to `current`; fiat budgets per currency merge key by key. */
export function applyBudgetUpdate(current: Budget, update: BudgetUpdate): Budget {
  const parsed = BudgetUpdateSchema.parse(update);
  return {
    ...current,
    ...parsed,
    fiatBudgetMinor: { ...current.fiatBudgetMinor, ...parsed.fiatBudgetMinor },
  };
}

export const fiatBudgetFor = (budget: Budget, currency: string): number => budget.fiatBudgetMinor[currency] ?? budget.fiatBudgetDefaultMinor;

/** "1,000.00 EUR"-style text for refusal messages (minor units, the currency's decimals). */
export function formatMinor(minor: number, currency: string): string {
  const exp = CURRENCY_EXPONENT[currency] ?? 2;
  return `${(minor / 10 ** exp).toLocaleString("en-US", { minimumFractionDigits: exp, maximumFractionDigits: exp })} ${currency}`;
}
