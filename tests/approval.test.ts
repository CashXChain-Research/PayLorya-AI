import { describe, expect, it } from "vitest";
import { approvalAllowed, decisionRefusal } from "../src/approval.js";

describe("approval token", () => {
  it("is closed when no token is configured", () => {
    expect(approvalAllowed(undefined)).toBe(false);
    expect(approvalAllowed(undefined, "Bearer anything")).toBe(false);
    expect(approvalAllowed("", "Bearer ", "")).toBe(false);
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

describe("decision gate", () => {
  it("answers 503 while APPROVE_TOKEN is unset, whatever the request carries", () => {
    const disabled = { status: 503, error: "approvals disabled: APPROVE_TOKEN not configured" };
    expect(decisionRefusal(undefined)).toEqual(disabled);
    expect(decisionRefusal("", "Bearer ", "")).toEqual(disabled);
    expect(decisionRefusal(undefined, "Bearer anything", "anything")).toEqual(disabled);
  });

  it("answers 401 on a missing or wrong token and lets the right one through", () => {
    expect(decisionRefusal("s3cret-token")).toEqual({ status: 401, error: "approval token required" });
    expect(decisionRefusal("s3cret-token", "Bearer nope")).toMatchObject({ status: 401 });
    expect(decisionRefusal("s3cret-token", "Bearer s3cret-token")).toBeUndefined();
    expect(decisionRefusal("s3cret-token", undefined, "s3cret-token")).toBeUndefined();
  });
});
