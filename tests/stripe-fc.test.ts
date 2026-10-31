import { describe, expect, it } from "vitest";
import { catalog, fetchBalances, prepareConnection } from "../src/cfo/connections.js";
import { accountBalances, accountLabel, StripeFc } from "../src/cfo/stripe.js";

function fakeStripe() {
  const calls: Array<{ method: string; url: string; body?: string; auth?: string }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined, auth: (init?.headers as Record<string, string>)?.authorization });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/customers")) return json({ id: "cus_1" });
    if (url.endsWith("/v1/financial_connections/sessions")) return json({ id: "fcsess_1", client_secret: "fcsess_1_secret" });
    if (url.includes("/v1/financial_connections/sessions/fcsess_1"))
      return json({ accounts: { data: [{ id: "fca_1", institution_name: "StripeBank", display_name: "Checking", last4: "6789" }] } });
    if (url.endsWith("/v1/financial_connections/accounts/fca_1/refresh")) return json({ error: { message: "refresh not available yet" } }, 400);
    if (url.endsWith("/v1/financial_connections/accounts/fca_1"))
      return json({ id: "fca_1", institution_name: "StripeBank", balance: { type: "cash", current: { usd: 612345 } } });
    return json({ error: { message: "not found" } }, 404);
  }) as typeof fetch;
  return { stripe: new StripeFc("sk_test_x", fetchFn), calls };
}

describe("Stripe Financial Connections", () => {
  it("creates a balances session for a new customer", async () => {
    const { stripe, calls } = fakeStripe();
    expect(await stripe.createSession({ id: "ws1", name: "Acme" })).toEqual({ id: "fcsess_1", clientSecret: "fcsess_1_secret" });
    const body = new URLSearchParams(calls[1]!.body);
    expect(body.get("account_holder[type]")).toBe("customer");
    expect(body.get("account_holder[customer]")).toBe("cus_1");
    expect(body.getAll("permissions[]")).toEqual(["balances"]);
    expect(calls[0]!.auth).toBe("Bearer sk_test_x");
    expect(stripe.livemode).toBe(false);
  });

  it("labels accounts and reads balances in minor units", async () => {
    const { stripe } = fakeStripe();
    const [a] = await stripe.sessionAccounts("fcsess_1");
    expect(accountLabel(a!)).toBe("StripeBank Checking ••6789");
    expect(accountBalances({ id: "fca", institution_name: "B", balance: { current: { eur: 1050 } } })).toEqual([{ currency: "EUR", minor: 1050 }]);
  });

  it("offers bank only with Stripe, never through POST /connections", () => {
    const { stripe } = fakeStripe();
    expect(catalog({}).find(c => c.kind === "bank")?.available).toBe(false);
    const bank = catalog({ stripe }).find(c => c.kind === "bank")!;
    expect(bank.available && bank.viaStripe).toBe(true);
    expect(bank.supports.write).toBe(false);
    expect(prepareConnection({ stripe }, { kind: "bank" })).toHaveProperty("error");
  });

  it("falls back to the last known balance when a refresh is refused", async () => {
    const { stripe } = fakeStripe();
    expect(await fetchBalances({ stripe }, { kind: "bank", address: "fca_1" })).toEqual([{ asset: "USD", amount: "6123.45", usdMinor: 612345 }]);
  });
});
