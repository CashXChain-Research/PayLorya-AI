import { createHash } from "node:crypto";
import {
  CxcApiError,
  type CashXChainClient,
  type CxcAccount,
  type CxcAccountInput,
  type CxcBeneficiaryInput,
  type CxcCorridor,
  type CxcPayout,
} from "./cashxchain.js";
import type { Run, RunState, RunStore } from "./runs.js";
import { CURRENCY_EXPONENT, type CxcPayoutPlan, type Invoice } from "./types.js";

export type PrepareOutcome =
  | { kind: "ready"; plan: CxcPayoutPlan }
  // needs_info / blocked: about the invoice. unavailable: about our CashXChain setup or the API.
  | { kind: "needs_info" | "blocked" | "unavailable"; reason: string };

export type Decision = { ok: true } | { ok: false; status: number; error: string };

// Production rails take at most 18 characters; the sandbox does not check.
const REFERENCE_MAX = 18;
// 4xx codes documented as recording the key against a payout that will never pay.
const KEY_BURNING_CODES = new Set(["insufficient_balance", "idempotency_key_reuse", "rate_limited"]);
const APPROVABLE = new Set<RunState>(["DRAFT_READY", "PAYOUT_FAILED", "PAYOUT_IN_FLIGHT", "PAYOUT_UNKNOWN"]);
const REJECTABLE = new Set<RunState>(["DRAFT_READY", "PAYOUT_FAILED"]);

export interface PayoutDeskOptions {
  pollIntervalMs?: number;
  pollAttempts?: number;
}

/**
 * Supplier payouts through the CashXChain sandbox. `prepare` runs automatically and moves no
 * money. `approve` is the only path to `POST /v1/banking/payouts`, and only a human calls it.
 */
export class PayoutDesk {
  private readonly pollIntervalMs: number;
  private readonly pollAttempts: number;

  constructor(
    private readonly client: CashXChainClient,
    private readonly runs: RunStore,
    opts: PayoutDeskOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
    this.pollAttempts = opts.pollAttempts ?? 10;
  }

  /** Source account, corridor, beneficiary, payee check, quote and balance. Nothing moves. */
  async prepare(invoice: Invoice): Promise<PrepareOutcome> {
    const { currency, destinationCountry: country } = invoice;
    try {
      const source = pickSourceAccount(await this.client.listAccounts(), currency);
      if (!source) return { kind: "unavailable", reason: "no active account in the CashXChain sandbox; open one in the sandbox web app" };

      let corridor: CxcCorridor;
      try {
        corridor = await this.client.corridor(currency, country, "business");
      } catch (error) {
        if (error instanceof CxcApiError && error.code === "corridor_unsupported") return { kind: "blocked", reason: error.message };
        throw error;
      }

      const account = accountFor(invoice, corridor.accepted_schemes);
      if (!account) {
        return {
          kind: "needs_info",
          reason: `${currency}/${country} takes ${corridor.accepted_schemes.join(" or ")}; the invoice has no matching account details`,
        };
      }
      const corridorFields = corridorFieldsFor(invoice, corridor);
      const missing = missingFields(corridor, account, corridorFields);
      if (missing.length) return { kind: "needs_info", reason: `${currency}/${country} also requires ${missing.join(", ")}` };

      const beneficiaryInput: CxcBeneficiaryInput = {
        beneficiary_type: "business",
        name: invoice.supplier,
        currency,
        country_code: country,
        account,
        ...(Object.keys(corridorFields).length ? { corridor_fields: corridorFields } : {}),
      };
      let beneficiaryId: string;
      try {
        beneficiaryId = (await this.client.createBeneficiary(beneficiaryInput, beneficiaryKey(beneficiaryInput))).id;
      } catch (error) {
        // Corridor validation of the supplier's details, e.g. "scheme \"iban\" requires field \"iban\"".
        if (error instanceof CxcApiError && error.status === 400) return { kind: "needs_info", reason: error.message };
        throw error;
      }

      const payee = await this.client.verifyPayee(beneficiaryId);
      if (!payee.may_pay) {
        const holder = payee.account_holder ? ` (bank holds "${payee.account_holder}")` : "";
        return { kind: "needs_info", reason: `payee-name check: ${payee.outcome}${holder}` };
      }

      const amount = toDecimal(invoice.amountMinor, currency);
      const quote = await this.client.quote({ source_account_id: source.id, beneficiary_id: beneficiaryId, amount, currency });
      const available = (await this.client.balance(source.id)).find(b => b.currency === quote.source_currency)?.available;
      const need = scaled(quote.source_amount);
      const have = available === undefined ? undefined : scaled(available);

      return {
        kind: "ready",
        plan: {
          environment: "sandbox",
          sourceAccountId: source.id,
          beneficiaryId,
          scheme: account.scheme,
          crossCurrency: source.currency !== currency,
          amount,
          currency,
          reference: (invoice.reference ?? invoice.id).slice(0, REFERENCE_MAX),
          payeeCheck: { outcome: payee.outcome, mayPay: payee.may_pay, ...(payee.check ? { check: payee.check } : {}) },
          quote: {
            sourceAmount: quote.source_amount,
            sourceCurrency: quote.source_currency,
            fee: quote.fee,
            rate: quote.rate,
            simulated: quote.simulated,
          },
          ...(available !== undefined ? { available } : {}),
          ...(need !== undefined && have !== undefined ? { sufficientFunds: have >= need } : {}),
          preparedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Human approval. Synchronous check-and-set, so a double click cannot send twice; the payout
   * itself runs in the background. Also re-checks an in-flight or unknown payout (same key).
   */
  approve(run: Run): Decision {
    const plan = run.draft?.cashxchain;
    if (!run.draft?.executable || !plan || !run.fingerprint) {
      return { ok: false, status: 409, error: `draft is not executable${run.draft?.blockedReason ? `: ${run.draft.blockedReason}` : ""}` };
    }
    if (!APPROVABLE.has(run.state)) return { ok: false, status: 409, error: `run is ${run.state}` };

    const prev = run.payout;
    const recheck = (run.state === "PAYOUT_IN_FLIGHT" || run.state === "PAYOUT_UNKNOWN") && prev !== undefined;
    if (!recheck) {
      const attempt = prev ? (prev.retryWithNewKey ? prev.attempt + 1 : prev.attempt) : 1;
      run.payout = {
        environment: "sandbox",
        idempotencyKey: payoutKey(run.fingerprint, attempt),
        attempt,
        approvedAt: new Date().toISOString(),
      };
    }
    this.runs.transition(run, "PAYOUT_SENDING", recheck ? "Re-checking the payout (same Idempotency-Key)" : "Approved by a human");
    void this.send(run, plan, recheck);
    return { ok: true };
  }

  private async send(run: Run, plan: CxcPayoutPlan, recheck: boolean): Promise<void> {
    const record = run.payout!;
    let payout: CxcPayout;
    try {
      // Without an id, replaying the same key and body is the lookup: it never sends twice.
      payout = recheck && record.id
        ? await this.client.getPayout(record.id)
        : await this.client.createPayout(
            {
              source_account_id: plan.sourceAccountId,
              beneficiary_id: plan.beneficiaryId,
              amount: plan.amount,
              currency: plan.currency,
              reference: plan.reference,
            },
            record.idempotencyKey,
          );
    } catch (error) {
      record.error = errorInfo(error);
      if (!record.id && error instanceof CxcApiError && error.status >= 400 && error.status < 500) {
        // A 4xx on the create: refused, nothing was paid. Some refusals still burn the key.
        record.retryWithNewKey = error.code !== undefined && KEY_BURNING_CODES.has(error.code);
        this.runs.transition(run, "PAYOUT_FAILED", `Refused, nothing paid: ${record.error.message}`);
      } else {
        // 5xx, timeout, network: the payout may exist. Approving again replays the same key.
        this.runs.transition(run, "PAYOUT_UNKNOWN", `Outcome unknown, do not pay elsewhere: ${record.error.message}`);
      }
      return;
    }

    this.apply(run, payout);
    for (let i = 0; i < this.pollAttempts && inFlight(run); i++) {
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      try {
        this.apply(run, await this.client.getPayout(payout.id));
      } catch (error) {
        record.error = errorInfo(error); // keep the last known status; approve again to re-check
        return;
      }
    }
  }

  private apply(run: Run, payout: CxcPayout): void {
    const record = run.payout!;
    Object.assign(record, {
      id: payout.id,
      status: payout.status,
      amount: payout.amount,
      currency: payout.currency,
      createdAt: payout.created_at,
      submittedAt: payout.submitted_at,
      settledAt: payout.settled_at,
      error: undefined,
    });
    const state = stateFor(payout.status);
    if (state === "PAYOUT_FAILED") record.retryWithNewKey = true;
    if (run.state !== state) this.runs.transition(run, state, `CashXChain payout ${payout.id}: ${payout.status}`);
  }
}

/** Works with or without CashXChain configured: a rejected draft is never paid. */
export function rejectDraft(runs: RunStore, run: Run): Decision {
  if (!run.draft) return { ok: false, status: 409, error: "no draft to reject" };
  if (!REJECTABLE.has(run.state)) return { ok: false, status: 409, error: `run is ${run.state}` };
  runs.transition(run, "REJECTED", "Rejected by a human; nothing paid");
  return { ok: true };
}

function stateFor(status: string): RunState {
  switch (status) {
    case "settled":
      return "PAYOUT_SETTLED";
    case "submitted":
    case "processing":
      return "PAYOUT_IN_FLIGHT";
    case "failed":
    case "cancelled":
    case "returned":
      return "PAYOUT_FAILED";
    default:
      return "PAYOUT_UNKNOWN"; // `created`: recorded, outcome not known yet
  }
}

function inFlight(run: Run): boolean {
  return run.state === "PAYOUT_IN_FLIGHT" || (run.state === "PAYOUT_UNKNOWN" && run.payout?.id !== undefined);
}

function errorInfo(error: unknown): { httpStatus?: number; code?: string; message: string } {
  if (error instanceof CxcApiError) return { httpStatus: error.status, ...(error.code ? { code: error.code } : {}), message: error.message };
  return { message: error instanceof Error ? error.message : String(error) };
}

/**
 * An active account in the invoice currency; else the primary (or first) active account. The
 * sandbox rail converts a cross-currency payout itself. Production would refuse that without an
 * `fx_quote_id`, which this sandbox-only build does not implement.
 */
export function pickSourceAccount(
  { accounts, primaryCurrency }: { accounts: CxcAccount[]; primaryCurrency?: string },
  currency: string,
): CxcAccount | undefined {
  const active = accounts.filter(a => a.status === "active");
  return active.find(a => a.currency === currency) ?? active.find(a => a.currency === primaryCurrency) ?? active[0];
}

/** Maps the invoice's bank details onto a scheme the corridor accepts. Never invents details. */
export function accountFor(invoice: Invoice, schemes: string[]): CxcAccountInput | undefined {
  if (schemes.includes("iban") && invoice.iban) {
    return { scheme: "iban", iban: invoice.iban, ...(invoice.bic ? { bic: invoice.bic } : {}) };
  }
  if (schemes.includes("us_routing") && invoice.routingNumber && invoice.accountNumber) {
    return { scheme: "us_routing", routing_number: invoice.routingNumber, account_number: invoice.accountNumber };
  }
  const swiftAccount = invoice.accountNumber ?? invoice.iban;
  if (schemes.includes("swift_bic") && invoice.bic && swiftAccount) {
    return { scheme: "swift_bic", bic: invoice.bic, account_number: swiftAccount };
  }
  return undefined;
}

/** Extra corridor fields we can fill from the invoice, sent only when the corridor asks for them. */
export function corridorFieldsFor(invoice: Invoice, corridor: CxcCorridor): Record<string, string> {
  const known: Record<string, string | undefined> = { account_type: invoice.accountType };
  const out: Record<string, string> = {};
  for (const field of corridor.fields) {
    const value = known[field.key];
    if (value) out[field.key] = value;
  }
  return out;
}

/**
 * Required fields neither the account nor our corridor fields carry. Mirrors the server's own
 * check for plain required fields; rail-dependent, conditional, fixed and role-derived fields
 * are left to the server.
 */
export function missingFields(corridor: CxcCorridor, account: CxcAccountInput, corridorFields: Record<string, string>): string[] {
  const present = new Set([...Object.keys(account), ...Object.keys(corridorFields)]);
  return corridor.fields
    .filter(f => f.required && !f.conditional_on && !f.required_for_rails?.length && !f.fixed_value && !f.role)
    .filter(f => !present.has(f.key))
    .map(f => `${f.key} (${f.label})`);
}

/** Integer minor units to the decimal string CashXChain expects, with the currency's decimals. */
export function toDecimal(amountMinor: number, currency: string): string {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === undefined) throw new Error(`unsupported currency ${currency}`);
  if (exp === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exp + 1, "0");
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

function scaled(decimal: string): bigint | undefined {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) return undefined;
  const value = BigInt(m[2]! + (m[3] ?? "").padEnd(8, "0").slice(0, 8));
  return m[1] ? -value : value;
}

/** Same payee details -> same key, so a retried registration returns the same beneficiary. */
function beneficiaryKey(input: CxcBeneficiaryInput): string {
  return `agentpay-ben-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`;
}

/** Bound to the invoice, not the run: a restart or a second run replays instead of paying again. */
export function payoutKey(fingerprint: string, attempt: number): string {
  return `agentpay-payout-${fingerprint}-${attempt}`;
}
