import { describe, expect, it } from "vitest";
import { authOptions, containerEnv, envFingerprint, FORWARDED } from "../cloudflare/env.js";
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

  it("answers /api/auth-options like the server", () => {
    expect(authOptions({})).toEqual({ codes: false });
    expect(authOptions({ RESEND_API_KEY: "re_x" })).toEqual({ codes: true });
    expect(
      authOptions({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", PUBLIC_BASE_URL: "https://paylorya.valentin.is/" }),
    ).toEqual({ codes: false, google: { origin: "https://paylorya.valentin.is" } });
    expect(authOptions({ GOOGLE_CLIENT_ID: "id", PUBLIC_BASE_URL: "https://x.test" })).toEqual({ codes: false });
  });

  it("fingerprints the env independent of key order, and changes with any value", () => {
    expect(envFingerprint({ A: "1", B: "2" })).toBe(envFingerprint({ B: "2", A: "1" }));
    expect(envFingerprint({ A: "1", B: "2" })).not.toBe(envFingerprint({ A: "1", B: "3" }));
    expect(envFingerprint({ A: "1" })).not.toBe(envFingerprint({ A: "1", STRIPE_SECRET_KEY: "sk_test_x" }));
  });
});
