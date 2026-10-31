import { describe, expect, it } from "vitest";
import { approvalAllowed } from "../src/approval.js";

describe("approval token", () => {
  it("is open when no token is configured", () => {
    expect(approvalAllowed(undefined)).toBe(true);
    expect(approvalAllowed("", "Bearer anything")).toBe(true);
  });

  it("accepts the token as a Bearer header or X-Approve-Token", () => {
    expect(approvalAllowed("s3cret-token", "Bearer s3cret-token")).toBe(true);
    expect(approvalAllowed("s3cret-token", "bearer   s3cret-token")).toBe(true);
    expect(approvalAllowed("s3cret-token", undefined, "s3cret-token")).toBe(true);
  });

  it("refuses a missing, wrong, prefixed or differently sized token", () => {
    expect(approvalAllowed("s3cret-token")).toBe(false);
    expect(approvalAllowed("s3cret-token", "Bearer wrong-token!")).toBe(false);
    expect(approvalAllowed("s3cret-token", "Bearer s3cret")).toBe(false);
    expect(approvalAllowed("s3cret-token", "s3cret-token")).toBe(false); // no Bearer scheme
    expect(approvalAllowed("s3cret-token", undefined, "s3cret-token-and-more")).toBe(false);
  });
});
