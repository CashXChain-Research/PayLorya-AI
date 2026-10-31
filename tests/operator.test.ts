import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { checkOperator } from "../src/operator.js";

const TOKEN = "3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f21";

describe("operator token on approve/reject", () => {
  it("accepts only the configured token as a bearer credential", () => {
    expect(checkOperator(`Bearer ${TOKEN}`, TOKEN)).toBe("ok");
    expect(checkOperator(`Bearer ${TOKEN}x`, TOKEN)).toBe("denied");
    expect(checkOperator(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN)).toBe("denied");
    expect(checkOperator(TOKEN, TOKEN)).toBe("denied"); // no scheme
    expect(checkOperator(`Basic ${TOKEN}`, TOKEN)).toBe("denied");
    expect(checkOperator("Bearer ", TOKEN)).toBe("denied");
    expect(checkOperator(undefined, TOKEN)).toBe("denied");
  });

  it("stays closed when no token is configured, whatever the caller sends", () => {
    expect(checkOperator(`Bearer ${TOKEN}`, undefined)).toBe("unconfigured");
    expect(checkOperator(undefined, undefined)).toBe("unconfigured");
    expect(checkOperator("Bearer anything", "")).toBe("unconfigured");
  });

  it("config refuses short tokens and treats an empty value as unset", () => {
    expect(loadConfig({ OPERATOR_TOKEN: TOKEN }).OPERATOR_TOKEN).toBe(TOKEN);
    expect(loadConfig({ OPERATOR_TOKEN: "" }).OPERATOR_TOKEN).toBeUndefined();
    expect(() => loadConfig({ OPERATOR_TOKEN: "short-token" })).toThrow(/at least 24 characters/);
  });
});
