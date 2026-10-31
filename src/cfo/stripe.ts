// Stripe Financial Connections: read-only bank balances. No money moves through it.
// REST over fetch (no SDK). API reference: docs.stripe.com/api/financial_connections.

export interface FcAccount {
  id: string; // fca_…
  institution_name: string;
  display_name?: string | null;
  last4?: string | null;
  category?: string;
  subcategory?: string;
  status?: string;
  livemode?: boolean;
  balance?: {
    as_of?: number;
    type?: "cash" | "credit";
    /** Integer amounts keyed by lowercase currency, e.g. { usd: 6000 }. */
    current?: Record<string, number>;
    cash?: { available?: Record<string, number> | null } | null;
  } | null;
  balance_refresh?: { status?: "pending" | "succeeded" | "failed" } | null;
}

export class StripeError extends Error {}

export class StripeFc {
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get livemode(): boolean {
    return this.secretKey.startsWith("sk_live_") || this.secretKey.startsWith("rk_live_");
  }

  private async call<T>(method: "GET" | "POST", path: string, params: Array<[string, string]> = []): Promise<T> {
    const body = new URLSearchParams(params).toString();
    const url = `https://api.stripe.com${path}${method === "GET" && body ? `?${body}` : ""}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe answered ${res.status}`);
    return json;
  }

  /** A session for Stripe.js collectFinancialConnectionsAccounts, owned by a new customer for the workspace. */
  async createSession(workspace: { id: string; name: string }): Promise<{ id: string; clientSecret: string }> {
    const customer = await this.call<{ id: string }>("POST", "/v1/customers", [
      ["name", workspace.name.slice(0, 200)],
      ["metadata[workspace_id]", workspace.id],
    ]);
    const session = await this.call<{ id: string; client_secret: string }>("POST", "/v1/financial_connections/sessions", [
      ["account_holder[type]", "customer"],
      ["account_holder[customer]", customer.id],
      ["permissions[]", "balances"],
      ["prefetch[]", "balances"],
    ]);
    return { id: session.id, clientSecret: session.client_secret };
  }

  /** The accounts the user linked in a session. */
  async sessionAccounts(sessionId: string): Promise<FcAccount[]> {
    const s = await this.call<{ accounts?: { data?: FcAccount[] } }>("GET", `/v1/financial_connections/sessions/${encodeURIComponent(sessionId)}`);
    return s.accounts?.data ?? [];
  }

  async account(id: string): Promise<FcAccount> {
    return this.call<FcAccount>("GET", `/v1/financial_connections/accounts/${encodeURIComponent(id)}`);
  }

  /** Asks the bank for a fresh balance; the result arrives on the account asynchronously. */
  async refreshBalance(id: string): Promise<FcAccount> {
    return this.call<FcAccount>("POST", `/v1/financial_connections/accounts/${encodeURIComponent(id)}/refresh`, [["features[]", "balance"]]);
  }
}

export function accountLabel(a: FcAccount): string {
  const name = a.display_name ? `${a.institution_name} ${a.display_name}` : a.institution_name;
  return `${name}${a.last4 ? ` ••${a.last4}` : ""}`.slice(0, 80);
}

/** Current balance per currency, in minor units (Stripe's integer amounts). */
export function accountBalances(a: FcAccount): Array<{ currency: string; minor: number }> {
  const current = a.balance?.current ?? {};
  return Object.entries(current).map(([currency, minor]) => ({ currency: currency.toUpperCase(), minor }));
}
