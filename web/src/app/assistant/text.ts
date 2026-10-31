import { esc, short } from "../../shared/dom.js";
import type { Run } from "../api.js";

const AMOUNT = /(?:\b(?:EUR|USD|GBP|CHF|AED|PLN|SEK|JPY|t?ADA)\s?\d|[€$£₳]\s?\d|\d[\d.,]*\s?(?:EUR|USD|GBP|CHF|AED|PLN|SEK|JPY|t?ADA|€)\b)/i;
const ACCOUNT = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,}|\bIBAN\b|\brouting\b|\baddr_test1[0-9a-z]{20,}/i;
const WORD = /\b(invoice|rechnung|facture|bill to|amount due|payment reference|remit)\b/i;

/** JSON object input: the agent validates it without Claude. */
export function isJson(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Typed or pasted text that should go to the agent as an invoice rather than be answered. */
export function looksLikeInvoice(text: string): boolean {
  const t = text.trim();
  if (isJson(t)) return true;
  const lines = t.split(/\n/).filter(l => l.trim()).length;
  const amount = AMOUNT.test(t);
  const account = ACCOUNT.test(t);
  const word = WORD.test(t);
  if (lines >= 2 && (amount || account || word)) return true;
  if (amount && account) return true;
  return word && amount && t.length > 60 && !t.endsWith("?");
}

export const fileSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const lineCount = (text: string): number => text.split(/\n/).filter(l => l.trim()).length;

/** First lines of an invoice for the user's bubble. */
export function preview(text: string, max = 5): string {
  const lines = text.trim().split(/\n/).filter(l => l.trim());
  const more = lines.length - max;
  return `<pre class="u-pre">${esc(lines.slice(0, max).join("\n"))}</pre>${more > 0 ? `<span class="u-more">+${more} more line${more === 1 ? "" : "s"}</span>` : ""}`;
}

/** "IBAN DE89…3000", "wallet addr_test1qrh6…cvyuvz", "routing 021000021, account …6789" (HTML). */
export function accountPhrase(run: Run): string | undefined {
  const inv = run.invoice;
  if (!inv) return undefined;
  if (inv.currency === "ADA") return inv.cardanoAddress ? `wallet <span class="mono">${esc(short(inv.cardanoAddress))}</span>` : undefined;
  if (inv.iban) return `IBAN <span class="mono">${esc(`${inv.iban.slice(0, 4)}…${inv.iban.slice(-4)}`)}</span>`;
  if (inv.routingNumber) return `routing <span class="mono">${esc(inv.routingNumber)}</span>, account <span class="mono">…${esc((inv.accountNumber ?? "").slice(-4) || "?")}</span>`;
  return undefined;
}

/** Short account for cards: IBAN or ABA or wallet. */
export function accountShort(destination?: string): string {
  if (!destination) return "";
  if (destination.startsWith("addr")) return short(destination);
  if (destination.startsWith("ABA")) return destination.replace(/\/\s*(\d+)$/, (_m, n: string) => `/ …${n.slice(-4)}`);
  return `${destination.slice(0, 4)}…${destination.slice(-4)}`;
}

// InvoiceSchema field names in extraction errors ("invalid fields: id, amountMinor").
const FIELD: Record<string, string> = {
  id: "invoice number",
  supplier: "supplier name",
  destinationCountry: "country",
  currency: "currency",
  amountMinor: "amount",
  iban: "IBAN",
  bic: "BIC",
  routingNumber: "routing number",
  accountNumber: "account number",
  cardanoAddress: "wallet address",
};
export function missingFields(error: string): string | undefined {
  const m = /invalid fields: (.+)/.exec(error);
  if (!m) return undefined;
  return [...new Set(m[1]!.split(/,\s*/).map(f => FIELD[f] ?? f))].join(", ");
}

// Spend-policy refusals (src/agent.ts, src/policy.ts): nothing was signed for these.
const STOPS: Array<[RegExp, string]> = [
  [/payout for this invoice already paid/, "This invoice was already paid out once"],
  [/fiat payout limit of (\d+) per session/, "The fiat payout limit for this session is reached"],
  [/payout route changed/, "The payout route changed since the draft"],
  [/already paid/, "This invoice was already verified and paid once"],
  [/already in progress/, "A payment for this invoice is already in progress"],
  [/budget exhausted/, "The session budget is used up"],
  [/unknown settlement/, "An earlier payment for this invoice is still unresolved"],
  [/max payments/, "The payment limit for this run is reached"],
];
export const stopText = (error = ""): string | undefined => STOPS.find(([re]) => re.test(error))?.[1];

/** Wallet in the invoice text that is neither the verifier nor the verified payee (an injection). */
export function foreignWallet(input: string, known: Array<string | undefined>): string | undefined {
  return input.match(/addr_test1[0-9a-z]{20,}/g)?.find(a => !known.includes(a));
}
export const injectionWords = (input: string): boolean =>
  /\b(ignore (all )?(previous|prior|above) instructions|system (note|prompt|message) to (the )?ai|pre-?approved by the cfo)\b/i.test(input);
