import { normalizeIban } from "./readiness.js";
import type { Invoice, RouteCheck, RouteDecision } from "./types.js";

/**
 * Verified payee directory (vendor master). Synthetic demo records: in production they come from
 * payee onboarding, never from an invoice. The crypto payee's wallet comes from operator config.
 */
export interface VerifiedPayee {
  name: string;
  iban?: string;
  bic?: string;
  routingNumber?: string;
  accountNumber?: string;
  /** US ACH payouts: the CashXChain US corridor requires it. */
  accountType?: "checking" | "savings";
  cardanoAddress?: string;
}

export const CRYPTO_PAYEE = "Nordwind Node Services OÜ";

export function payeeDirectory(supplierCardanoAddress?: string): VerifiedPayee[] {
  return [
    { name: "Brenner Maschinenbau GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
    { name: "Hofmann Feinwerktechnik GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
    { name: "Lakeside Robotics Inc.", routingNumber: "021000021", accountNumber: "000123456789", accountType: "checking" },
    { name: CRYPTO_PAYEE, ...(supplierCardanoAddress ? { cardanoAddress: supplierCardanoAddress } : {}) },
  ];
}

const LEGAL_FORMS = new Set(["gmbh", "ug", "ag", "kg", "inc", "llc", "ltd", "plc", "ou", "sa", "sarl", "bv", "co"]);

/** "Brenner Maschinenbau GmbH, Augsburg" -> "brennermaschinenbauaugsburg" (legal forms dropped). */
function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(t => t.replace(/\p{M}/gu, ""))
    .filter(t => t && !LEGAL_FORMS.has(t))
    .join("");
}

/** Longest directory name contained in the extracted supplier name. */
export function findPayee(directory: VerifiedPayee[], supplier: string): VerifiedPayee | undefined {
  const key = nameKey(supplier);
  return directory
    .filter(p => nameKey(p.name).length >= 4 && key.includes(nameKey(p.name)))
    .sort((a, b) => nameKey(b.name).length - nameKey(a.name).length)[0];
}

export interface RouteLimits {
  payoutMaxLovelace: bigint;
}

// A plain lovelace output below roughly 1 ADA is rejected by the ledger (min-UTxO).
const MIN_PAYOUT_LOVELACE = 1_000_000n;

/**
 * Deterministic payout route for a report that is ready for review. The rail follows the invoice
 * currency; the destination is always the verified payee record, and any account on the invoice
 * that differs from that record blocks the payout.
 */
export function decideRoute(invoice: Invoice, directory: VerifiedPayee[], limits: RouteLimits): RouteDecision {
  const checks: RouteCheck[] = [];
  const payee = findPayee(directory, invoice.supplier);
  if (!payee) {
    checks.push({ id: "payee", status: "fail", message: "Supplier is not in the verified payee directory" });
    return { status: "unavailable", checks, reason: "Payee not verified: onboard the payee before any payout" };
  }
  checks.push({ id: "payee", status: "pass", message: `Verified payee: ${payee.name}` });

  if (invoice.currency === "ADA") {
    const rail = "cardano_preprod" as const;
    checks.push({ id: "rail", status: "pass", message: "ADA invoice: Cardano Preprod transfer" });
    if (!payee.cardanoAddress) {
      checks.push({ id: "account", status: "fail", message: "No verified wallet on file for this payee" });
      return { status: "unavailable", rail, payee: payee.name, checks, reason: "No verified wallet on file for this payee" };
    }
    if (invoice.cardanoAddress !== payee.cardanoAddress) {
      checks.push({ id: "account", status: "fail", message: "Wallet on the invoice differs from the verified payee wallet" });
      return {
        status: "blocked",
        rail,
        payee: payee.name,
        checks,
        reason: "Wallet on the invoice differs from the verified payee record (possible invoice redirection)",
      };
    }
    checks.push({ id: "account", status: "pass", message: "Invoice wallet matches the verified payee wallet" });
    const amount = BigInt(invoice.amountMinor);
    if (amount < MIN_PAYOUT_LOVELACE || amount > limits.payoutMaxLovelace) {
      const message = `Amount outside the payout limits (1 to ${Number(limits.payoutMaxLovelace) / 1e6} tADA)`;
      checks.push({ id: "limit", status: "fail", message });
      return { status: "blocked", rail, payee: payee.name, checks, reason: message };
    }
    checks.push({ id: "limit", status: "pass", message: `Within the per-payout cap of ${Number(limits.payoutMaxLovelace) / 1e6} tADA` });
    return { status: "selected", rail, payee: payee.name, destination: payee.cardanoAddress, checks, reason: "Pay tADA to the verified wallet" };
  }

  const rail = "cxc_fiat" as const;
  checks.push({ id: "rail", status: "pass", message: `${invoice.currency} invoice: CashXChain payout` });
  const destination = payee.iban ?? (payee.routingNumber ? `ABA ${payee.routingNumber} / ${payee.accountNumber}` : undefined);
  if (!destination) {
    checks.push({ id: "account", status: "fail", message: "No verified bank account on file for this payee" });
    return { status: "unavailable", rail, payee: payee.name, checks, reason: "No verified bank account on file for this payee" };
  }
  const matches = payee.iban
    ? invoice.iban !== undefined && normalizeIban(invoice.iban) === payee.iban
    : invoice.routingNumber === payee.routingNumber && invoice.accountNumber === payee.accountNumber;
  if (!matches) {
    checks.push({ id: "account", status: "fail", message: "Bank details on the invoice differ from the verified payee record" });
    return {
      status: "blocked",
      rail,
      payee: payee.name,
      checks,
      reason: "Bank details on the invoice differ from the verified payee record (possible invoice redirection)",
    };
  }
  checks.push({ id: "account", status: "pass", message: "Invoice bank details match the verified payee record" });
  if (invoice.cardanoAddress && invoice.cardanoAddress !== payee.cardanoAddress) {
    checks.push({ id: "wallet", status: "warn", message: "A wallet address on the invoice is not on the payee record and was ignored" });
  }
  return { status: "selected", rail, payee: payee.name, destination, checks, reason: "Pay to the verified bank account via CashXChain" };
}
