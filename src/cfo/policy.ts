/**
 * Agent permission policy. Deterministic: nothing here comes from model output. Every payment,
 * whoever drafted it, gets a decision before anything can execute:
 * - auto: the agent may execute it on its own
 * - approval: a human must approve it in the dashboard
 * - blocked: nobody can execute it as it stands (no write access, unknown rail, ...)
 * Platform caps (PAYOUT_MAX_LOVELACE, demo ceilings, sandbox limits) apply on top, in the payout engine.
 */

export type Autonomy = "read_only" | "guarded" | "full";
export type Rail = "cardano_preprod" | "cashxchain" | "manual";

export interface AgentLimits {
  perPaymentUsdMinor: number;
  monthlyUsdMinor: number;
  knownPayeesOnly: boolean;
}

export interface PolicyCheck {
  id: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export interface PolicyDecision {
  decision: "auto" | "approval" | "blocked";
  checks: PolicyCheck[];
}

export interface PaymentFacts {
  requestedBy: "agent" | "user";
  rail: Rail;
  usdMinor: number;
  payeeKnown: boolean;
  /** Account details to pay to exist (from the saved payee, or carried by the draft). */
  hasAccount: boolean;
  /** The draft's account details differ from the saved payee's (the saved ones would be used). */
  accountMismatch?: boolean;
  /** A connection for this rail exists with read & write access. */
  railWritable: boolean;
  /** Payments the agent executed on its own this calendar month, USD cents. */
  agentExecutedThisMonthUsdMinor: number;
}

const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function decidePayment(autonomy: Autonomy, limits: AgentLimits, p: PaymentFacts): PolicyDecision {
  const checks: PolicyCheck[] = [];

  if (p.rail === "manual") {
    checks.push({ id: "rail", status: "fail", message: "No payment rail for this currency. Pay it outside the CFO." });
    return { decision: "blocked", checks };
  }
  checks.push({ id: "rail", status: "pass", message: p.rail === "cardano_preprod" ? "Cardano Preprod (testnet)" : "CashXChain (sandbox)" });

  if (!p.railWritable) {
    checks.push({ id: "access", status: "fail", message: "No connection with Read & write access for this rail" });
    return { decision: "blocked", checks };
  }
  checks.push({ id: "access", status: "pass", message: "Connection has Read & write access" });

  if (p.usdMinor <= 0) {
    checks.push({ id: "amount", status: "fail", message: "Amount must be positive" });
    return { decision: "blocked", checks };
  }

  // Drafting is always allowed; these checks only decide who may execute it.
  if (p.payeeKnown) {
    checks.push({ id: "payee", status: "pass", message: "Payee is saved in your payee directory" });
  } else {
    checks.push({
      id: "payee",
      status: "warn",
      message: limits.knownPayeesOnly
        ? "Payee is not saved: the agent may not pay it on its own (Known payees only)"
        : "Payee is not saved: pays to the account details in this draft",
    });
  }
  if (p.accountMismatch) {
    checks.push({ id: "account", status: "warn", message: "Account details differ from the saved payee: the saved account is used" });
  }
  if (!p.hasAccount) {
    checks.push({ id: "account", status: "fail", message: "No account details yet: save the payee or add its bank details or wallet" });
    return { decision: "approval", checks };
  }

  // A human-drafted payment is always confirmed by a human; the agent's autonomy is not involved.
  if (p.requestedBy === "user") {
    checks.push({ id: "autonomy", status: "pass", message: "A person confirms this payment" });
    return { decision: "approval", checks };
  }

  if (autonomy === "read_only") {
    checks.push({ id: "autonomy", status: "warn", message: "Agent is read-only: it can draft, you approve" });
    return { decision: "approval", checks };
  }

  let withinLimits = !p.accountMismatch;
  if (limits.knownPayeesOnly && !p.payeeKnown) withinLimits = false;

  if (autonomy === "guarded") {
    if (p.usdMinor > limits.perPaymentUsdMinor) {
      checks.push({ id: "per_payment", status: "warn", message: `${usd(p.usdMinor)} is above the ${usd(limits.perPaymentUsdMinor)} per-payment limit` });
      withinLimits = false;
    } else {
      checks.push({ id: "per_payment", status: "pass", message: `Within the ${usd(limits.perPaymentUsdMinor)} per-payment limit` });
    }
    const after = p.agentExecutedThisMonthUsdMinor + p.usdMinor;
    if (after > limits.monthlyUsdMinor) {
      checks.push({ id: "monthly", status: "warn", message: `Would bring this month to ${usd(after)}, above the ${usd(limits.monthlyUsdMinor)} monthly limit` });
      withinLimits = false;
    } else {
      checks.push({ id: "monthly", status: "pass", message: `${usd(after)} of ${usd(limits.monthlyUsdMinor)} monthly limit` });
    }
    checks.push({ id: "autonomy", status: withinLimits ? "pass" : "warn", message: withinLimits ? "Guarded: within your rules, the agent may execute" : "Guarded: outside your rules, needs your approval" });
    return { decision: withinLimits ? "auto" : "approval", checks };
  }

  // full
  checks.push({
    id: "autonomy",
    status: "warn",
    message: withinLimits ? "Full access: the agent executes without approval" : "Full access, but the payee rules require your approval",
  });
  return { decision: withinLimits ? "auto" : "approval", checks };
}
