import { createHash, randomBytes } from "node:crypto";

/** What a key may do. `read`: every GET. `write`: create and change records, and draft payments. */
export type Scope = "read" | "write";
export const SCOPES: readonly Scope[] = ["read", "write"];

/** A key as stored: never the key itself, only its SHA-256 and a recognisable prefix. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KEY_PATTERN = /^ply_sk_[0-9A-Za-z]{40}$/;

/** A new secret key: `ply_sk_` and 40 base62 characters (238 bits from the CSPRNG). */
export function newKey(): { key: string; hash: string; prefix: string } {
  let body = "";
  while (body.length < 40) {
    for (const b of randomBytes(48)) if (b < 248 && body.length < 40) body += ALPHABET[b % 62];
  }
  const key = `ply_sk_${body}`;
  return { key, hash: hashKey(key), prefix: `${key.slice(0, 11)}…${key.slice(-4)}` };
}

export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

/**
 * Routes a key can never call: they move money, sign, or manage credentials and the agent's own
 * rights. Those stay with a person signed in to the dashboard. Payees and budgets count as rights:
 * with full access the agent pays saved payees without asking, so a leaked key must not add one or
 * change its account details.
 */
const HUMAN_ONLY: Array<[string, RegExp]> = [
  ["POST", /^\/payments\/[^/]+\/(approve|reject|transaction|signature)$/],
  ["POST", /^\/me\/password$/],
  ["PATCH", /^\/workspace$/],
  ["*", /^\/connections(\/.*)?$/],
  ["*", /^\/api-keys(\/.*)?$/],
  ["*", /^\/webhooks?(\/.*)?$/],
  ["*", /^\/payees(\/.*)?$/],
  ["*", /^\/budgets(\/.*)?$/],
  ["POST", /^\/funding$/],
  ["POST", /^\/cashxchain\/link$/],
];

/** What a call with this key needs: undefined when allowed, else the refusal. */
export function keyRefusal(method: string, path: string, scopes: Scope[]): { status: number; code: string; error: string } | undefined {
  const human = HUMAN_ONLY.find(([m, re]) => (m === "*" ? method !== "GET" : m === method) && re.test(path));
  if (human) {
    return { status: 403, code: "human_only", error: "This action needs a person signed in to the PayLorya AI dashboard (approving, signing, credentials, payees, budgets, agent rights)." };
  }
  const needed: Scope = method === "GET" || method === "HEAD" ? "read" : "write";
  if (!scopes.includes(needed)) return { status: 403, code: "insufficient_scope", error: `This key lacks the "${needed}" scope.` };
  return undefined;
}

/** Requests per key and minute; a burst up to the same number. */
export const RATE_PER_MINUTE = 120;

/** Token bucket per key, in memory (one container). */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly perMinute = RATE_PER_MINUTE) {}

  /** Seconds to wait, or 0 when the request may go ahead. */
  take(id: string, now = Date.now()): number {
    const b = this.buckets.get(id) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.set(id, b);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) / this.perMinute) * 60);
    b.tokens -= 1;
    return 0;
  }
}
