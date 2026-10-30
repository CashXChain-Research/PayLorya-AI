// Read-only check of a running instance over its own HTTP endpoints: health, addresses, facilitator and the
// unpaid 402. Spends nothing and needs no secrets. One PASS / WARN / FAIL line per check; exits 1 on any FAIL.
//   npm run remote:check -- --url https://cxc-agentpay.<subdomain>.workers.dev
import { DEFAULT_L1_CONFIRMATIONS, getCardanoNetworkId, normalizeConfirmationPolicy } from "@x402/cardano";
import { x402Client, x402HTTPClient, type PaymentRequired } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import { CARDANO_NETWORK } from "../src/config.js";
import { READINESS_PATH } from "../src/seller.js";
import {
  blockfrostHint,
  buyerHeadroom,
  checkBuyerBalance,
  checkPaymentRequired,
  checkSellerAddress,
  checkSpendPolicy,
  checkSupportedKind,
  describeError,
  excerpt,
  fail,
  FALLBACK_HEADROOM_LOVELACE,
  formatAda,
  maskSecret,
  parseCardanoAddress,
  parseL1Confirmations,
  parseProtocolParams,
  parseSupportedResponse,
  pass,
  summarizeUtxos,
  warn,
  type Check,
  type ExpectedOffer,
  type UtxoSummary,
} from "./lib/milestone.js";
import { EXPLORER_HOME, formatCheck, getHealth, isMain, parseRemoteArgs, request, UsageError, type Fetched, type Health } from "./lib/remote.js";

const USAGE = "usage: npm run remote:check -- [--url <base>]   (default: PUBLIC_BASE_URL)";
const TIMEOUT_MS = 10_000;
// The first paid-route request makes the server fetch the facilitator's /supported, so allow longer.
const UNPAID_TIMEOUT_MS = 30_000;
const UTXO_PAGES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** l1Confirmations an accept declares (spec default when it declares none); undefined if invalid. */
function declaredL1(offer: unknown): number | undefined {
  if (!isRecord(offer)) return undefined;
  const extra = offer.extra ?? {};
  return isRecord(extra) ? normalizeConfirmationPolicy(extra.confirmationPolicy)?.l1Confirmations : undefined;
}

/**
 * The unpaid 402 against what /api/health reports. l1Confirmations is compared only when
 * CARDANO_L1_CONFIRMATIONS is set here; otherwise each accept is held to the value it declares.
 */
export function checkOffer(paymentRequired: PaymentRequired, want: { payTo: string; amount: string }, localL1: number | undefined): Check {
  const name = "402 offer";
  const expectFor = (offer: unknown): ExpectedOffer => ({ ...want, l1Confirmations: localL1 ?? declaredL1(offer) ?? DEFAULT_L1_CONFIRMATIONS });
  const accepts: unknown[] = isRecord(paymentRequired) && Array.isArray(paymentRequired.accepts) ? paymentRequired.accepts : [];
  // checkPaymentRequired holds all accepts to one expectation, so check them one at a time.
  const results =
    accepts.length > 0
      ? accepts.map(offer => checkPaymentRequired({ ...paymentRequired, accepts: [offer] } as PaymentRequired, expectFor(offer)))
      : [checkPaymentRequired(paymentRequired, expectFor(undefined))];
  const ok = results.find(r => r.ok);
  if (!ok?.ok) {
    const problems = results.flatMap((r, i) => (r.ok ? [] : r.problems.map(p => (accepts.length > 1 ? `accepts[${i}]: ${p}` : p))));
    return fail(
      name,
      `offer does not match /api/health${localL1 !== undefined ? " and local CARDANO_L1_CONFIRMATIONS" : ""}: ${[...new Set(problems)].join("; ")}`,
      "check the server's SELLER_ADDRESS, PRICE_LOVELACE and CARDANO_L1_CONFIRMATIONS (and the local one compared against); the agent refuses an offer its policy does not allow",
    );
  }
  const { offer } = ok;
  const extra = isRecord(offer.extra) ? offer.extra : {};
  const l1 = declaredL1(offer);
  const l1Note =
    (extra.confirmationPolicy === undefined ? " (not declared, spec default)" : "") +
    (localL1 !== undefined ? ", matches CARDANO_L1_CONFIRMATIONS" : ", not compared: CARDANO_L1_CONFIRMATIONS unset here");
  return pass(name, `402 ${offer.scheme} ${offer.network} ${offer.asset} ${formatAda(BigInt(offer.amount))} -> ${offer.payTo}, l1Confirmations ${l1}${l1Note}`);
}

/**
 * Where to fetch /supported from here. In local mode the facilitator lives under the server's own
 * PUBLIC_BASE_URL, which may not be the target (e.g. http://localhost:8787 inside the container).
 */
export function facilitatorProbe(baseUrl: string, advertised: string): { url: string; local: boolean; serverBase?: string } {
  const trimmed = advertised.replace(/\/+$/, "");
  const local = trimmed.endsWith("/facilitator");
  if (local && !trimmed.startsWith(`${baseUrl}/`)) {
    return { url: `${baseUrl}/facilitator/supported`, local, serverBase: trimmed.slice(0, -"/facilitator".length) };
  }
  return { url: `${trimmed}/supported`, local };
}

/** Optional: only when a Blockfrost key happens to be set locally. Same endpoints as preflight. */
async function checkBalanceViaBlockfrost(buyer: string, price: bigint, projectId: string, bfUrl: string): Promise<Check> {
  const name = "buyer balance";
  const base = bfUrl.replace(/\/+$/, "");
  const masked = maskSecret(projectId);
  const headers = { project_id: projectId };
  const get = async (path: string): Promise<Fetched | string> => {
    try {
      return await request(`${base}${path}`, { headers }, TIMEOUT_MS);
    } catch (error) {
      return describeError(error).replaceAll(projectId, masked);
    }
  };
  const paramsRes = await get("/epochs/latest/parameters");
  if (typeof paramsRes === "string") return fail(name, `Blockfrost unreachable: ${paramsRes}`, "retry, or unset BLOCKFROST_PROJECT_ID here to skip");
  if (paramsRes.status !== 200) return fail(name, `Blockfrost HTTP ${paramsRes.status} with project ${masked}`, blockfrostHint(paramsRes.status, projectId));
  const params = parseProtocolParams(paramsRes.json);
  const rows: unknown[] = [];
  let summary: UtxoSummary | null | undefined;
  for (let page = 1; page <= UTXO_PAGES && summary === undefined; page++) {
    const res = await get(`/addresses/${buyer}/utxos?page=${page}&count=100`);
    if (typeof res === "string") return fail(name, `Blockfrost unreachable: ${res}`, "retry");
    if (res.status === 404) summary = null;
    else if (res.status !== 200 || !Array.isArray(res.json)) return fail(name, `Blockfrost HTTP ${res.status}`, blockfrostHint(res.status, projectId));
    else {
      rows.push(...res.json);
      if (res.json.length < 100) summary = summarizeUtxos(rows);
    }
  }
  // More than UTXO_PAGES pages: what we summed is a lower bound, which is fine for "enough".
  const final = summary === undefined ? summarizeUtxos(rows) : summary;
  const headroom = buyerHeadroom(buyer, final?.lovelace ?? 0n, params);
  return checkBuyerBalance({ buyerAddress: buyer, summary: final, price, headroom });
}

function healthChecks(health: Health): Check[] {
  const checks: Check[] = [];
  checks.push(health.status === "ok" ? pass("health", "GET /api/health: status ok") : fail("health", `status ${health.status}`, "check the container logs"));
  checks.push(
    health.x402Ready
      ? pass("x402 ready", "server has SELLER_ADDRESS, BUYER_MNEMONIC and BLOCKFROST_PROJECT_ID")
      : fail("x402 ready", "x402Ready=false: the server lacks SELLER_ADDRESS, BUYER_MNEMONIC or BLOCKFROST_PROJECT_ID", "npx wrangler secret list, then redeploy so the container restarts"),
  );
  checks.push(
    health.aiReady
      ? pass("ai ready", "free-text invoices are extracted by Claude on the server")
      : warn("ai ready", "aiReady=false: free-text invoices (samples, injection scenario) fail; structured JSON invoices still work", "npx wrangler secret put ANTHROPIC_API_KEY, then redeploy"),
  );
  checks.push(
    health.network === CARDANO_NETWORK
      ? pass("network", CARDANO_NETWORK)
      : fail("network", `server reports ${health.network}, expected ${CARDANO_NETWORK}`, "this build only ever targets preprod: wrong deployment?"),
  );

  const price = BigInt(health.priceLovelace);
  const spent = BigInt(health.spentLovelace);
  if (health.maxPriceLovelace !== undefined && health.sessionBudgetLovelace !== undefined) {
    const budget = BigInt(health.sessionBudgetLovelace);
    const policy = checkSpendPolicy({ price, maxPrice: BigInt(health.maxPriceLovelace), budget });
    const left = budget > spent ? budget - spent : 0n;
    if (policy.status === "PASS" && left < price) {
      checks.push(
        warn(policy.name, `${policy.detail}; spent ${formatAda(spent)}, ${formatAda(left)} left: the next paid run is refused`, "the ledger resets when the container restarts, or raise SESSION_BUDGET_LOVELACE"),
      );
    } else {
      checks.push({ ...policy, detail: `${policy.detail}, spent ${formatAda(spent)}` });
    }
  } else if (price <= 0n) {
    checks.push(fail("price", `priceLovelace ${price} is not positive`, "set PRICE_LOVELACE on the server"));
  } else {
    checks.push(pass("price", `${formatAda(price)} per call, spent ${formatAda(spent)} so far (cap and budget not reported by this server)`));
  }

  const { sellerAddress: seller, buyerAddress: buyer } = health;
  if (!seller) checks.push(fail("seller address", "/api/health reports no sellerAddress", "set SELLER_ADDRESS on the server"));
  else {
    const check = checkSellerAddress(seller, buyer);
    checks.push({ ...check, detail: `${seller}: ${check.detail}` });
  }
  if (!buyer) {
    checks.push(fail("buyer address", "/api/health reports no buyerAddress (no buyer agent)", "the server needs BUYER_MNEMONIC; see x402 ready"));
  } else {
    const parsed = parseCardanoAddress(buyer);
    const expectedId = getCardanoNetworkId(CARDANO_NETWORK);
    checks.push(
      !parsed.ok
        ? fail("buyer address", `${buyer} is not a valid Cardano address: ${parsed.reason}`, "check BUYER_MNEMONIC on the server")
        : parsed.info.networkId !== expectedId
          ? fail("buyer address", `${buyer} has network id ${parsed.info.networkId}, expected ${expectedId}`, "check BUYER_MNEMONIC on the server")
          : pass("buyer address", `${buyer} (network id ${parsed.info.networkId})`),
    );
  }
  return checks;
}

export interface RemoteCheckOptions {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export async function remoteCheck(baseUrl: string, opts: RemoteCheckOptions = {}): Promise<Check[]> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const checks: Check[] = [];
  const report = (check: Check) => {
    checks.push(check);
    log(formatCheck(check));
  };
  log(`remote check of ${baseUrl} (read-only, spends nothing)\n`);

  // Only used to compare the offer; config.ts treats an empty value as unset, so do the same.
  const l1 = parseL1Confirmations(env.CARDANO_L1_CONFIRMATIONS?.trim() || undefined);
  if (!l1.ok) report(fail("l1 confirmations", `local ${l1.reason}`, "fix or unset CARDANO_L1_CONFIRMATIONS here; it is only used to compare the offer"));
  const localL1 = l1.ok && l1.explicit ? l1.value : undefined;

  let health: Health;
  try {
    health = await getHealth(baseUrl);
  } catch (error) {
    report(fail("health", error instanceof Error ? error.message : String(error), "is the deployment up? The first container start can take a minute: retry"));
    return checks;
  }
  for (const check of healthChecks(health)) report(check);

  const { buyerAddress: buyer, sellerAddress: seller } = health;
  const projectId = env.BLOCKFROST_PROJECT_ID?.trim();
  if (!buyer) report(warn("buyer balance", "skipped: no buyer address", "fix the FAIL above first"));
  else if (projectId) {
    const bfUrl = env.BLOCKFROST_PREPROD_URL?.trim() || "https://cardano-preprod.blockfrost.io/api/v0";
    report(await checkBalanceViaBlockfrost(buyer, BigInt(health.priceLovelace), projectId, bfUrl));
  } else {
    report(
      warn(
        "buyer balance",
        `not checked: needs a Blockfrost key, which lives only on the server`,
        `search ${buyer} on ${EXPLORER_HOME}; it needs about ${formatAda(BigInt(health.priceLovelace) + FALLBACK_HEADROOM_LOVELACE)} per paid run (price + fee/change headroom)`,
      ),
    );
  }

  // Fetch both, then report: the facilitator range check uses the l1Confirmations the offer declares.
  const probe = facilitatorProbe(baseUrl, health.facilitator);
  let supportedRes: Fetched | string;
  try {
    supportedRes = await request(probe.url, {}, TIMEOUT_MS);
  } catch (error) {
    supportedRes = describeError(error);
  }
  let unpaid: Fetched | string;
  try {
    unpaid = await request(
      `${baseUrl}${READINESS_PATH}`,
      { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `remote-check-${randomUUID()}` }, body: "{}" },
      UNPAID_TIMEOUT_MS,
    );
  } catch (error) {
    unpaid = describeError(error);
  }
  let paymentRequired: PaymentRequired | undefined;
  let decodeError: string | undefined;
  if (typeof unpaid !== "string" && unpaid.status === 402) {
    try {
      // Same SDK decoder the buyer uses (x402HTTPClient), as in scripts/smoke-x402.ts.
      const res = unpaid;
      paymentRequired = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(h => res.headers.get(h), res.json);
    } catch (error) {
      decodeError = describeError(error);
    }
  }
  const offerL1 = paymentRequired && isRecord(paymentRequired) && Array.isArray(paymentRequired.accepts) ? declaredL1(paymentRequired.accepts[0]) : undefined;

  if (probe.serverBase !== undefined) {
    report(
      warn(
        "public base",
        `server advertises its local facilitator under ${probe.serverBase}, not ${baseUrl}`,
        "its PUBLIC_BASE_URL differs from the target; set vars.PUBLIC_BASE_URL to the live URL (docs/DEPLOY.md) and redeploy",
      ),
    );
  }
  const facilitatorLabel = probe.local ? `local (${probe.url})` : health.facilitator;
  if (typeof supportedRes === "string") {
    report(
      fail(
        "facilitator",
        `${probe.url} unreachable (${supportedRes})`,
        probe.local ? "it is served by the app: check the container logs" : "the seller cannot build its 402 without it: consider LOCAL_FACILITATOR=true on the server",
      ),
    );
  } else if (supportedRes.status !== 200) {
    report(fail("facilitator", `GET ${probe.url} -> HTTP ${supportedRes.status}: ${excerpt(supportedRes.text)}`, "check FACILITATOR_URL / LOCAL_FACILITATOR on the server"));
  } else {
    const supported = parseSupportedResponse(supportedRes.json);
    if (!supported) {
      report(fail("facilitator", `${probe.url} did not return a SupportedResponse: ${excerpt(supportedRes.text)}`, "check FACILITATOR_URL on the server"));
    } else {
      const check = checkSupportedKind(supported, localL1 ?? offerL1 ?? DEFAULT_L1_CONFIRMATIONS, probe.local);
      report({ ...check, detail: `${facilitatorLabel}: ${check.detail}` });
    }
  }

  const name = "402 offer";
  if (typeof unpaid === "string") {
    report(fail(name, `unpaid POST ${READINESS_PATH} failed: ${unpaid}`, "the server may be stuck on the facilitator: see the facilitator check and the container logs"));
  } else if (unpaid.status !== 402) {
    const hints: Record<number, string> = {
      502: "the server cannot reach its facilitator: see the facilitator check",
      500: "the server could not build its 402 (unsupported facilitator kind or confirmation range): check the container logs",
      503: "the server has no SELLER_ADDRESS",
      404: "route not found: is the target this app?",
    };
    report(fail(name, `unpaid POST ${READINESS_PATH} -> HTTP ${unpaid.status}, expected 402: ${excerpt(unpaid.text)}`, hints[unpaid.status] ?? "the route is not payment-protected as expected"));
  } else if (!paymentRequired) {
    report(fail(name, `402 without a decodable PAYMENT-REQUIRED header: ${decodeError ?? "unknown"}`, "check the container logs"));
  } else if (!seller) {
    report(warn(name, "skipped: /api/health reports no sellerAddress to compare payTo with", "fix the FAIL above first"));
  } else {
    report(checkOffer(paymentRequired, { payTo: seller, amount: health.priceLovelace }, localL1));
  }
  return checks;
}

if (isMain(import.meta.url)) {
  try {
    const { baseUrl } = parseRemoteArgs(process.argv.slice(2), []);
    const checks = await remoteCheck(baseUrl);
    const count = (status: Check["status"]) => checks.filter(c => c.status === status).length;
    console.log(`\n${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail`);
    if (count("FAIL") > 0) {
      console.log("fix the FAIL lines, then re-run npm run remote:check");
      process.exitCode = 1;
    } else {
      console.log(`read-only checks passed. Next: npm run remote:run -- --url ${baseUrl} (dry run, then add --yes)`);
    }
  } catch (error) {
    console.error(error instanceof UsageError ? `${error.message}\n${USAGE}` : `\nFAILED: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  }
}
