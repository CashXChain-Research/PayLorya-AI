import { createHash, randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import type { CxcPayout, CxcPayoutStatus } from "../src/cashxchain.js";

// In-process stand-in for the CashXChain sandbox money API. Behaviour follows
// docs.cashxchain.com/docs/api (payouts, beneficiaries, idempotency, errors) and the backend's
// mock rail corridor table (EUR/SEPA iban, USD/US us_routing + account_type, GBP/GB scan).

export const FAKE_KEY = "cxc_sk_sandbox_fakeKey123";

interface Seen {
  method: string;
  path: string;
  idempotencyKey?: string;
  authorization?: string;
  body: unknown;
}

interface Failure {
  status: number;
  error: string;
  message: string;
  /** Record the payout before answering (a 5xx after the work was done, or insufficient_balance). */
  record?: CxcPayoutStatus;
}

const envelope = (res: Response, status: number, error: string, message: string, details?: unknown) =>
  void res
    .status(status)
    .set("x-request-id", `req_${randomUUID().slice(0, 8)}`)
    .json({ success: false, error, message, ...(details ? { details } : {}) });

export function createFakeCxc() {
  const state = {
    accounts: [{ id: "mockacct_fake_eur", currency: "EUR", status: "active", display_name: "EUR account" }],
    balances: new Map<string, number>([["mockacct_fake_eur", 50_000]]),
    payee: { outcome: "not_checked", may_pay: true } as Record<string, unknown>,
    beneficiaries: new Map<string, { id: string; body: Record<string, unknown> }>(),
    payouts: new Map<string, { hash: string; payout: CxcPayout }>(),
    /** Answer the next payout create with this instead of executing it. */
    failNextCreate: undefined as Failure | undefined,
    /** Status a new payout gets (the sandbox settles inside the request). */
    createStatus: "settled" as CxcPayoutStatus,
    /** Statuses GET /payouts/{id} walks through, one per call; the last one sticks. */
    getStatuses: [] as CxcPayoutStatus[],
    seen: [] as Seen[],
  };

  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, res: Response, next) => {
    state.seen.push({
      method: req.method,
      path: req.originalUrl,
      idempotencyKey: req.header("idempotency-key"),
      authorization: req.header("authorization"),
      body: req.body,
    });
    if (req.header("authorization") !== `Bearer ${FAKE_KEY}`) return envelope(res, 401, "unauthorized", "unauthorized");
    next();
  });

  app.get("/v1/banking/accounts", (_req, res) => void res.json({ accounts: state.accounts, refreshing: false, primary_currency: "EUR" }));

  app.get("/v1/banking/accounts/:id/balance", (req, res) => {
    const account = state.accounts.find(a => a.id === req.params.id);
    if (!account) return envelope(res, 404, "not_found", "account not found");
    res.json({
      balances: [{ account_id: account.id, currency: account.currency, available: (state.balances.get(account.id) ?? 0).toFixed(4), pending: "0" }],
      refreshing: false,
    });
  });

  app.get("/v1/banking/corridors", (req, res) => {
    const corridor = corridorFor(String(req.query.currency), String(req.query.country));
    if (!corridor) {
      return envelope(res, 422, "corridor_unsupported", `${req.query.currency} payouts to ${req.query.country} are not offered. Retrying will not change this: choose another currency or destination.`);
    }
    res.json(corridor);
  });

  app.post("/v1/banking/beneficiaries", (req, res) => {
    const key = req.header("idempotency-key");
    if (!key) return envelope(res, 400, "bad_request", "Idempotency-Key header is required on write endpoints");
    const existing = state.beneficiaries.get(key);
    if (existing) return void res.status(201).json(beneficiaryDto(existing.id, existing.body));
    const body = req.body as Record<string, unknown> & { account: Record<string, string>; corridor_fields?: Record<string, string> };
    const corridor = corridorFor(String(body.currency), String(body.country_code));
    if (!corridor) return envelope(res, 422, "corridor_unsupported", "not offered");
    if (!corridor.accepted_schemes.includes(body.account.scheme!)) {
      return envelope(res, 400, "bad_request", `corridor validation failed for ${body.currency}/${body.country_code}: identifier scheme "${body.account.scheme}" not accepted`);
    }
    const missing = corridor.fields.filter(f => f.required && !body.account[f.key] && !body.corridor_fields?.[f.key]);
    if (missing.length) {
      return envelope(res, 400, "bad_request", `corridor validation failed for ${body.currency}/${body.country_code}: missing required field "${missing[0]!.key}"`);
    }
    const id = `mockben_fake_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
    state.beneficiaries.set(key, { id, body });
    res.status(201).json(beneficiaryDto(id, body));
  });

  app.post("/v1/banking/beneficiaries/:id/verify", (req, res) => {
    if (![...state.beneficiaries.values()].some(b => b.id === req.params.id)) return envelope(res, 404, "not_found", "not found");
    res.json(state.payee);
  });

  app.post("/v1/banking/payouts/quote", (req, res) => {
    const { source_account_id, currency, amount } = req.body as { source_account_id: string; currency: string; amount: string };
    const account = state.accounts.find(a => a.id === source_account_id);
    if (!account) return envelope(res, 404, "not_found", "account not found");
    const fee = 5;
    const rate = account.currency === currency ? 1 : RATE_PER_EUR[currency] ?? 1;
    res.json({
      source_currency: account.currency,
      source_amount: (Number(amount) / rate + fee).toFixed(2),
      fee: fee.toFixed(2),
      payment_fee: fee.toFixed(2),
      rate: String(rate),
      currency,
      amount,
      simulated: true,
    });
  });

  app.post("/v1/banking/payouts", (req, res) => {
    const key = req.header("idempotency-key");
    if (!key) return envelope(res, 400, "bad_request", "Idempotency-Key header is required on write endpoints");
    const hash = createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
    const prior = state.payouts.get(key);
    if (prior) {
      if (prior.hash !== hash) return envelope(res, 409, "idempotency_key_reuse", "this Idempotency-Key was used for a different request");
      return void res.status(200).json(prior.payout);
    }
    const body = req.body as { source_account_id: string; amount: string; currency: string };
    const record = (status: CxcPayoutStatus): CxcPayout => {
      const now = new Date().toISOString();
      const payout: CxcPayout = {
        id: randomUUID(),
        status,
        amount: Number(body.amount).toFixed(4),
        currency: body.currency,
        created_at: now,
        ...(status !== "created" && status !== "failed" ? { submitted_at: now } : {}),
        ...(status === "settled" ? { settled_at: now } : {}),
      };
      state.payouts.set(key, { hash, payout });
      return payout;
    };

    const failure = state.failNextCreate;
    if (failure) {
      state.failNextCreate = undefined;
      if (failure.record) record(failure.record);
      return envelope(res, failure.status, failure.error, failure.message);
    }
    const available = state.balances.get(body.source_account_id) ?? 0;
    const source = state.accounts.find(a => a.id === body.source_account_id);
    const rate = source && source.currency !== body.currency ? RATE_PER_EUR[body.currency] ?? 1 : 1;
    const debit = Number(body.amount) / rate + 5;
    if (debit > available) {
      record("failed");
      return envelope(res, 400, "insufficient_balance", "insufficient balance");
    }
    const payout = record(state.createStatus);
    if (payout.status === "settled") state.balances.set(body.source_account_id, available - debit);
    res.status(202).json(payout);
  });

  app.get("/v1/banking/payouts/:id", (req, res) => {
    const entry = [...state.payouts.values()].find(p => p.payout.id === req.params.id);
    if (!entry) return envelope(res, 404, "not_found", "payout not found");
    const next = state.getStatuses.length > 1 ? state.getStatuses.shift() : state.getStatuses[0];
    if (next) {
      entry.payout.status = next;
      if (next === "settled") entry.payout.settled_at = new Date().toISOString();
    }
    res.json(entry.payout);
  });

  return {
    app,
    state,
    payoutCount: () => state.payouts.size,
    payoutCreates: () => state.seen.filter(s => s.method === "POST" && s.path === "/v1/banking/payouts"),
  };
}

function beneficiaryDto(id: string, body: Record<string, unknown>) {
  return { id, beneficiary_type: body.beneficiary_type, name: body.name, currency: body.currency, country_code: body.country_code, account: body.account };
}

// Sandbox-style conversion for cross-currency payouts from the EUR account.
const RATE_PER_EUR: Record<string, number> = { USD: 1.25, GBP: 0.8 };

const SEPA = ["DE", "FR", "NL", "ES", "IT", "AT", "BE", "IE", "PT", "FI", "LU"];

function corridorFor(currency: string, country: string) {
  if (currency === "EUR" && SEPA.includes(country)) {
    return {
      currency, country_code: country, accepted_schemes: ["iban"], rails: ["sepa", "sepa_instant"],
      fields: [{ key: "bic", label: "BIC / SWIFT code", required: false, group: "account" }],
    };
  }
  if (currency === "USD" && country === "US") {
    return {
      currency, country_code: country, accepted_schemes: ["us_routing"], rails: ["ach", "fedwire"],
      fields: [
        { key: "account_type", label: "Account type", required: true, allowed_values: ["checking", "savings"], group: "account" },
        { key: "beneficiary_state", label: "Beneficiary state", required: false, group: "address" },
      ],
    };
  }
  if (currency === "GBP" && country === "GB") {
    return { currency, country_code: country, accepted_schemes: ["scan"], rails: ["fps", "chaps", "bacs"], fields: [] };
  }
  return undefined;
}
