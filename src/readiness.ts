import { createHash } from "node:crypto";
import { CxcApiError, type CashXChainClient, type CxcCorridor } from "./cashxchain.js";
import { findCorridor, simulatedQuote } from "./fixtures.js";
import { accountFor, corridorFieldsFor, missingFields, pickSourceAccount, toDecimal } from "./payout.js";
import type { CxcRouteQuote, DataSource, Invoice, ReadinessCheck, ReadinessReport, RouteQuote, Verdict } from "./types.js";

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
  private inFlight = new Map<string, Promise<ReadinessReport>>();

  cached(idempotencyKey: string): ReadinessReport | undefined {
    return this.byIdempotencyKey.get(idempotencyKey);
  }

  firstKeyFor(fingerprint: string): string | undefined {
    return this.byFingerprint.get(fingerprint);
  }

  /** First key that checked this invoice; `idempotencyKey` becomes it if none did yet. */
  claim(fingerprint: string, idempotencyKey: string): string {
    const first = this.byFingerprint.get(fingerprint);
    if (first) return first;
    this.byFingerprint.set(fingerprint, idempotencyKey);
    return idempotencyKey;
  }

  record(idempotencyKey: string, report: ReadinessReport): void {
    if (!this.byFingerprint.has(report.invoiceFingerprint)) {
      this.byFingerprint.set(report.invoiceFingerprint, idempotencyKey);
    }
    this.byIdempotencyKey.set(idempotencyKey, report);
  }

  /** Cached report, or the build already running under this key, or a new build. */
  once(idempotencyKey: string, build: () => Promise<ReadinessReport>): Promise<ReadinessReport> {
    const cached = this.cached(idempotencyKey);
    if (cached) return Promise.resolve(cached);
    let pending = this.inFlight.get(idempotencyKey);
    if (!pending) {
      pending = build().finally(() => this.inFlight.delete(idempotencyKey));
      this.inFlight.set(idempotencyKey, pending);
    }
    return pending;
  }
}

export interface ReadinessOptions {
  amountCeilingMinor: number;
}

/** Where corridor, required_fields and the quote came from. */
interface Routing {
  corridor: ReadinessCheck;
  requiredFields: ReadinessCheck;
  routeQuote?: RouteQuote;
  cxcQuote?: CxcRouteQuote;
  source: DataSource;
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
  const firstKey = ledger.claim(fingerprint, idempotencyKey);
  return finishReport(invoice, idempotencyKey, ledger, opts, fingerprint, firstKey, fixtureRouting(invoice));
}

/**
 * Same report, with corridor, required_fields and quote from the CashXChain sandbox. Any CashXChain
 * failure other than `corridor_unsupported` falls back to the demo fixtures for the affected checks;
 * it never rejects for one. One build per Idempotency-Key: a retry gets the same report, no new calls.
 */
export function buildCxcReadinessReport(
  invoice: Invoice,
  idempotencyKey: string,
  ledger: ReadinessLedger,
  opts: ReadinessOptions,
  cxc: CashXChainClient,
): Promise<ReadinessReport> {
  return ledger.once(idempotencyKey, async () => {
    const fingerprint = invoiceFingerprint(invoice);
    // Claimed before awaiting CashXChain, so concurrent keys for one invoice keep arrival order.
    const firstKey = ledger.claim(fingerprint, idempotencyKey);
    const routing = await cxcRouting(invoice, cxc);
    return finishReport(invoice, idempotencyKey, ledger, opts, fingerprint, firstKey, routing);
  });
}

function finishReport(
  invoice: Invoice,
  idempotencyKey: string,
  ledger: ReadinessLedger,
  opts: ReadinessOptions,
  fingerprint: string,
  firstKey: string,
  routing: Routing,
): ReadinessReport {
  const checks: ReadinessCheck[] = [routing.corridor, routing.requiredFields, accountCheck(invoice)];

  checks.push(
    firstKey !== idempotencyKey
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
    routeQuote: routing.routeQuote,
    ...(routing.cxcQuote ? { cxcQuote: routing.cxcQuote } : {}),
    source: routing.source,
    payoutExecuted: false,
    disclaimer: disclaimerFor(routing),
    generatedAt: new Date().toISOString(),
  };
  ledger.record(idempotencyKey, report);
  return report;
}

function fixtureRouting(invoice: Invoice): Routing {
  const corridor = findCorridor(invoice.destinationCountry, invoice.currency);
  const missing = (corridor?.requiredFields ?? []).filter(f => !invoice[f]);
  return {
    corridor: corridor
      ? { id: "corridor", status: "pass", message: `${invoice.destinationCountry}/${invoice.currency} via ${corridor.rail}`, source: "demo-fixture" }
      : { id: "corridor", status: "fail", message: `No demo corridor for ${invoice.destinationCountry}/${invoice.currency}`, source: "demo-fixture" },
    requiredFields: !corridor
      ? { id: "required_fields", status: "skip", message: "No corridor, no field rules", source: "demo-fixture" }
      : missing.length
        ? { id: "required_fields", status: "fail", message: `Missing: ${missing.join(", ")}`, source: "demo-fixture" }
        : { id: "required_fields", status: "pass", message: `Present: ${corridor.requiredFields.join(", ")}`, source: "demo-fixture" },
    routeQuote: corridor ? simulatedQuote(invoice, corridor) : undefined,
    source: "demo-fixture",
  };
}

/** Read-only calls (corridor, accounts, quote). Creates no beneficiary, moves nothing. */
async function cxcRouting(invoice: Invoice, cxc: CashXChainClient): Promise<Routing> {
  const { currency, destinationCountry: country } = invoice;
  try {
    const [corridorRes, accountsRes] = await Promise.allSettled([cxc.corridor(currency, country, "business"), cxc.listAccounts()]);
    if (corridorRes.status === "rejected") {
      const error: unknown = corridorRes.reason;
      if (!(error instanceof CxcApiError && error.code === "corridor_unsupported")) return fixtureRouting(invoice);
      return {
        corridor: { id: "corridor", status: "fail", message: `No CashXChain corridor for ${country}/${currency} (corridor_unsupported)`, source: "cxc-sandbox" },
        requiredFields: { id: "required_fields", status: "skip", message: "No corridor, no field rules", source: "cxc-sandbox" },
        source: "cxc-sandbox",
      };
    }
    const corridor = corridorRes.value;
    const rails = corridor.rails.join(", ") || "no rails listed";
    const routing: Routing = {
      corridor: { id: "corridor", status: "pass", message: `${country}/${currency} via ${rails}`, source: "cxc-sandbox" },
      requiredFields: cxcFieldsCheck(invoice, corridor),
      source: "cxc-sandbox",
    };

    const account = accountsRes.status === "fulfilled" ? pickSourceAccount(accountsRes.value, currency) : undefined;
    const cxcQuote = account ? await cxcQuoteFor(invoice, account.id, corridor, cxc) : undefined;
    return cxcQuote ? { ...routing, cxcQuote } : { ...routing, routeQuote: fixtureRouting(invoice).routeQuote };
  } catch {
    return fixtureRouting(invoice); // malformed CashXChain answer
  }
}

function cxcFieldsCheck(invoice: Invoice, corridor: CxcCorridor): ReadinessCheck {
  const account = accountFor(invoice, corridor.accepted_schemes);
  if (!account) {
    const schemes = corridor.accepted_schemes.join(" or ");
    return {
      id: "required_fields",
      status: "fail",
      message: `${invoice.currency}/${invoice.destinationCountry} takes ${schemes}; the invoice has no matching account details`,
      source: "cxc-sandbox",
    };
  }
  const fields = corridorFieldsFor(invoice, corridor);
  const missing = missingFields(corridor, account, fields);
  const present = [account.scheme, ...Object.keys(fields)].join(", ");
  return missing.length
    ? { id: "required_fields", status: "fail", message: `Missing: ${missing.join(", ")}`, source: "cxc-sandbox" }
    : { id: "required_fields", status: "pass", message: `Present: ${present}`, source: "cxc-sandbox" };
}

async function cxcQuoteFor(invoice: Invoice, sourceAccountId: string, corridor: CxcCorridor, cxc: CashXChainClient): Promise<CxcRouteQuote | undefined> {
  try {
    const amount = toDecimal(invoice.amountMinor, invoice.currency);
    const q = await cxc.quote({ source_account_id: sourceAccountId, amount, currency: invoice.currency });
    return {
      source: "cxc-sandbox",
      label: "CashXChain sandbox quote",
      rails: corridor.rails,
      payoutCurrency: q.currency,
      payoutAmount: q.amount,
      sourceCurrency: q.source_currency,
      sourceAmount: q.source_amount,
      fee: q.fee,
      rate: q.rate,
    };
  } catch {
    return undefined; // demo-fixture quote instead
  }
}

function disclaimerFor(routing: Routing): string {
  const data =
    routing.source !== "cxc-sandbox"
      ? "Route and fees are simulated."
      : routing.cxcQuote
        ? "Corridor, required fields and quote come from the CashXChain sandbox (sandbox pricing; nothing was paid)."
        : routing.routeQuote
          ? "Corridor and required fields come from the CashXChain sandbox; route and fees are simulated."
          : "Corridor and required fields come from the CashXChain sandbox.";
  return `Data-quality and routing readiness only. Not an AML, sanctions or KYB decision. ${data} A human must approve any payout.`;
}

function accountCheck(inv: Invoice): ReadinessCheck {
  if (inv.iban) {
    const r = validateIban(inv.iban);
    if (!r.ok) return { id: "account", status: "fail", message: r.reason!, source: "deterministic" };
    if (normalizeIban(inv.iban).slice(0, 2) !== inv.destinationCountry) {
      return { id: "account", status: "warn", message: "IBAN country differs from destination country", source: "deterministic" };
    }
    if (inv.bic) {
      const b = validateBic(inv.bic, inv.destinationCountry);
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
  if (failed("corridor") || failed("duplicate") || failed("amount")) return "blocked";
  if (failed("required_fields") || failed("account") || checks.some(c => c.status === "warn")) return "needs_info";
  return "ready_for_review";
}
