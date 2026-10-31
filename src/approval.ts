import { timingSafeEqual } from "node:crypto";

/**
 * Operator token for approving or rejecting drafts. Fail-closed: unset means nobody may decide
 * (the server answers 503). Set: the request must carry `Authorization: Bearer <token>` or
 * `X-Approve-Token: <token>`.
 */
export function approvalAllowed(expected: string | undefined, authorization?: string, tokenHeader?: string): boolean {
  if (!expected) return false;
  const given = tokenHeader ?? /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type DecisionRefusal = { status: 401 | 503; error: string };

/** Gate for POST /api/runs/:id/approve|reject: 503 while no token is configured, 401 on a missing or wrong one. */
export function decisionRefusal(expected: string | undefined, authorization?: string, tokenHeader?: string): DecisionRefusal | undefined {
  if (!expected) return { status: 503, error: "approvals disabled: APPROVE_TOKEN not configured" };
  if (!approvalAllowed(expected, authorization, tokenHeader)) return { status: 401, error: "approval token required" };
  return undefined;
}
