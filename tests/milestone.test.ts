import { describe, expect, it } from "vitest";
import { masumiEscrowAddress, toClientCardanoSigner, toFacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme as FacilitatorScheme } from "@x402/cardano/exact/facilitator";
import { ExactCardanoScheme as ServerScheme } from "@x402/cardano/exact/server";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentRequirements, SettleResponse, SupportedResponse } from "@x402/core/types";
import {
  buyerHeadroom,
  checkBuyerBalance,
  checkHealth,
  checkL1Confirmations,
  checkMnemonic,
  checkPaymentRequired,
  checkSellerAddress,
  checkSellerMinUtxo,
  checkSpendPolicy,
  blockfrostHint,
  checkSupportedKind,
  classifyPaidResponse,
  describeError,
  FALLBACK_HEADROOM_LOVELACE,
  maskSecret,
  outputMinUtxo,
  parseL1Confirmations,
  parseProtocolParams,
  parseSupportedResponse,
  summarizeUtxos,
  type ExpectedOffer,
} from "../scripts/lib/milestone.js";

// BIP39 test vectors (all-zero entropy). Test-only, never funded.
const MNEMONIC_24 = `${"abandon ".repeat(23)}art`;
const MNEMONIC_12 = `${"abandon ".repeat(11)}about`;
const provider = { blockfrost: { baseUrl: "http://127.0.0.1:9", projectId: "unused" } };
const addressOf = (mnemonic: string, network = "cardano:preprod") =>
  toClientCardanoSigner({ mnemonic, network, provider }).getAddress();
const BUYER = addressOf(MNEMONIC_24);
const SELLER = addressOf(MNEMONIC_12);

// A real facilitator and resource server, wired in-process exactly like src/facilitator.ts and src/seller.ts.
function localFacilitator(acceptMempool = false): x402Facilitator {
  const signer = toFacilitatorCardanoSigner({ network: "cardano:preprod", provider, awaitConfirmation: false });
  return new x402Facilitator().register("cardano:preprod", new FacilitatorScheme(signer, { acceptMempool }));
}

async function sdkPaymentRequired(extra?: Record<string, unknown>): Promise<PaymentRequired> {
  const facilitator = localFacilitator();
  const client: FacilitatorClient = {
    verify: (p, r) => facilitator.verify(p, r),
    settle: (p, r) => facilitator.settle(p, r),
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  };
  const server = new x402ResourceServer(client).register("cardano:preprod", new ServerScheme());
  await server.initialize();
  const reqs = await server.buildPaymentRequirements({
    scheme: "exact",
    network: "cardano:preprod",
    payTo: SELLER,
    price: { amount: "2000000", asset: "lovelace" },
    ...(extra ? { extra } : {}),
  });
  const pr = await server.createPaymentRequiredResponse(reqs, { url: "http://localhost:8787/v1/payment-readiness" });
  // Round-trip through the header and the buyer-side decoder, as the smoke script does.
  const header = encodePaymentRequiredHeader(pr);
  return new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(name => (name === "PAYMENT-REQUIRED" ? header : null));
}

const expected: ExpectedOffer = { payTo: SELLER, amount: "2000000", l1Confirmations: 1 };

describe("402 offer validation", () => {
  it("accepts the offer the SDK builds from the seller route config", async () => {
    const result = await sdkPaymentRequired();
    expect(result.accepts).toHaveLength(1);
    expect(checkPaymentRequired(result, expected)).toMatchObject({ ok: true, offer: { payTo: SELLER, amount: "2000000" } });
  });

  it("matches an explicit confirmation policy and rejects a drifted one", async () => {
    const zero = await sdkPaymentRequired({ confirmationPolicy: { l1Confirmations: 0 } });
    expect(checkPaymentRequired(zero, { ...expected, l1Confirmations: 0 }).ok).toBe(true);
    const drifted = checkPaymentRequired(zero, expected);
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) expect(drifted.problems.join()).toContain("l1Confirmations 0, expected 1");
  });

  it("rejects offers that differ from config", async () => {
    const base = await sdkPaymentRequired();
    const offer = base.accepts[0]!;
    const tamper = (o: Partial<PaymentRequirements>): PaymentRequired => ({ ...base, accepts: [{ ...offer, ...o }] });
    const problems = (pr: PaymentRequired) => {
      const r = checkPaymentRequired(pr, expected);
      return r.ok ? [] : r.problems;
    };
    expect(problems(tamper({ payTo: BUYER }))[0]).toContain("is not SELLER_ADDRESS");
    expect(problems(tamper({ amount: "2000001" }))[0]).toContain("expected PRICE_LOVELACE 2000000");
    expect(problems(tamper({ network: "cardano:mainnet" }))[0]).toContain("expected cardano:preprod");
    expect(problems(tamper({ asset: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d" }))).toHaveLength(1);
    expect(problems(tamper({ scheme: "upto" }))).toHaveLength(1);
    expect(problems(tamper({ extra: { assetTransferMethod: "script" } }))[0]).toContain("assetTransferMethod script");
    expect(problems(tamper({ maxTimeoutSeconds: 0 }))[0]).toContain("maxTimeoutSeconds");
    expect(problems({ ...base, x402Version: 1 })[0]).toContain("x402Version 1");
    expect(problems({ ...base, accepts: [] })).toEqual(["the 402 offers no accepts"]);
  });

  it("picks the matching accept when the server offers several", async () => {
    const base = await sdkPaymentRequired();
    const good = base.accepts[0]!;
    const result = checkPaymentRequired({ ...base, accepts: [{ ...good, payTo: BUYER }, good] }, expected);
    expect(result).toMatchObject({ ok: true, offer: { payTo: SELLER } });
  });
});

describe("facilitator /supported", () => {
  it("accepts what the real Cardano facilitator advertises for the spec default", () => {
    const supported = parseSupportedResponse(JSON.parse(JSON.stringify(localFacilitator().getSupported())));
    expect(supported).toBeDefined();
    expect(checkSupportedKind(supported!, 1, false).status).toBe("PASS");
    expect(checkSupportedKind(supported!, 20, false).status).toBe("PASS");
  });

  it("accepts the hosted preprod facilitator's live /supported (2026-10-30)", () => {
    const live = {
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: "cardano:preprod",
          extra: { assetTransferMethods: ["default", "masumi", "script"], areFeesSponsored: false, l1Confirmations: { minimum: 0, maximum: 20 } },
        },
      ],
      extensions: [],
      signers: { "cardano:*": [] },
    };
    const supported = parseSupportedResponse(live);
    expect(supported).toBeDefined();
    expect(checkSupportedKind(supported!, 1, false).status).toBe("PASS");
    expect(checkSupportedKind(supported!, 0, false).status).toBe("PASS");
    expect(checkSupportedKind(supported!, -1, false)).toMatchObject({ status: "FAIL", detail: expect.stringContaining("[0, 20]") });
  });

  it("checks l1Confirmations against the advertised range", () => {
    const strict = parseSupportedResponse(localFacilitator(false).getSupported())!;
    const mempool = parseSupportedResponse(localFacilitator(true).getSupported())!;
    expect(checkSupportedKind(strict, -1, true)).toMatchObject({ status: "FAIL", detail: expect.stringContaining("[0, 20]") });
    expect(checkSupportedKind(mempool, -1, true).status).toBe("PASS");
    expect(checkSupportedKind(strict, 21, false).status).toBe("FAIL");
  });

  it("fails when the kind, methods or range are missing", () => {
    const kind = { x402Version: 2, scheme: "exact", network: "cardano:preprod" as const };
    const of = (extra?: Record<string, unknown>): SupportedResponse => ({ kinds: [{ ...kind, extra }], extensions: [], signers: {} });
    expect(checkSupportedKind({ kinds: [{ ...kind, network: "cardano:preview" }], extensions: [], signers: {} }, 1, false)).toMatchObject({
      status: "FAIL",
      hint: expect.stringContaining("LOCAL_FACILITATOR=true"),
    });
    expect(checkSupportedKind({ kinds: [{ ...kind, x402Version: 1 }], extensions: [], signers: {} }, 1, false).status).toBe("FAIL");
    expect(checkSupportedKind(of(), 1, false).status).toBe("PASS");
    expect(checkSupportedKind(of({ assetTransferMethods: ["masumi"], l1Confirmations: { minimum: 0, maximum: 20 } }), 1, false).status).toBe("FAIL");
    expect(checkSupportedKind(of({ assetTransferMethods: ["default"] }), 1, false).status).toBe("FAIL");
  });

  it("parses like the SDK schema and rejects junk", () => {
    expect(parseSupportedResponse({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod", extra: null }] })).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod", extra: undefined }],
      extensions: [],
      signers: {},
    });
    expect(parseSupportedResponse("<html>")).toBeUndefined();
    expect(parseSupportedResponse({ kinds: [{ scheme: "exact" }] })).toBeUndefined();
  });
});

describe("blockfrostHint", () => {
  it("does not claim a network mismatch as fact: live preprod returns the same 403 for any rejected id", () => {
    expect(blockfrostHint(403, "mainnetINVALID")).toMatch(/^BLOCKFROST_PROJECT_ID was rejected; its prefix suggests a mainnet project/);
    expect(blockfrostHint(403, "preprodINVALID")).toMatch(/^BLOCKFROST_PROJECT_ID was rejected/);
    expect(blockfrostHint(402, "preprodX")).toContain("quota");
  });
});

describe("addresses and wallets", () => {
  it("accepts a preprod key address that differs from the buyer", () => {
    expect(checkSellerAddress(SELLER, BUYER)).toMatchObject({ status: "PASS", detail: expect.stringContaining("base address, network id 0") });
  });

  it("rejects mainnet, malformed, non-canonical and buyer-equal addresses", () => {
    expect(checkSellerAddress(addressOf(MNEMONIC_12, "cardano:mainnet"), BUYER)).toMatchObject({ status: "FAIL", detail: expect.stringContaining("network id 1") });
    expect(checkSellerAddress(`${SELLER.slice(0, -1)}${SELLER.endsWith("q") ? "p" : "q"}`, BUYER).status).toBe("FAIL");
    expect(checkSellerAddress(SELLER.toUpperCase(), BUYER).status).toBe("FAIL");
    expect(checkSellerAddress("stake_test1uqfu74w3wh4gfzu8m6e7j987h4lq9r3t7ef5gaw497uu85qsqfy27", BUYER).status).toBe("FAIL");
    expect(checkSellerAddress(BUYER, BUYER)).toMatchObject({ status: "FAIL", detail: "SELLER_ADDRESS equals the buyer address" });
  });

  it("warns on a script address", () => {
    expect(checkSellerAddress(masumiEscrowAddress("cardano:preprod"), BUYER).status).toBe("WARN");
  });

  it("validates the mnemonic like the signer normalizes it", () => {
    expect(checkMnemonic(MNEMONIC_24).status).toBe("PASS");
    expect(checkMnemonic(`  ${MNEMONIC_24.toUpperCase().replaceAll(" ", "   ")}\n`).status).toBe("PASS");
    const bad = checkMnemonic(MNEMONIC_24.replace(/art$/, "abandon"));
    expect(bad.status).toBe("FAIL");
    expect(JSON.stringify(bad)).not.toContain("abandon");
  });
});

describe("balance and min-UTxO", () => {
  // Shaped like Blockfrost GET /addresses/{address}/utxos rows.
  const row = (lovelace: string, extra: Array<{ unit: string; quantity: string }> = []) => ({
    address: BUYER,
    tx_hash: "a".repeat(64),
    tx_index: 0,
    output_index: 0,
    amount: [{ unit: "lovelace", quantity: lovelace }, ...extra],
    block: "b".repeat(64),
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null,
  });
  // Shaped like Blockfrost GET /epochs/latest/parameters (subset; Blockfrost mixes numbers and strings).
  const params = parseProtocolParams({ min_fee_a: 44, min_fee_b: 155381, max_tx_size: 16384, coins_per_utxo_size: "4310", key_deposit: "2000000" })!;

  it("parses protocol parameters and computes min-UTxO like the facilitator", () => {
    expect(params).toEqual({ minFeeA: 44n, minFeeB: 155381n, maxTxSize: 16384n, coinsPerUtxoByte: 4310n });
    expect(parseProtocolParams({ min_fee_a: 44 })).toBeUndefined();
    // (160 overhead + 65-byte base-address ADA-only TxOut) * 4310
    expect(outputMinUtxo(SELLER, 2_000_000n, 4310n)).toBe(969_750n);
    expect(checkSellerMinUtxo(SELLER, 2_000_000n, 4310n).status).toBe("PASS");
    expect(checkSellerMinUtxo(SELLER, 900_000n, 4310n)).toMatchObject({ status: "FAIL", hint: "set PRICE_LOVELACE >= 969750" });
  });

  it("derives fee + change headroom, with a fixed fallback", () => {
    const headroom = buyerHeadroom(BUYER, 10_000_000_000n, params);
    // max fee 44 * 16384 + 155381 = 876277, change min-UTxO (160 + 69) * 4310 = 986990
    expect(headroom).toBe(876_277n + 986_990n);
    expect(buyerHeadroom(BUYER, 0n, undefined)).toBe(FALLBACK_HEADROOM_LOVELACE);
  });

  it("sums UTxOs and flags native tokens", () => {
    const summary = summarizeUtxos([row("5000000"), row("1500000", [{ unit: `${"c".repeat(56)}74555344`, quantity: "7" }]), "junk"]);
    expect(summary).toEqual({ lovelace: 6_500_000n, count: 2, withTokens: 1 });
  });

  it("fails an unfunded or short wallet with the faucet hint", () => {
    const input = { buyerAddress: BUYER, price: 2_000_000n, headroom: 2_000_000n };
    expect(checkBuyerBalance({ ...input, summary: null })).toMatchObject({
      status: "FAIL",
      hint: expect.stringContaining("https://docs.cardano.org/cardano-testnets/tools/faucet/"),
    });
    expect(checkBuyerBalance({ ...input, summary: summarizeUtxos([]) }).status).toBe("FAIL");
    expect(checkBuyerBalance({ ...input, summary: summarizeUtxos([row("3999999")]) }).status).toBe("FAIL");
    expect(checkBuyerBalance({ ...input, summary: summarizeUtxos([row("4000000")]) }).status).toBe("PASS");
    expect(checkBuyerBalance({ ...input, summary: summarizeUtxos([row("9000000", [{ unit: "d".repeat(56), quantity: "1" }])]) }).status).toBe("WARN");
  });
});

describe("config checks", () => {
  it("parses CARDANO_L1_CONFIRMATIONS like src/seller.ts", () => {
    expect(parseL1Confirmations(undefined)).toEqual({ ok: true, value: 1, explicit: false });
    expect(parseL1Confirmations("0")).toEqual({ ok: true, value: 0, explicit: true });
    for (const bad of ["abc", "1.5", "21", "-2"]) expect(parseL1Confirmations(bad).ok).toBe(false);
    expect(checkL1Confirmations("-1", false).status).toBe("WARN");
    expect(checkL1Confirmations("-1", true).status).toBe("PASS");
  });

  it("fails a price the buyer policy would refuse", () => {
    expect(checkSpendPolicy({ price: 2_000_000n, maxPrice: 3_000_000n, budget: 20_000_000n }).status).toBe("PASS");
    expect(checkSpendPolicy({ price: 4_000_000n, maxPrice: 3_000_000n, budget: 20_000_000n }).detail).toContain("filterOffers");
    expect(checkSpendPolicy({ price: 0n, maxPrice: 3_000_000n, budget: 20_000_000n }).status).toBe("FAIL");
  });

  it("detects a running server with a different config", () => {
    // Shaped like GET /health in src/server.ts.
    const health = {
      status: "ok",
      network: "cardano:preprod",
      x402Ready: true,
      aiReady: false,
      facilitator: "https://x402.preprod.dev.ecosyseng.cf-deployments.org",
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      priceLovelace: "2000000",
      spentLovelace: "0",
    };
    const want = { sellerAddress: SELLER, buyerAddress: BUYER, facilitatorUrl: health.facilitator, priceLovelace: "2000000" };
    expect(checkHealth(health, want).status).toBe("PASS");
    expect(checkHealth(health, { ...want, facilitatorUrl: "http://localhost:8787/facilitator" }).detail).toContain("facilitator");
    expect(checkHealth({ ...health, x402Ready: false }, want).status).toBe("FAIL");
  });
});

describe("paid response classification", () => {
  const tx = "f".repeat(64);
  const settled: SettleResponse = { success: true, transaction: tx, network: "cardano:preprod", payer: BUYER };
  // Shape from @x402/cardano README "Settlement and settlement_pending".
  const pending: SettleResponse = {
    success: false,
    errorReason: "settlement_pending",
    transaction: tx,
    network: "cardano:preprod",
    extra: { status: "pending", transactionId: tx, confirmations: 0 },
  };

  it("only a 200 with a successful settle counts as paid", () => {
    expect(classifyPaidResponse(200, settled, false).outcome).toBe("settled");
    expect(classifyPaidResponse(200, undefined, false).outcome).toBe("unknown");
  });

  it("treats every post-broadcast failure as unknown", () => {
    expect(classifyPaidResponse(402, pending, false)).toMatchObject({ outcome: "unknown", reason: expect.stringContaining("settlement_pending") });
    expect(classifyPaidResponse(402, { ...pending, errorReason: "exact_cardano_settlement_failed" }, false).outcome).toBe("unknown");
    expect(classifyPaidResponse(502, undefined, false).outcome).toBe("unknown");
    expect(classifyPaidResponse(402, undefined, false).outcome).toBe("unknown");
  });

  it("recognizes rejections that happen before settlement", () => {
    expect(classifyPaidResponse(402, undefined, true).outcome).toBe("not_settled");
    expect(classifyPaidResponse(422, undefined, false).outcome).toBe("not_settled");
  });
});

describe("output hygiene", () => {
  it("masks secrets", () => {
    const id = "preprodAbCdEfGhIjKlMnOpQrStUvWxYz012";
    expect(maskSecret(id)).toBe("preprod... (36 chars)");
    expect(maskSecret("short")).toBe("*** (5 chars)");
  });

  it("describes fetch failures and SDK cause chains", () => {
    expect(describeError(new DOMException("aborted", "TimeoutError"))).toBe("timed out");
    expect(describeError(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }))).toBe("connection refused");
    // Shape of the Evolution provider error for a rejected Blockfrost key.
    const providerError = new Error("Blockfrost getUtxos failed", {
      cause: { _tag: "HttpResponseError", status: 403, message: 'non 2xx status code : {"status_code":403,"error":"Forbidden"}' },
    });
    expect(describeError(providerError)).toBe('Blockfrost getUtxos failed <- non 2xx status code : {"status_code":403,"error":"Forbidden"}');
  });
});
