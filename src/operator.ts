import { createHash, timingSafeEqual } from "node:crypto";

export type OperatorCheck = "ok" | "unconfigured" | "denied";

/**
 * Approve/reject move money, so they need the operator token as `Authorization: Bearer <token>`.
 * Without a configured token they stay closed. Hashing first gives timingSafeEqual equal lengths.
 */
export function checkOperator(authorization: string | undefined, token: string | undefined): OperatorCheck {
  if (!token) return "unconfigured";
  const presented = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!presented) return "denied";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(presented), digest(token)) ? "ok" : "denied";
}
