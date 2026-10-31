import { timingSafeEqual } from "node:crypto";

/**
 * Operator token for approving or rejecting drafts. Unset: open (demo default). Set: the request
 * must carry `Authorization: Bearer <token>` or `X-Approve-Token: <token>`.
 */
export function approvalAllowed(expected: string | undefined, authorization?: string, tokenHeader?: string): boolean {
  if (!expected) return true;
  const given = tokenHeader ?? /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
