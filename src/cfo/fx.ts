import { CURRENCY_EXPONENT } from "../types.js";

/**
 * Indicative USD rates for reporting and for applying USD-denominated agent limits. Not market
 * data: fixed demo values, shown as "indicative" in the UI. tADA (Preprod) has no market value; it
 * gets a nominal rate so USD limits still constrain tADA payments.
 */
export const USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.13,
  AED: 0.27,
  PLN: 0.25,
  SEK: 0.095,
  JPY: 0.0067,
  ADA: 0.5,
};

export const SUPPORTED_CURRENCIES = Object.keys(USD_PER_UNIT);

export function exponent(currency: string): number {
  return CURRENCY_EXPONENT[currency] ?? 2;
}

/** Minor units of `currency` to USD cents (rounded). Unknown currencies count as 0. */
export function toUsdMinor(amountMinor: number, currency: string): number {
  const rate = USD_PER_UNIT[currency];
  if (rate === undefined) return 0;
  return Math.round((amountMinor / 10 ** exponent(currency)) * rate * 100);
}

/** Major units (12480.5) to minor units of `currency`. */
export function majorToMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** exponent(currency));
}
