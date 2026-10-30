// Milestone-1 preflight: env, wallets, Blockfrost, facilitator and the running seller, checked before
// a real payment. One PASS / WARN / FAIL line per check; exits 1 on any FAIL. Never prints secrets.
import { toClientCardanoSigner } from "@x402/cardano";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { CARDANO_NETWORK, loadConfig, type Config } from "../src/config.js";
import { READINESS_PATH } from "../src/seller.js";
import {
  blockfrostHint,
  buyerHeadroom,
  checkBuyerBalance,
  checkHealth,
  checkL1Confirmations,
  checkMnemonic,
  checkPaymentRequired,
  checkSellerAddress,
  checkSellerMinUtxo,
  checkSpendPolicy,
  checkSupportedKind,
  describeError,
  excerpt,
  fail,
  formatAda,
  maskSecret,
  parseL1Confirmations,
  parseProtocolParams,
  parseSupportedResponse,
  pass,
  summarizeUtxos,
  warn,
  type Check,
  type ProtocolParams,
  type UtxoSummary,
} from "./lib/milestone.js";

const TIMEOUT_MS = 10_000;
// The first paid-route request makes the server fetch the facilitator's /supported, so allow longer.
const UNPAID_TIMEOUT_MS = 30_000;
const UTXO_PAGES = 10;

const checks: Check[] = [];

function report(check: Check): void {
  checks.push(check);
  const hint = check.hint ? `  -> ${check.hint}` : "";
  console.log(`${check.status}  ${check.name.padEnd(17)}${check.detail}${hint}`);
}

const skip = (name: string, needs: string): Check => warn(name, `skipped: needs ${needs}`, "fix the FAIL above first");

type Fetched = { status: number; headers: Headers; text: string; json: unknown } | { error: string };

async function request(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Fetched> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, text, json };
  } catch (error) {
    return { error: describeError(error) };
  }
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    const detail =
      error instanceof z.ZodError ? error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") : String(error);
    report(fail("config", detail, "fix these .env values (see .env.example)"));
    return;
  }
  console.log(`preflight for ${CARDANO_NETWORK}, app at ${config.baseUrl}\n`);

  // env
  const projectId = config.BLOCKFROST_PROJECT_ID;
  const fixes = {
    SELLER_ADDRESS: "npm run wallet:new -- seller",
    BUYER_MNEMONIC: "npm run wallet:new -- buyer",
    BLOCKFROST_PROJECT_ID: "create a free Preprod project at blockfrost.io",
  };
  const missing = (Object.keys(fixes) as (keyof typeof fixes)[]).filter(k => !config[k]);
  if (missing.length > 0) {
    const hint = existsSync(".env") ? missing.map(k => `${k}: ${fixes[k]}`).join("; ") : "no .env found: cp .env.example .env, then fill it in";
    report(fail("env", `missing ${missing.join(", ")}`, hint));
  } else {
    report(pass("env", `SELLER_ADDRESS, BUYER_MNEMONIC set, BLOCKFROST_PROJECT_ID ${maskSecret(projectId!)}`));
  }

  report(checkSpendPolicy({ price: config.PRICE_LOVELACE, maxPrice: config.MAX_PRICE_LOVELACE, budget: config.SESSION_BUDGET_LOVELACE }));
  report(checkL1Confirmations(config.CARDANO_L1_CONFIRMATIONS, config.LOCAL_FACILITATOR));

  // buyer wallet: derived offline, same as scripts/new-wallet.ts
  let buyerAddress: string | undefined;
  if (!config.BUYER_MNEMONIC) {
    report(skip("buyer wallet", "BUYER_MNEMONIC"));
  } else {
    const mnemonic = checkMnemonic(config.BUYER_MNEMONIC);
    if (mnemonic.status !== "PASS") {
      report(mnemonic);
    } else {
      try {
        buyerAddress = toClientCardanoSigner({
          mnemonic: config.BUYER_MNEMONIC,
          network: CARDANO_NETWORK,
          provider: { blockfrost: { baseUrl: config.BLOCKFROST_PREPROD_URL, projectId: "unused" } },
        }).getAddress();
        report({ ...mnemonic, detail: `${mnemonic.detail}, buyer ${buyerAddress}` });
      } catch {
        // The error text is not printed: it could echo parts of the phrase.
        report(fail("buyer wallet", "address derivation from BUYER_MNEMONIC failed", "regenerate with npm run wallet:new -- buyer"));
      }
    }
  }

  const seller = config.SELLER_ADDRESS;
  let sellerOk = false;
  if (!seller) {
    report(skip("seller address", "SELLER_ADDRESS"));
  } else {
    const check = checkSellerAddress(seller, buyerAddress);
    sellerOk = check.status !== "FAIL";
    report(check);
  }

  // Blockfrost: authenticated call that also returns the protocol parameters we need below
  const bfUrl = config.BLOCKFROST_PREPROD_URL;
  let params: ProtocolParams | undefined;
  let blockfrostOk = false;
  if (!projectId) {
    report(skip("blockfrost", "BLOCKFROST_PROJECT_ID"));
  } else {
    const masked = maskSecret(projectId);
    const scrub = (text: string) => excerpt(text).replaceAll(projectId, masked);
    const res = await request(`${bfUrl.replace(/\/$/, "")}/epochs/latest/parameters`, { headers: { project_id: projectId } });
    if ("error" in res) {
      report(fail("blockfrost", `${bfUrl} unreachable: ${res.error}`, "check the network and BLOCKFROST_PREPROD_URL"));
    } else if (res.status !== 200) {
      report(fail("blockfrost", `HTTP ${res.status} with project ${masked}: ${scrub(res.text)}`, blockfrostHint(res.status, projectId)));
    } else {
      blockfrostOk = true;
      params = parseProtocolParams(res.json);
      const paramsNote = params ? `, coinsPerUtxoByte ${params.coinsPerUtxoByte}` : ", protocol parameters not parsed";
      if (!bfUrl.includes("preprod") || bfUrl.endsWith("/")) {
        // The Evolution provider appends paths verbatim (`${baseUrl}/addresses/...`).
        report(warn("blockfrost", `authenticated, but BLOCKFROST_PREPROD_URL=${bfUrl} looks off${paramsNote}`, "use https://cardano-preprod.blockfrost.io/api/v0"));
      } else {
        report(pass("blockfrost", `authenticated with project ${masked}${paramsNote}`));
      }
    }
  }

  // buyer balance, from the same UTxO endpoint the wallet uses for coin selection
  if (!buyerAddress || !blockfrostOk || !projectId) {
    report(skip("buyer balance", "a valid BUYER_MNEMONIC and Blockfrost"));
  } else {
    const rows: unknown[] = [];
    let summary: UtxoSummary | null | undefined;
    let error: Check | undefined;
    for (let page = 1; page <= UTXO_PAGES && summary === undefined && !error; page++) {
      const res = await request(`${bfUrl.replace(/\/$/, "")}/addresses/${buyerAddress}/utxos?page=${page}&count=100`, {
        headers: { project_id: projectId },
      });
      if ("error" in res) error = fail("buyer balance", `Blockfrost unreachable: ${res.error}`, "retry");
      else if (res.status === 404) summary = null;
      else if (res.status !== 200 || !Array.isArray(res.json)) {
        error = fail("buyer balance", `Blockfrost HTTP ${res.status}`, blockfrostHint(res.status, projectId));
      } else {
        rows.push(...res.json);
        if (res.json.length < 100) summary = summarizeUtxos(rows);
      }
    }
    if (error) report(error);
    else {
      // More than UTXO_PAGES pages: what we summed is a lower bound, which is fine for "enough".
      const final = summary === undefined ? summarizeUtxos(rows) : summary;
      const headroom = buyerHeadroom(buyerAddress, final?.lovelace ?? 0n, params);
      report(checkBuyerBalance({ buyerAddress, summary: final, price: config.PRICE_LOVELACE, headroom }));
    }
  }

  if (!seller || !sellerOk || !params || config.PRICE_LOVELACE <= 0n) {
    report(skip("seller min-UTxO", "a valid SELLER_ADDRESS, PRICE_LOVELACE and Blockfrost protocol parameters"));
  } else {
    report(checkSellerMinUtxo(seller, config.PRICE_LOVELACE, params.coinsPerUtxoByte));
  }

  // facilitator: what the seller's x402ResourceServer fetches at startup
  const local = config.LOCAL_FACILITATOR;
  // Same trailing-slash normalization as HTTPFacilitatorClient.
  const supportedUrl = `${config.facilitatorUrl.replace(/\/+$/, "")}/supported`;
  const l1 = parseL1Confirmations(config.CARDANO_L1_CONFIRMATIONS);
  const sup = await request(supportedUrl);
  if ("error" in sup) {
    report(
      local
        ? warn("facilitator", `local facilitator ${supportedUrl} unreachable (${sup.error})`, "it is served by the app: start npm run dev, then re-run")
        : fail("facilitator", `${supportedUrl} unreachable (${sup.error})`, "set LOCAL_FACILITATOR=true to verify and broadcast in-process via Blockfrost"),
    );
  } else if (sup.status !== 200) {
    const hint = !local
      ? "set LOCAL_FACILITATOR=true to verify and broadcast in-process via Blockfrost"
      : sup.status === 404
        ? "the running server was not started with LOCAL_FACILITATOR=true: restart npm run dev"
        : "check the npm run dev log";
    report(fail("facilitator", `GET ${supportedUrl} -> HTTP ${sup.status}: ${excerpt(sup.text)}`, hint));
  } else {
    const supported = parseSupportedResponse(sup.json);
    if (!supported) {
      report(fail("facilitator", `${supportedUrl} did not return a SupportedResponse: ${excerpt(sup.text)}`, "check FACILITATOR_URL"));
    } else if (!l1.ok) {
      report(skip("facilitator", "a valid CARDANO_L1_CONFIRMATIONS"));
    } else {
      const check = checkSupportedKind(supported, l1.value, local);
      report({ ...check, detail: `${local ? "local" : config.facilitatorUrl}: ${check.detail}` });
    }
  }

  // seller server: /health, then a live unpaid request that must come back as the expected 402
  const health = await request(`${config.baseUrl}/health`);
  if ("error" in health) {
    report(warn("seller health", `no server at ${config.baseUrl} (${health.error})`, "start it with npm run dev, then re-run to check the live 402"));
    report(warn("seller 402 offer", "skipped: server not running", "start it with npm run dev"));
    return;
  }
  if (health.status !== 200) {
    report(fail("seller health", `GET /health -> HTTP ${health.status}`, "check that PUBLIC_BASE_URL / PORT point at this app"));
    return;
  }
  report(
    checkHealth(health.json, {
      sellerAddress: seller,
      buyerAddress,
      facilitatorUrl: config.facilitatorUrl,
      priceLovelace: config.PRICE_LOVELACE.toString(),
    }),
  );

  const unpaid = await request(
    `${config.baseUrl}${READINESS_PATH}`,
    { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `preflight-${randomUUID()}` }, body: "{}" },
    UNPAID_TIMEOUT_MS,
  );
  const name = "seller 402 offer";
  if ("error" in unpaid) {
    report(fail(name, `unpaid POST ${READINESS_PATH} failed: ${unpaid.error}`, "the server may be stuck on the facilitator: see the facilitator check and the npm run dev log"));
    return;
  }
  if (unpaid.status !== 402) {
    const body = excerpt(unpaid.text);
    const hints: Record<number, string> = {
      502: local ? "the server cannot reach its local facilitator: check the npm run dev log" : "the server cannot reach the facilitator: set LOCAL_FACILITATOR=true and restart npm run dev",
      500: "the server could not build its 402 (unsupported facilitator kind or confirmation range): see the npm run dev log",
      503: "the server has no SELLER_ADDRESS: restart npm run dev with the current .env",
      404: "route not found: check PUBLIC_BASE_URL / PORT",
    };
    report(fail(name, `unpaid POST ${READINESS_PATH} -> HTTP ${unpaid.status}, expected 402: ${body}`, hints[unpaid.status] ?? "the route is not payment-protected as expected"));
    return;
  }
  if (!seller || !l1.ok) {
    report(skip(name, "SELLER_ADDRESS and a valid CARDANO_L1_CONFIRMATIONS"));
    return;
  }
  let offerCheck: ReturnType<typeof checkPaymentRequired>;
  try {
    const paymentRequired = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(h => unpaid.headers.get(h), unpaid.json);
    offerCheck = checkPaymentRequired(paymentRequired, {
      payTo: seller,
      amount: config.PRICE_LOVELACE.toString(),
      l1Confirmations: l1.value,
    });
  } catch (error) {
    report(fail(name, `402 without a decodable PAYMENT-REQUIRED header: ${describeError(error)}`, "check the npm run dev log"));
    return;
  }
  if (!offerCheck.ok) {
    report(fail(name, `offer does not match .env: ${offerCheck.problems.join("; ")}`, "restart npm run dev with the current .env; smoke:x402 refuses to pay this offer"));
    return;
  }
  const { offer } = offerCheck;
  report(pass(name, `402 ${offer.scheme} ${offer.network} ${formatAda(BigInt(offer.amount))} -> ${offer.payTo}, matches .env`));
}

try {
  await main();
} catch (error) {
  report(fail("preflight", `unexpected error: ${error instanceof Error ? error.message : String(error)}`, "report this; the checks above still apply"));
}

const count = (status: Check["status"]) => checks.filter(c => c.status === status).length;
console.log(`\n${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail`);
if (count("FAIL") > 0) {
  console.log("fix the FAIL lines, then re-run npm run preflight");
  process.exitCode = 1;
} else if (checks.some(c => c.name === "seller 402 offer" && c.status === "PASS")) {
  console.log("ready: npm run smoke:x402");
} else {
  console.log("no blockers so far: start npm run dev, re-run npm run preflight, then npm run smoke:x402");
}
