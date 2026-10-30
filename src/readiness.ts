import { createHash } from "node:crypto";
import { CORRIDORS, findCorridor, simulatedQuote } from "./fixtures.js";
import type { Invoice, ReadinessCheck, ReadinessReport, Verdict } from "./types.js";

// IBAN lengths per country (ISO 13616 registry) for the countries we accept.
const IBAN_LENGTH: Record<string, number> = {
  AE: 23, AT: 20, BE: 16, CH: 21, CZ: 24, DE: 22, DK: 18, ES: 24, FI: 18, FR: 27,
  GB: 22, IE: 22, IT: 27, LU: 20, NL: 18, NO: 15, PL: 28, PT: 25, SE: 24, TR: 26,
};

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 mod-97 check plus country length. */
export function validateIban(raw: string): { ok: boolean; reason?: string } {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { ok: false, reason: "malformed IBAN" };
  const expected = IBAN_LENGTH[iban.slice(0, 2)];
  if (!expected) return { ok: false, reason: `IBAN country ${iban.slice(0, 2)} not supported` };
  if (iban.length !== expected) return { ok: false, reason: `IBAN length ${iban.length}, expected ${expected}` };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1 ? { ok: true } : { ok: false, reason: "IBAN checksum (mod-97) failed" };
}

/** ABA routing number checksum: 3-7-1 weighting, sum mod 10 == 0. */
export function validateAbaRouting(raw: string): boolean {
  if (!/^\d{9}$/.test(raw)) return false;
  const d = [...raw].map(Number);
  const sum = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
  return sum % 10 === 0;
}

export function validateBic(raw: string, country: string): { ok: boolean; reason?: string } {
  const bic = raw.toUpperCase();
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return { ok: false, reason: "malformed BIC" };
  if (bic.slice(4, 6) !== country) return { ok: false, reason: `BIC country ${bic.slice(4, 6)} != ${country}` };
  return { ok: true };
}

export function invoiceFingerprint(inv: Invoice): string {
  const key = [inv.supplier.trim().toLowerCase(), inv.id.trim().toLowerCase(), inv.currency, inv.amountMinor].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Duplicate/idempotency ledger. The x402 handler runs before settlement and may be retried,
 * so the same Idempotency-Key must return the same report instead of flagging a duplicate.
 */
export class ReadinessLedger {
  private byFingerprint = new Map<string, string>();
  private byIdempotencyKey = new Map<string, ReadinessReport>();

  cached(idempotencyKey: string): ReadinessReport | undefined {
    return this.byIdempotencyKey.get(idempotencyKey);
  }

  firstKeyFor(fingerprint: string): string | undefined {
    return this.byFingerprint.get(fingerprint);
  }

  record(idempotencyKey: string, report: ReadinessReport): void {
    if (!this.byFingerprint.has(report.invoiceFingerprint)) {
      this.byFingerprint.set(report.invoiceFingerprint, idempotencyKey);
    }
    this.byIdempotencyKey.set(idempotencyKey, report);
  }
}

export interface ReadinessOptions {
  amountCeilingMinor: number;
}

export function buildReadinessReport(
  invoice: Invoice,
  idempotencyKey: string,
  ledger: ReadinessLedger,
  opts: ReadinessOptions,
): ReadinessReport {
  const cached = ledger.cached(idempotencyKey);
  if (cached) return cached;

  const fingerprint = invoiceFingerprint(invoice);
  const checks: ReadinessCheck[] = [];
  const corridor = findCorridor(invoice.destinationCountry, invoice.currency);

  checks.push(
    corridor
      ? { id: "corridor", status: "pass", message: `${invoice.destinationCountry}/${invoice.currency} via ${corridor.rail}`, source: "demo-fixture" }
      : { id: "corridor", status: "fail", message: CORRIDORS.some(c => c.country === invoice.destinationCountry)
          ? `Invoice currency ${invoice.currency} does not match demo corridor currency for ${invoice.destinationCountry}: ${CORRIDORS.filter(c => c.country === invoice.destinationCountry).map(c => c.currency).join(", ")}`
          : `No demo corridor for ${invoice.destinationCountry}/${invoice.currency}`, source: "demo-fixture" },
  );

  const missing = (corridor?.requiredFields ?? []).filter(f => !invoice[f]);
  checks.push(
    !corridor
      ? { id: "required_fields", status: "skip", message: "No corridor, no field rules", source: "demo-fixture" }
      : missing.length
        ? { id: "required_fields", status: "fail", message: `Missing: ${missing.join(", ")}`, source: "demo-fixture" }
        : { id: "required_fields", status: "pass", message: `Present: ${corridor.requiredFields.join(", ")}`, source: "demo-fixture" },
  );

  checks.push(accountCheck(invoice));
  const ibanCountry = invoice.iban ? normalizeIban(invoice.iban).slice(0, 2) : undefined;
  checks.push({
    id: "iban_country", source: "deterministic",
    status: !ibanCountry ? "skip" : ibanCountry === invoice.destinationCountry ? "pass" : "fail",
    message: !ibanCountry ? "No IBAN to compare" : `IBAN country ${ibanCountry}; destination ${invoice.destinationCountry}`,
  });
  const bicCountry = invoice.bic?.toUpperCase().slice(4, 6);
  checks.push({
    id: "bic_country", source: "deterministic",
    status: !bicCountry || !ibanCountry ? "skip" : bicCountry === ibanCountry ? "pass" : "warn",
    message: !bicCountry || !ibanCountry ? "IBAN and BIC needed for country comparison" : `BIC country ${bicCountry}; IBAN country ${ibanCountry}`,
  });
  const corridorCurrencies = [...new Set(CORRIDORS.filter(c => c.country === invoice.destinationCountry).map(c => c.currency))];
  checks.push({
    id: "currency", source: "deterministic",
    status: !corridorCurrencies.length ? "skip" : corridorCurrencies.includes(invoice.currency) ? "pass" : "fail",
    message: !corridorCurrencies.length ? `No demo currency rules for ${invoice.destinationCountry}`
      : `Invoice currency ${invoice.currency}; demo corridor currencies for ${invoice.destinationCountry}: ${corridorCurrencies.join(", ")}`,
  });
  checks.push({
    id: "reference", source: "deterministic",
    status: invoice.reference?.trim() ? "pass" : "warn",
    message: invoice.reference?.trim() ? "Payment reference supplied"
      : "Missing payment reference: reconciliation risk; confirm the invoice ID as reference during human review",
  });

  const firstKey = ledger.firstKeyFor(fingerprint);
  checks.push(
    firstKey && firstKey !== idempotencyKey
      ? { id: "duplicate", status: "fail", message: "Same supplier, invoice id, currency and amount already checked", source: "deterministic" }
      : { id: "duplicate", status: "pass", message: "No earlier request for this invoice", source: "deterministic" },
  );

  checks.push(
    invoice.amountMinor <= opts.amountCeilingMinor
      ? { id: "amount", status: "pass", message: "Within demo amount ceiling", source: "deterministic" }
      : { id: "amount", status: "fail", message: "Above demo amount ceiling, manual handling", source: "deterministic" },
  );

  const report: ReadinessReport = {
    requestId: createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16),
    invoiceFingerprint: fingerprint,
    verdict: verdictFor(checks),
    checks,
    routeQuote: corridor ? simulatedQuote(invoice, corridor) : undefined,
    source: "demo-fixture",
    payoutExecuted: false,
    disclaimer:
      "Data-quality and routing readiness only. Not an AML, sanctions or KYB decision. Route and fees are simulated. A human must approve any payout.",
    generatedAt: new Date().toISOString(),
  };
  ledger.record(idempotencyKey, report);
  return report;
}

function accountCheck(inv: Invoice): ReadinessCheck {
  if (inv.iban) {
    const r = validateIban(inv.iban);
    if (!r.ok) return { id: "account", status: "fail", message: r.reason!, source: "deterministic" };
    if (inv.bic) {
      // Country disagreement is reported separately as a warning, not a malformed account.
      const b = validateBic(inv.bic, inv.bic.toUpperCase().slice(4, 6));
      if (!b.ok) return { id: "account", status: "fail", message: b.reason!, source: "deterministic" };
    }
    return { id: "account", status: "pass", message: "IBAN valid (mod-97, length)", source: "deterministic" };
  }
  if (inv.routingNumber) {
    return validateAbaRouting(inv.routingNumber)
      ? { id: "account", status: "pass", message: "ABA routing checksum valid", source: "deterministic" }
      : { id: "account", status: "fail", message: "ABA routing checksum failed", source: "deterministic" };
  }
  return { id: "account", status: "fail", message: "No account identifier", source: "deterministic" };
}

function verdictFor(checks: ReadinessCheck[]): Verdict {
  const failed = (id: ReadinessCheck["id"]) => checks.some(c => c.id === id && c.status === "fail");
  if (failed("corridor") || failed("currency") || failed("duplicate") || failed("amount")) return "blocked";
  // A missing reference is advisory: the required invoice ID can be confirmed by the human.
  if (failed("required_fields") || failed("account") || failed("iban_country") || checks.some(c => c.status === "warn" && c.id !== "reference")) return "needs_info";
  return "ready_for_review";
}
