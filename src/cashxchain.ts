// CashXChain money API client (`/v1/banking/*`), written against docs.cashxchain.com/docs/api
// and the backend DTOs. No SDK dependency: plain fetch, bearer key, JSON.

// Fixed on purpose, like CARDANO_NETWORK: this build only ever touches the CashXChain sandbox.
export const CXC_SANDBOX_API = "https://api.sandbox.cashxchain.com";
// Secret or restricted sandbox key. Live keys (`cxc_sk_live_`) and the legacy unprefixed
// format (`sk_sandbox_…`, which can be a production key) are refused.
export const CXC_SANDBOX_KEY = /^cxc_(sk|rk)_sandbox_[A-Za-z0-9]+$/;

/** Canonical payout status. `submitted`/`processing` are in flight; only `settled` means arrived. */
export type CxcPayoutStatus = "created" | "submitted" | "processing" | "settled" | "failed" | "cancelled" | "returned";

export interface CxcAccount {
  id: string;
  currency: string;
  status: string;
  display_name?: string;
}

export interface CxcCorridorField {
  key: string;
  label: string;
  required: boolean;
  pattern?: string;
  allowed_values?: string[];
  required_for_rails?: string[];
  conditional_on?: string;
  fixed_value?: string;
  role?: string;
}

export interface CxcCorridor {
  currency: string;
  country_code: string;
  accepted_schemes: string[];
  rails: string[];
  fields: CxcCorridorField[];
}

export type CxcAccountInput =
  | { scheme: "iban"; iban: string; bic?: string }
  | { scheme: "us_routing"; routing_number: string; account_number: string }
  | { scheme: "swift_bic"; bic: string; account_number: string };

export interface CxcBeneficiaryInput {
  beneficiary_type: "business" | "individual";
  name: string;
  currency: string;
  country_code: string;
  account: CxcAccountInput;
  corridor_fields?: Record<string, string>;
}

export interface CxcBeneficiary {
  id: string;
  name: string;
  currency: string;
  country_code: string;
}

export interface CxcPayeeCheck {
  outcome: "matched" | "not_checked" | "close_match" | "no_match" | "invalid";
  may_pay: boolean;
  account_holder?: string;
  check?: string;
}

export interface CxcQuote {
  source_currency: string;
  source_amount: string;
  fee: string;
  payment_fee: string;
  rate: string;
  currency: string;
  amount: string;
  simulated: boolean;
}

export interface CxcBalance {
  account_id: string;
  currency: string;
  available: string;
}

export interface CxcPayoutInput {
  source_account_id: string;
  beneficiary_id: string;
  amount: string;
  currency: string;
  reference?: string;
}

export interface CxcPayout {
  id: string;
  status: CxcPayoutStatus;
  amount: string;
  currency: string;
  partner_status?: string;
  created_at: string;
  submitted_at?: string;
  settled_at?: string;
}

/** An HTTP answer from CashXChain that is not 2xx. `code` is the envelope's stable `error`. */
export class CxcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly requestId: string | undefined,
    readonly details?: unknown,
  ) {
    super(`CashXChain ${status}${code ? ` ${code}` : ""}: ${message}${requestId ? ` (request ${requestId})` : ""}`);
  }
}

/** No HTTP answer at all (network, timeout): the request may or may not have been processed. */
export class CxcNetworkError extends Error {}

export interface CxcClientOptions {
  apiKey: string;
  baseUrl?: string; // tests point this at a local fake; production code never sets it
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class CashXChainClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: CxcClientOptions) {
    this.baseUrl = opts.baseUrl ?? CXC_SANDBOX_API;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async listAccounts(): Promise<{ accounts: CxcAccount[]; primaryCurrency?: string }> {
    const res = await this.call<{ accounts: CxcAccount[]; primary_currency?: string }>("GET", "/v1/banking/accounts");
    return { accounts: res.accounts, ...(res.primary_currency ? { primaryCurrency: res.primary_currency } : {}) };
  }

  async balance(accountId: string): Promise<CxcBalance[]> {
    const path = `/v1/banking/accounts/${encodeURIComponent(accountId)}/balance`;
    return (await this.call<{ balances: CxcBalance[] }>("GET", path)).balances;
  }

  corridor(currency: string, country: string, entityType: "business" | "individual"): Promise<CxcCorridor> {
    const q = new URLSearchParams({ currency, country, entity_type: entityType });
    return this.call("GET", `/v1/banking/corridors?${q}`);
  }

  /** Sandbox returns the same beneficiary for the same key; production may register a duplicate. */
  createBeneficiary(input: CxcBeneficiaryInput, idempotencyKey: string): Promise<CxcBeneficiary> {
    return this.call("POST", "/v1/banking/beneficiaries", input, idempotencyKey);
  }

  verifyPayee(beneficiaryId: string): Promise<CxcPayeeCheck> {
    return this.call("POST", `/v1/banking/beneficiaries/${encodeURIComponent(beneficiaryId)}/verify`);
  }

  /** Prices a payout. Moves nothing, takes no key. */
  quote(input: Omit<CxcPayoutInput, "reference">): Promise<CxcQuote> {
    return this.call("POST", "/v1/banking/payouts/quote", input);
  }

  /** Same key + same body returns the payout as it is now (never a second payout). */
  createPayout(input: CxcPayoutInput, idempotencyKey: string): Promise<CxcPayout> {
    return this.call("POST", "/v1/banking/payouts", input, idempotencyKey);
  }

  getPayout(id: string): Promise<CxcPayout> {
    return this.call("GET", `/v1/banking/payouts/${encodeURIComponent(id)}`);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CxcNetworkError(`CashXChain ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
    // Framework rejections (415, plain-text 400/422) and empty 404/405 are not JSON.
    const json = (res.headers.get("content-type") ?? "").includes("application/json") ? safeJson(text) : undefined;
    if (!res.ok) {
      const env = isRecord(json) ? json : {};
      const code = typeof env.error === "string" ? env.error : undefined;
      const message = typeof env.message === "string" ? env.message : text.trim() || res.statusText;
      throw new CxcApiError(res.status, code, message, requestId, env.details);
    }
    if (json === undefined) throw new CxcApiError(res.status, undefined, "expected a JSON body", requestId);
    return json as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
