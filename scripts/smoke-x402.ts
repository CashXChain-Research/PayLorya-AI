// Milestone 1: HTTP 402 -> Cardano Preprod payment -> HTTP 200 + tx hash, saved as evidence JSON.
// Needs the server running (npm run dev) and a funded BUYER_MNEMONIC; run npm run preflight first.
import { decodeCardanoTransaction, toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { SettleResponse } from "@x402/core/types";
import { x402Client, x402HTTPClient, type PaymentPayload, type PaymentRequired } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { blockfrostProvider, CARDANO_NETWORK, loadConfig } from "../src/config.js";
import { filterOffers, SpendLedger, type SpendPolicy } from "../src/policy.js";
import { READINESS_PATH } from "../src/seller.js";
import {
  checkPaymentRequired,
  classifyPaidResponse,
  describeError,
  excerpt,
  formatAda,
  offerProblems,
  parseL1Confirmations,
  type ExpectedOffer,
} from "./lib/milestone.js";

// Verify + handler + settle; settle waits for confirmations and @x402/core retries it once (90 s each).
const PAID_TIMEOUT_MS = 240_000;

class Abort extends Error {}
function die(message: string): never {
  throw new Abort(message);
}

const startedAt = new Date();
const t0 = performance.now();
let last = t0;
const timings: Record<string, number> = {};
function lap(step: string): string {
  const now = performance.now();
  timings[step] = Math.round(now - last);
  last = now;
  return `${timings[step]} ms`;
}

async function readBody(res: Response): Promise<{ text: string; json: unknown }> {
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    return { text: `<unreadable body: ${describeError(error)}>`, json: undefined };
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: undefined };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { SELLER_ADDRESS: sellerAddress, BUYER_MNEMONIC: mnemonic } = config;
  if (!sellerAddress || !mnemonic || !config.BLOCKFROST_PROJECT_ID) {
    die("set SELLER_ADDRESS, BUYER_MNEMONIC, BLOCKFROST_PROJECT_ID in .env (npm run preflight shows what is missing)");
  }
  const l1 = parseL1Confirmations(config.CARDANO_L1_CONFIRMATIONS);
  if (!l1.ok) die(l1.reason);
  const expected: ExpectedOffer = { payTo: sellerAddress, amount: config.PRICE_LOVELACE.toString(), l1Confirmations: l1.value };
  const explorer = (tx: string) => `${config.EXPLORER_TX_URL}${tx}`;

  const url = `${config.baseUrl}${READINESS_PATH}`;
  const invoiceId = `SMOKE-${Date.now()}`;
  const idempotencyKey = randomUUID();
  const body = JSON.stringify({
    invoice: {
      id: invoiceId,
      supplier: "Brenner Maschinenbau GmbH",
      destinationCountry: "DE",
      currency: "EUR",
      amountMinor: 1_248_000,
      iban: "DE89370400440532013000",
    },
  });
  const headers = { "content-type": "application/json", "idempotency-key": idempotencyKey };

  // Same trust boundary as src/agent.ts: spend controls, filterOffers policy, ledger budget.
  const signer = toClientCardanoSigner({ mnemonic, network: CARDANO_NETWORK, provider: blockfrostProvider(config) });
  const buyerAddress = signer.getAddress();
  const policy: SpendPolicy = {
    allowedPayTo: [sellerAddress],
    maxPriceLovelace: config.MAX_PRICE_LOVELACE,
    sessionBudgetLovelace: config.SESSION_BUDGET_LOVELACE,
    maxPaymentsPerRun: config.MAX_PAYMENTS_PER_RUN,
  };
  const ledger = new SpendLedger(policy);
  const client = new x402Client()
    .setSpendControls({
      allowedAssets: [{ network: CARDANO_NETWORK, asset: "lovelace", maxAmountPerPayment: policy.maxPriceLovelace.toString() }],
    })
    .registerPolicy((_v, reqs) => filterOffers(reqs, policy))
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      // Re-check the exact requirement being signed, not only the 402 as a whole.
      const problems = offerProblems(selectedRequirements, expected);
      if (problems.length > 0) return { abort: true, reason: problems.join("; ") };
      const allowed = ledger.canPay(invoiceId, BigInt(selectedRequirements.amount));
      if (!allowed.ok) return { abort: true, reason: allowed.reason };
    });
  client.register("cardano:*", new ExactCardanoScheme(signer));
  const httpClient = new x402HTTPClient(client);

  console.log(`buyer  ${buyerAddress}\nseller ${sellerAddress}\nfacilitator ${config.facilitatorUrl}${config.LOCAL_FACILITATOR ? " (local)" : ""}\n`);

  // 1. server up?
  let health: Response;
  try {
    health = await fetch(`${config.baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    await health.body?.cancel();
  } catch (error) {
    die(`server not reachable at ${config.baseUrl} (${describeError(error)}): start it with npm run dev`);
  }
  console.log(`[1/4] GET /health -> HTTP ${health.status} (${lap("health")})`);
  if (health.status !== 200) die(`unexpected HTTP ${health.status} from /health: check PUBLIC_BASE_URL / PORT point at this app`);

  // 2. unpaid request must return the offer we expect
  let unpaid: Response;
  try {
    unpaid = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    die(`unpaid request failed (${describeError(error)}): see the npm run dev log`);
  }
  const unpaidBody = await readBody(unpaid);
  console.log(`[2/4] unpaid POST ${READINESS_PATH} -> HTTP ${unpaid.status}, expect 402 (${lap("unpaid")})`);
  if (unpaid.status !== 402) {
    die(`expected 402, got ${unpaid.status}: ${excerpt(unpaidBody.text)}\n  npm run preflight explains the usual causes`);
  }
  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = httpClient.getPaymentRequiredResponse(h => unpaid.headers.get(h), unpaidBody.json);
  } catch (error) {
    die(`402 without a decodable PAYMENT-REQUIRED header: ${describeError(error)}`);
  }
  const offerCheck = checkPaymentRequired(paymentRequired, expected);
  if (!offerCheck.ok) {
    die(`refusing to pay, the 402 offer does not match .env:\n  - ${offerCheck.problems.join("\n  - ")}\n  restart npm run dev after editing .env`);
  }
  const { offer } = offerCheck;
  console.log(`      offer ${offer.scheme} ${offer.network} ${formatAda(BigInt(offer.amount))} -> ${offer.payTo} (matches .env)`);

  // 3. sign; the client never broadcasts, the facilitator does during settle
  let payload: PaymentPayload;
  try {
    payload = await httpClient.createPaymentPayload(paymentRequired);
  } catch (error) {
    die(
      `could not sign the payment: ${describeError(error)}\n` +
        "  nothing was sent to the server or the chain; fix the cause and re-run (npm run preflight checks balance and Blockfrost)",
    );
  }
  const signedAt = Date.now();
  const rawTx = payload.payload.transaction;
  let signedTxHash: string | undefined;
  let feeLovelace: string | undefined;
  try {
    const decoded = decodeCardanoTransaction(typeof rawTx === "string" ? rawTx : "");
    signedTxHash = decoded.txHash;
    feeLovelace = decoded.fee.toString();
  } catch (error) {
    console.log(`      WARN could not decode the signed tx locally: ${describeError(error)}`);
  }
  console.log(`[3/4] signed tx ${signedTxHash ?? "<unknown>"}, fee ${feeLovelace ?? "?"} lovelace, not broadcast yet (${lap("sign")})`);

  // 4. paid request: verify -> handler -> settle (broadcast + confirmations)
  console.log(`      sending paid request; settlement can take up to ~${PAID_TIMEOUT_MS / 60_000} min`);
  const validUntil = new Date(signedAt + offer.maxTimeoutSeconds * 1000).toISOString();
  function unknownState(reason: string, tx: string | undefined): never {
    die(
      `${reason}\n` +
        (tx ? `  tx ${tx}\n  explorer ${explorer(tx)}\n` : "") +
        "  PAYMENT STATE UNKNOWN: the transaction may already be on-chain.\n" +
        "  Do NOT simply re-run this script. Check the explorer link first: if the tx is there, the payment\n" +
        `  happened and only the response was lost; if it is still absent after ${validUntil} (tx validity\n` +
        "  window) plus a few minutes, it can no longer land and a re-run is safe.",
    );
  }
  let paid: Response;
  try {
    paid = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...httpClient.encodePaymentSignatureHeader(payload) },
      body,
      signal: AbortSignal.timeout(PAID_TIMEOUT_MS),
    });
  } catch (error) {
    unknownState(`paid request failed: ${describeError(error)}`, signedTxHash);
  }
  const paidBody = await readBody(paid);
  let settle: SettleResponse | undefined;
  try {
    settle = httpClient.getPaymentSettleResponse(h => paid.headers.get(h));
  } catch {
    settle = undefined; // header missing or undecodable
  }
  const hasPaymentRequired = paid.headers.get("PAYMENT-REQUIRED") !== null;
  console.log(`[4/4] paid POST ${READINESS_PATH} -> HTTP ${paid.status} (${lap("paid")})`);
  if (settle) console.log(`      settle ${JSON.stringify(settle)}`);

  const { outcome, reason } = classifyPaidResponse(paid.status, settle, hasPaymentRequired);
  if (outcome === "not_settled") {
    let verifyError: string | undefined;
    if (hasPaymentRequired) {
      try {
        verifyError = httpClient.getPaymentRequiredResponse(h => paid.headers.get(h)).error;
      } catch {
        verifyError = undefined;
      }
    }
    die(
      `payment not settled: ${reason}${verifyError ? ` (${verifyError})` : ""}\n  body: ${excerpt(paidBody.text)}\n` +
        "  the facilitator did not broadcast this tx; fix the cause and re-run",
    );
  }
  if (outcome === "unknown" || !settle) {
    unknownState(`${reason}\n  body: ${excerpt(paidBody.text)}`, settle?.transaction || signedTxHash);
  }

  const tx = settle.transaction;
  if (signedTxHash && tx !== signedTxHash) console.log(`      WARN settled tx ${tx} differs from the signed tx ${signedTxHash}`);
  if (settle.network !== CARDANO_NETWORK) console.log(`      WARN settle network ${settle.network}, expected ${CARDANO_NETWORK}`);
  const report = typeof paidBody.json === "object" && paidBody.json !== null ? (paidBody.json as Record<string, unknown>) : undefined;
  const verdict = typeof report?.verdict === "string" ? report.verdict : undefined;
  if (!report) console.log(`      WARN response body is not JSON: ${excerpt(paidBody.text)}`);

  const finishedAt = new Date();
  timings.total = Math.round(performance.now() - t0);
  // Submission proof: public data only (no mnemonic, no Blockfrost project id).
  const evidence = {
    milestone: 1,
    result: "settled",
    network: CARDANO_NETWORK,
    buyerAddress,
    sellerAddress,
    asset: offer.asset,
    amount: offer.amount,
    transactionHash: tx,
    explorerUrl: explorer(tx),
    signedTransactionHash: signedTxHash ?? null,
    feeLovelace: feeLovelace ?? null,
    facilitatorUrl: config.facilitatorUrl,
    localFacilitator: config.LOCAL_FACILITATOR,
    endpoint: url,
    invoiceId,
    idempotencyKey,
    http: { health: health.status, unpaid: unpaid.status, paid: paid.status },
    offer,
    settleResponse: settle,
    reportVerdict: verdict ?? null,
    report: report ?? null,
    timingsMs: timings,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  const dir = fileURLToPath(new URL("../evidence/", import.meta.url));
  const file = `${dir}milestone1-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, json);
  } catch (error) {
    console.log(`      WARN could not write ${file} (${describeError(error)}); evidence follows:\n${json}`);
  }

  console.log(`\nSETTLED ${formatAda(BigInt(offer.amount))} on ${CARDANO_NETWORK}`);
  console.log(`  tx       ${tx}`);
  console.log(`  explorer ${explorer(tx)}`);
  console.log(`  verdict  ${verdict ?? "<none>"}`);
  console.log(`  evidence ${file}`);
  console.log(`  total    ${timings.total} ms`);
}

try {
  await main();
} catch (error) {
  console.error(`\nFAILED: ${error instanceof Abort ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
}
