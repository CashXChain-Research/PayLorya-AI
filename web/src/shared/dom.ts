export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes anything that goes into innerHTML. */
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => ESCAPES[c]!);

export const tada = (lovelace: string | number | undefined): string =>
  (Number(lovelace || 0) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const ada = (lovelace: string | number | undefined): string => `${tada(lovelace)} tADA`;

export const short = (address?: string): string =>
  address && address.length > 22 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address || "";
export const shortHash = (hash?: string): string => (hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : "");

const EXPONENT: Record<string, number> = { JPY: 0 };
/** Decimals of a currency's minor unit: ADA 6 (lovelace), JPY 0, others 2. */
export const exponent = (currency: string): number => (currency === "ADA" ? 6 : (EXPONENT[currency] ?? 2));

/** The number alone, in major units: "1,250.00" (EUR), "2.50" (ADA, up to 6 decimals). */
export function amountText(minor: number, currency: string): string {
  const e = exponent(currency);
  return (minor / 10 ** e).toLocaleString("en-US", { minimumFractionDigits: currency === "ADA" ? 2 : e, maximumFractionDigits: e });
}

export function money(minor: number | undefined, currency: string | undefined): string {
  if (minor == null || !currency) return "";
  return currency === "ADA" ? `${amountText(minor, currency)} tADA` : `${currency} ${amountText(minor, currency)}`;
}

/** A decimal string in major units (CashXChain balances and quotes, "1234.5600") as "1,234.56". */
export function decimalText(amount: string | undefined, currency: string): string {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n)) return amount ?? "";
  const e = exponent(currency);
  return n.toLocaleString("en-US", { minimumFractionDigits: e, maximumFractionDigits: e });
}
export const decimalMoney = (amount: string | undefined, currency: string): string =>
  amount ? `${currency} ${decimalText(amount, currency)}` : "";

/** Minor units to major units of the invoice currency (ADA: lovelace -> tADA). */
export function majorUnits(minor: number, currency: string): number {
  return minor / 10 ** exponent(currency);
}
