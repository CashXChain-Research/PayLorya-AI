import type { Vendor } from "./payout.js";
import { normalizeIban } from "./readiness.js";
import type { Invoice } from "./types.js";

/** Receives crypto-invoice payouts in the demo (a team-controlled Preprod test wallet). */
export const DEMO_CRYPTO_VENDOR_ADDRESS =
  "addr_test1qqsqefsjjl242gt2zjqu5nygp58rjuqn0f0nncrfn4n6mpf5dg8fzcj9pw62y9rk972sc7u959up5gwnm4tz6zcqzlxsazp9p0";

/**
 * Vendor master data: the only source of payout destinations. In a real deployment this is the
 * customer's verified supplier list; the invoice can name a vendor but never supply where money goes.
 */
export const DEMO_VENDORS: Vendor[] = [
  {
    id: "brenner",
    name: "Brenner Maschinenbau GmbH",
    route: "cashxchain",
    country: "DE",
    currency: "EUR",
    bank: { iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
  },
  {
    id: "hofmann",
    name: "Hofmann Feinwerktechnik GmbH",
    route: "cashxchain",
    country: "DE",
    currency: "EUR",
    bank: { iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
  },
  {
    id: "lakeside",
    name: "Lakeside Robotics Inc.",
    route: "cashxchain",
    country: "US",
    currency: "USD",
    bank: { routingNumber: "021000021", accountNumber: "000123456789" },
  },
  {
    id: "nordlicht",
    name: "Nordlicht AI Labs GmbH",
    route: "cardano",
    country: "DE",
    currency: "ADA",
    cardanoAddress: DEMO_CRYPTO_VENDOR_ADDRESS,
  },
];

const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export type VendorMatch = { ok: true; vendor: Vendor } | { ok: false; reason: string };

/**
 * Finds the registered vendor for an invoice and checks that every payment detail the invoice
 * states matches master data. A mismatch is the classic invoice-fraud signal, so it blocks payout.
 */
export function matchVendor(invoice: Invoice, vendors: Vendor[] = DEMO_VENDORS): VendorMatch {
  const name = normalizeName(invoice.supplier);
  const vendor = vendors.find(v => [v.name, ...(v.aliases ?? [])].some(n => normalizeName(n) === name));
  if (!vendor) return { ok: false, reason: `supplier "${invoice.supplier}" is not in the vendor registry` };
  if (invoice.currency !== vendor.currency) {
    return { ok: false, reason: `invoice currency ${invoice.currency} differs from the vendor's ${vendor.currency}` };
  }
  const differs: string[] = [];
  const bank = vendor.bank ?? {};
  if (invoice.iban && (!bank.iban || normalizeIban(invoice.iban) !== normalizeIban(bank.iban))) differs.push("IBAN");
  if (invoice.routingNumber && invoice.routingNumber !== bank.routingNumber) differs.push("routing number");
  if (invoice.accountNumber && invoice.accountNumber !== bank.accountNumber) differs.push("account number");
  if (invoice.cardanoAddress && invoice.cardanoAddress !== vendor.cardanoAddress) differs.push("Cardano address");
  if (differs.length > 0) {
    return { ok: false, reason: `${differs.join(", ")} on the invoice differs from vendor master data (possible invoice fraud)` };
  }
  if (vendor.route === "cardano" && !vendor.cardanoAddress) return { ok: false, reason: "vendor has no registered Cardano address" };
  return { ok: true, vendor };
}
