// Link bank accounts with Stripe Financial Connections: Stripe's own dialog collects the bank
// login; the server only ever sees the linked account ids and reads balances (read-only).
import { post } from "./api.js";
import type { Connection } from "./types.js";

interface StripeJs {
  collectFinancialConnectionsAccounts(opts: { clientSecret: string }): Promise<{
    financialConnectionsSession?: { id: string; accounts: Array<{ id: string }> };
    error?: { message?: string };
  }>;
}
type StripeFactory = (publishableKey: string) => StripeJs;

let loading: Promise<StripeFactory> | undefined;

/** Stripe.js must be loaded from js.stripe.com. */
function loadStripe(): Promise<StripeFactory> {
  const w = window as unknown as { Stripe?: StripeFactory };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => (w.Stripe ? resolve(w.Stripe) : reject(new Error("Stripe.js did not load")));
    s.onerror = () => {
      loading = undefined;
      reject(new Error("Could not load Stripe.js. Check your connection or ad blocker."));
    };
    document.head.append(s);
  });
  return loading;
}

/** Opens Stripe's bank dialog. Resolves with the new connections ([] when the user closed it). */
export async function linkBank(): Promise<Connection[]> {
  const [factory, session] = await Promise.all([
    loadStripe(),
    post<{ sessionId: string; clientSecret: string; publishableKey: string }>("/api/v1/connections/bank/session"),
  ]);
  const result = await factory(session.publishableKey).collectFinancialConnectionsAccounts({ clientSecret: session.clientSecret });
  if (result.error) throw new Error(result.error.message ?? "Stripe could not link the account");
  if (!result.financialConnectionsSession?.accounts.length) return [];
  return post<Connection[]>("/api/v1/connections/bank/complete", { sessionId: session.sessionId });
}
