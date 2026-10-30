// Network-free milestone-1 checks, shared by scripts/preflight.ts, scripts/smoke-x402.ts and tests.
// Each rule mirrors the installed x402 SDK, so a PASS here means the SDK will accept the same input.
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Address, Assets, TxOut } from "@evolution-sdk/evolution";
import {
  DEFAULT_L1_CONFIRMATIONS,
  getCardanoNetworkId,
  LOVELACE_ASSET,
  minUtxoLovelace,
  normalizeConfirmationPolicy,
} from "@x402/cardano";
import { x402Version } from "@x402/core";
import type { Network, PaymentRequired, PaymentRequirements, SettleResponse, SupportedResponse } from "@x402/core/types";
import { z } from "zod";
import { CARDANO_NETWORK } from "../../src/config.js";

export type Status = "PASS" | "WARN" | "FAIL";

export interface Check {
  status: Status;
  name: string;
  detail: string;
  hint?: string;
}

export const pass = (name: string, detail: string): Check => ({ status: "PASS", name, detail });
export const warn = (name: string, detail: string, hint: string): Check => ({ status: "WARN", name, detail, hint });
export const fail = (name: string, detail: string, hint: string): Check => ({ status: "FAIL", name, detail, hint });

export const FAUCET_URL = "https://docs.cardano.org/cardano-testnets/tools/faucet/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

export function formatAda(lovelace: bigint): string {
  const frac = (lovelace % 1_000_000n).toString().padStart(6, "0");
  return `${lovelace / 1_000_000n}.${frac} tADA`;
}

/** Enough of a secret to tell which one is configured, never the whole value. */
export function maskSecret(value: string): string {
  return value.length <= 12 ? `*** (${value.length} chars)` : `${value.slice(0, 7)}... (${value.length} chars)`;
}

export function excerpt(text: string, limit = 200): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact === "") return "<empty body>";
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}...`;
}

/** Short reason for fetch and SDK errors; SDK provider errors keep the HTTP status in their `cause` chain. */
export function describeError(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "timed out";
  const code = error instanceof Error && isRecord(error.cause) ? error.cause.code : undefined;
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed";
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth++) {
    const { message } = current;
    if (typeof message === "string" && message !== "" && !parts.includes(message)) parts.push(message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join(" <- ") : String(error);
}

// --- config ------------------------------------------------------------------------------------

export function checkSpendPolicy(c: { price: bigint; maxPrice: bigint; budget: bigint }): Check {
  const name = "spend policy";
  if (c.price <= 0n) return fail(name, `PRICE_LOVELACE ${c.price} is not positive`, "set PRICE_LOVELACE, e.g. 2000000 (2 tADA)");
  if (c.price > c.maxPrice) {
    return fail(
      name,
      `PRICE_LOVELACE ${c.price} > MAX_PRICE_LOVELACE ${c.maxPrice}: the buyer policy (filterOffers) would refuse the seller's own offer`,
      "raise MAX_PRICE_LOVELACE or lower PRICE_LOVELACE",
    );
  }
  if (c.price > c.budget) {
    return fail(name, `PRICE_LOVELACE ${c.price} > SESSION_BUDGET_LOVELACE ${c.budget}`, "raise SESSION_BUDGET_LOVELACE");
  }
  return pass(name, `price ${formatAda(c.price)}, cap ${formatAda(c.maxPrice)}, session budget ${formatAda(c.budget)}`);
}

/** The l1Confirmations the seller will declare: same Number() parse as src/seller.ts, SDK range rules. */
export function parseL1Confirmations(
  raw: string | undefined,
): { ok: true; value: number; explicit: boolean } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: DEFAULT_L1_CONFIRMATIONS, explicit: false };
  const policy = normalizeConfirmationPolicy({ l1Confirmations: Number(raw) });
  if (!policy) return { ok: false, reason: `CARDANO_L1_CONFIRMATIONS=${raw} is not an integer from -1 to 20` };
  return { ok: true, value: policy.l1Confirmations, explicit: true };
}

export function checkL1Confirmations(raw: string | undefined, localFacilitator: boolean): Check {
  const name = "l1 confirmations";
  const l1 = parseL1Confirmations(raw);
  if (!l1.ok) return fail(name, l1.reason, "unset it (spec default 1) or use -1 (local facilitator only), 0, or 1..20");
  if (l1.value === -1 && !localFacilitator) {
    return warn(name, "-1 (mempool) needs a facilitator that advertises minimum -1", "use LOCAL_FACILITATOR=true or unset CARDANO_L1_CONFIRMATIONS");
  }
  return pass(name, `${l1.value}${l1.explicit ? "" : " (spec default)"}`);
}

// --- wallets and addresses ---------------------------------------------------------------------

// Same normalization as the @x402/cardano reference signer before it derives keys.
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
}

export function checkMnemonic(mnemonic: string): Check {
  const name = "buyer wallet";
  const normalized = normalizeMnemonic(mnemonic);
  const words = normalized === "" ? 0 : normalized.split(" ").length;
  if (!validateMnemonic(normalized, wordlist)) {
    return fail(
      name,
      `BUYER_MNEMONIC (${words} words) is not a valid English BIP39 phrase`,
      "check for typos or a truncated line, or regenerate with npm run wallet:new -- buyer",
    );
  }
  return pass(name, `${words}-word mnemonic is valid`);
}

export interface AddressInfo {
  networkId: number;
  base: boolean;
  script: boolean;
}

/** Parses payTo the way the reference client signer does (Address.fromBech32), plus canonical form. */
export function parseCardanoAddress(value: string): { ok: true; info: AddressInfo } | { ok: false; reason: string } {
  let parsed: Address.Address;
  try {
    parsed = Address.fromBech32(value);
  } catch (error) {
    const last = String(error instanceof Error ? error.message : error).split("\n").pop() ?? "";
    return { ok: false, reason: last.replace(/^[\s└─]+/, "") };
  }
  // The facilitator matches outputs to payTo by string equality on Address.toBech32.
  if (Address.toBech32(parsed) !== value) return { ok: false, reason: "not in canonical lowercase bech32 form" };
  return {
    ok: true,
    info: {
      networkId: parsed.networkId,
      base: parsed.stakingCredential !== undefined,
      script: parsed.paymentCredential._tag === "ScriptHash",
    },
  };
}

export function checkSellerAddress(seller: string, buyer: string | undefined): Check {
  const name = "seller address";
  const regen = "use the SELLER_ADDRESS line printed by npm run wallet:new -- seller";
  const parsed = parseCardanoAddress(seller);
  if (!parsed.ok) return fail(name, `SELLER_ADDRESS is not a valid Cardano address: ${parsed.reason}`, regen);
  const expectedId = getCardanoNetworkId(CARDANO_NETWORK);
  if (parsed.info.networkId !== expectedId) {
    return fail(name, `SELLER_ADDRESS has network id ${parsed.info.networkId}, ${CARDANO_NETWORK} needs ${expectedId} (addr_test1...)`, regen);
  }
  if (buyer !== undefined && seller === buyer) {
    return fail(name, "SELLER_ADDRESS equals the buyer address", "generate a separate seller wallet: npm run wallet:new -- seller");
  }
  const kind = `${parsed.info.base ? "base" : "enterprise"} address, network id ${parsed.info.networkId}`;
  if (parsed.info.script) {
    return warn(name, `${kind} with a script payment credential`, `a plain payment to a script without datum can be unspendable; ${regen}`);
  }
  return pass(name, `${kind}, key credential${buyer ? ", differs from buyer" : ""}`);
}

// --- Blockfrost, balance, min-UTxO -------------------------------------------------------------

export interface ProtocolParams {
  minFeeA: bigint;
  minFeeB: bigint;
  maxTxSize: bigint;
  coinsPerUtxoByte: bigint;
}

/** Blockfrost GET /epochs/latest/parameters; field names as in Evolution's BlockfrostProtocolParameters. */
export function parseProtocolParams(body: unknown): ProtocolParams | undefined {
  if (!isRecord(body)) return undefined;
  const minFeeA = toBigInt(body.min_fee_a);
  const minFeeB = toBigInt(body.min_fee_b);
  const maxTxSize = toBigInt(body.max_tx_size);
  const coinsPerUtxoByte = toBigInt(body.coins_per_utxo_size);
  if (minFeeA === undefined || minFeeB === undefined || maxTxSize === undefined || !coinsPerUtxoByte) return undefined;
  return { minFeeA, minFeeB, maxTxSize, coinsPerUtxoByte };
}

export function blockfrostHint(status: number, projectId: string): string {
  if (status === 401 || status === 403) {
    // Verified live 2026-10-30: preprod answers any rejected id with 403 "Invalid project token.", whatever its
    // prefix, so the prefix only suggests a cause.
    const net = /^(mainnet|preview)/.exec(projectId)?.[1];
    if (net) return `BLOCKFROST_PROJECT_ID was rejected; its prefix suggests a ${net} project: create a Preprod project at blockfrost.io and use its id`;
    return "BLOCKFROST_PROJECT_ID was rejected: it must be a valid Preprod project id (blockfrost.io dashboard)";
  }
  if (status === 402) return "Blockfrost daily request quota exceeded: wait for the reset or use another project";
  if (status === 404) return "check BLOCKFROST_PREPROD_URL, expected https://cardano-preprod.blockfrost.io/api/v0";
  if (status === 418) return "project auto-banned for exceeding rate limits: wait, then retry";
  if (status === 429) return "rate limited: wait a few seconds and re-run";
  if (status >= 500) return "Blockfrost-side error: retry in a minute";
  return "unexpected Blockfrost response";
}

/** Ledger min-UTxO for an ADA-only output, sized like the facilitator's verify: (160 + TxOut CBOR) * coinsPerUtxoByte. */
export function outputMinUtxo(address: string, lovelace: bigint, coinsPerUtxoByte: bigint): bigint {
  const output = new TxOut.TransactionOutput({ address: Address.fromBech32(address), assets: Assets.fromLovelace(lovelace) });
  return minUtxoLovelace(TxOut.toCBORBytes(output).length, coinsPerUtxoByte);
}

export function checkSellerMinUtxo(seller: string, price: bigint, coinsPerUtxoByte: bigint): Check {
  const name = "seller min-UTxO";
  const min = outputMinUtxo(seller, price, coinsPerUtxoByte);
  if (price < min) {
    return fail(
      name,
      `PRICE_LOVELACE ${formatAda(price)} is below the min-UTxO ${formatAda(min)} of the seller output; the ledger and facilitator reject it`,
      `set PRICE_LOVELACE >= ${min}`,
    );
  }
  return pass(name, `seller output ${formatAda(price)} >= min-UTxO ${formatAda(min)}`);
}

/** Used when protocol parameters are unavailable: covers a ~0.2 tADA fee plus a ~1 tADA change output. */
export const FALLBACK_HEADROOM_LOVELACE = 2_000_000n;

/**
 * Lovelace the buyer needs on top of the price. The fee of a script-free tx cannot exceed
 * minFeeA * maxTxSize + minFeeB, and the change output must itself clear min-UTxO.
 */
export function buyerHeadroom(buyerAddress: string, balance: bigint, params: ProtocolParams | undefined): bigint {
  if (!params) return FALLBACK_HEADROOM_LOVELACE;
  const maxFee = params.minFeeA * params.maxTxSize + params.minFeeB;
  return maxFee + outputMinUtxo(buyerAddress, balance, params.coinsPerUtxoByte);
}

export interface UtxoSummary {
  lovelace: bigint;
  count: number;
  withTokens: number;
}

/** Sums Blockfrost GET /addresses/{address}/utxos rows ({ amount: [{ unit, quantity }] }). */
export function summarizeUtxos(rows: unknown[]): UtxoSummary {
  const summary: UtxoSummary = { lovelace: 0n, count: 0, withTokens: 0 };
  for (const row of rows) {
    if (!isRecord(row) || !Array.isArray(row.amount)) continue;
    summary.count += 1;
    let tokens = false;
    for (const entry of row.amount) {
      if (!isRecord(entry)) continue;
      if (entry.unit === LOVELACE_ASSET) summary.lovelace += toBigInt(entry.quantity) ?? 0n;
      else tokens = true;
    }
    if (tokens) summary.withTokens += 1;
  }
  return summary;
}

/** `summary` null means Blockfrost answered 404: the address never appeared on chain. */
export function checkBuyerBalance(input: {
  buyerAddress: string;
  summary: UtxoSummary | null;
  price: bigint;
  headroom: bigint;
}): Check {
  const name = "buyer balance";
  const fund = `fund ${input.buyerAddress} with Preprod tADA at ${FAUCET_URL}, wait ~1 min, re-run`;
  if (input.summary === null) return fail(name, "buyer address was never funded (Blockfrost 404)", fund);
  const { lovelace, count, withTokens } = input.summary;
  if (count === 0) return fail(name, "buyer address has no UTxOs left", fund);
  const required = input.price + input.headroom;
  const detail = `${formatAda(lovelace)} in ${count} UTxO(s), need >= ${formatAda(required)} (price + ${formatAda(input.headroom)} fee/change headroom)`;
  if (lovelace < required) return fail(name, detail, fund);
  if (withTokens > 0) {
    return warn(name, `${detail}; ${withTokens} UTxO(s) also hold native tokens`, "tokens raise the change min-UTxO; move them out if the build fails");
  }
  return pass(name, detail);
}

// --- facilitator -------------------------------------------------------------------------------

// Mirrors supportedResponseSchema in @x402/core (not exported).
const SupportedResponseSchema = z.object({
  kinds: z.array(
    z.object({
      x402Version: z.number(),
      scheme: z.string(),
      network: z.custom<Network>(v => typeof v === "string"),
      extra: z
        .record(z.string(), z.unknown())
        .nullish()
        .transform(v => v ?? undefined),
    }),
  ),
  extensions: z.array(z.string()).default([]),
  signers: z.record(z.string(), z.array(z.string())).default({}),
});

export function parseSupportedResponse(body: unknown): SupportedResponse | undefined {
  const parsed = SupportedResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Same lookup as x402ResourceServer.getSupportedKind (@x402/core) and the same capability rules as
 * assertFacilitatorSupportsRequirements (@x402/cardano exact/server), which decide whether the seller can build its 402.
 */
export function checkSupportedKind(supported: SupportedResponse, l1Confirmations: number, localFacilitator: boolean): Check {
  const name = "facilitator";
  const fix = localFacilitator ? "check the server log and src/facilitator.ts" : "set LOCAL_FACILITATOR=true to verify and broadcast in-process";
  const kind = supported.kinds.find(k => k.x402Version === x402Version && k.scheme === "exact" && k.network === CARDANO_NETWORK);
  if (!kind) {
    const offered = supported.kinds.map(k => `v${k.x402Version} ${k.scheme}/${k.network}`).join(", ") || "none";
    return fail(name, `no x402 v${x402Version} exact/${CARDANO_NETWORK} kind (advertised: ${offered})`, fix);
  }
  const caps = kind.extra;
  if (caps === undefined) return pass(name, `exact/${CARDANO_NETWORK} supported (no capability block)`);
  const methods = caps.assetTransferMethods;
  if (!Array.isArray(methods) || !methods.includes("default")) {
    return fail(name, `assetTransferMethods ${JSON.stringify(methods)} lacks "default"`, fix);
  }
  const range = caps.l1Confirmations;
  if (!isRecord(range) || !Number.isInteger(range.minimum) || !Number.isInteger(range.maximum)) {
    return fail(name, "no valid l1Confirmations range advertised, so the seller cannot build its 402", fix);
  }
  const min = range.minimum as number;
  const max = range.maximum as number;
  if (l1Confirmations < min || l1Confirmations > max) {
    return fail(
      name,
      `l1Confirmations ${l1Confirmations} is outside the advertised range [${min}, ${max}]`,
      `set CARDANO_L1_CONFIRMATIONS between ${min} and ${max}, or ${localFacilitator ? "fix the local facilitator" : "LOCAL_FACILITATOR=true"}`,
    );
  }
  return pass(name, `exact/${CARDANO_NETWORK}, l1Confirmations ${l1Confirmations} within [${min}, ${max}]`);
}

// --- seller server and its 402 -----------------------------------------------------------------

/** Compares GET /health (src/server.ts) with this .env to catch a server started with other settings. */
export function checkHealth(
  body: unknown,
  expected: { sellerAddress: string | undefined; buyerAddress: string | undefined; facilitatorUrl: string; priceLovelace: string },
): Check {
  const name = "seller health";
  const restart = "restart npm run dev so the server picks up the current .env";
  if (!isRecord(body)) return fail(name, "/health did not return JSON", "check PUBLIC_BASE_URL / PORT point at this app");
  if (body.x402Ready !== true) {
    return fail(name, "server reports x402Ready=false (its env lacks SELLER_ADDRESS, BUYER_MNEMONIC or BLOCKFROST_PROJECT_ID)", restart);
  }
  const diffs: string[] = [];
  const compare = (field: string, actual: unknown, want: string | undefined) => {
    if (want !== undefined && actual !== want) diffs.push(`${field} ${String(actual)} != ${want}`);
  };
  compare("network", body.network, CARDANO_NETWORK);
  compare("sellerAddress", body.sellerAddress, expected.sellerAddress);
  compare("buyerAddress", body.buyerAddress, expected.buyerAddress);
  compare("facilitator", body.facilitator, expected.facilitatorUrl);
  compare("priceLovelace", body.priceLovelace, expected.priceLovelace);
  if (diffs.length > 0) return fail(name, `running server differs from .env: ${diffs.join("; ")}`, restart);
  return pass(name, `up, x402Ready, facilitator ${expected.facilitatorUrl}`);
}

export interface ExpectedOffer {
  payTo: string;
  amount: string;
  /** Effective value: CARDANO_L1_CONFIRMATIONS, or the spec default 1 when unset. */
  l1Confirmations: number;
}

/** Problems with one 402 accept compared to config; an empty list means it is safe to sign. */
export function offerProblems(offer: PaymentRequirements, expected: ExpectedOffer): string[] {
  const problems: string[] = [];
  if (offer.scheme !== "exact") problems.push(`scheme ${offer.scheme}, expected exact`);
  if (offer.network !== CARDANO_NETWORK) problems.push(`network ${offer.network}, expected ${CARDANO_NETWORK}`);
  if (offer.asset !== LOVELACE_ASSET) problems.push(`asset ${offer.asset}, expected ${LOVELACE_ASSET}`);
  if (offer.payTo !== expected.payTo) problems.push(`payTo ${offer.payTo} is not SELLER_ADDRESS ${expected.payTo}`);
  if (offer.amount !== expected.amount) problems.push(`amount ${offer.amount}, expected PRICE_LOVELACE ${expected.amount}`);
  if (!Number.isSafeInteger(offer.maxTimeoutSeconds) || offer.maxTimeoutSeconds <= 0) {
    problems.push(`maxTimeoutSeconds ${String(offer.maxTimeoutSeconds)} is not a positive integer`);
  }
  if (offer.extra !== undefined && !isRecord(offer.extra)) {
    problems.push("extra is not an object");
    return problems;
  }
  const extra = offer.extra ?? {};
  // Any other transfer method locks the funds in a contract instead of paying the seller.
  if (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "default") {
    problems.push(`assetTransferMethod ${String(extra.assetTransferMethod)}, expected a plain transfer`);
  }
  if (extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization") {
    problems.push(`paymentFlow ${String(extra.paymentFlow)}, expected authorization`);
  }
  const declared = normalizeConfirmationPolicy(extra.confirmationPolicy);
  if (!declared) problems.push(`invalid confirmationPolicy ${JSON.stringify(extra.confirmationPolicy)}`);
  else if (declared.l1Confirmations !== expected.l1Confirmations) {
    problems.push(`l1Confirmations ${declared.l1Confirmations}, expected ${expected.l1Confirmations} (CARDANO_L1_CONFIRMATIONS)`);
  }
  return problems;
}

/** Validates a decoded 402 (the header is JSON-decoded without a schema, so nothing is trusted). */
export function checkPaymentRequired(
  paymentRequired: PaymentRequired,
  expected: ExpectedOffer,
): { ok: true; offer: PaymentRequirements } | { ok: false; problems: string[] } {
  if (!isRecord(paymentRequired)) return { ok: false, problems: ["PAYMENT-REQUIRED is not an object"] };
  if (paymentRequired.x402Version !== x402Version) {
    return { ok: false, problems: [`x402Version ${String(paymentRequired.x402Version)}, expected ${x402Version}`] };
  }
  const accepts: unknown = paymentRequired.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return { ok: false, problems: ["the 402 offers no accepts"] };
  const problems: string[] = [];
  for (const [i, offer] of accepts.entries()) {
    const found = isRecord(offer) ? offerProblems(offer as PaymentRequirements, expected) : ["not an object"];
    if (found.length === 0) return { ok: true, offer: offer as PaymentRequirements };
    problems.push(...found.map(p => (accepts.length > 1 ? `accepts[${i}]: ${p}` : p)));
  }
  return { ok: false, problems };
}

export type PaidOutcome = "settled" | "not_settled" | "unknown";

/**
 * Classifies the paid response after the buyer signed. A verify rejection (402 + PAYMENT-REQUIRED) and a
 * handler error (4xx) happen before settle, so nothing was broadcast; anything else may already be on-chain.
 */
export function classifyPaidResponse(
  status: number,
  settle: SettleResponse | undefined,
  hasPaymentRequired: boolean,
): { outcome: PaidOutcome; reason: string } {
  if (settle) {
    if (settle.success && status === 200) return { outcome: "settled", reason: "settled" };
    if (settle.errorReason === "settlement_pending") {
      return { outcome: "unknown", reason: "settlement_pending: broadcast, but the required confirmations were not observed in time" };
    }
    return { outcome: "unknown", reason: `settle ${settle.success ? "succeeded" : "failed"} with HTTP ${status}: ${settle.errorReason ?? "no errorReason"}` };
  }
  if (status === 402 && hasPaymentRequired) return { outcome: "not_settled", reason: "rejected at verify, before settlement" };
  if (status >= 400 && status < 500 && status !== 402) {
    return { outcome: "not_settled", reason: `handler rejected the request (HTTP ${status}); settle does not run after a handler error` };
  }
  return { outcome: "unknown", reason: `HTTP ${status} without a PAYMENT-RESPONSE header` };
}
