import { describe, expect, it } from "vitest";
import { containerEnv, FORWARDED } from "../cloudflare/env.js";
import { ENV_KEYS } from "../src/config.js";

describe("cloudflare env forwarding", () => {
  it("forwards every config key except PORT", () => {
    const missing = ENV_KEYS.filter(key => key !== "PORT" && !(FORWARDED as readonly string[]).includes(key));
    expect(missing).toEqual([]);
  });

  it("forwards nothing unknown besides ANTHROPIC_BASE_URL", () => {
    const extra = FORWARDED.filter(key => !(ENV_KEYS as readonly string[]).includes(key));
    expect(extra).toEqual(["ANTHROPIC_BASE_URL"]);
  });

  it("sets PORT and drops empty values", () => {
    expect(containerEnv({ SELLER_ADDRESS: "addr_test1x", BUYER_MNEMONIC: "" })).toEqual({
      PORT: "8787",
      SELLER_ADDRESS: "addr_test1x",
    });
  });
});
