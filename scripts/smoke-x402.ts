// Milestone 1: HTTP 402 -> Cardano Preprod payment -> HTTP 200 + tx hash.
// Needs the server running (npm run dev) and a funded BUYER_MNEMONIC.
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import { blockfrostProvider, CARDANO_NETWORK, loadConfig } from "../src/config.js";
import { READINESS_PATH } from "../src/seller.js";

const config = loadConfig();
if (!config.x402Ready) throw new Error("set SELLER_ADDRESS, BUYER_MNEMONIC, BLOCKFROST_PROJECT_ID");

const url = `${config.baseUrl}${READINESS_PATH}`;
const body = JSON.stringify({
  invoice: {
    id: `SMOKE-${Date.now()}`,
    supplier: "Brenner Maschinenbau GmbH",
    destinationCountry: "DE",
    currency: "EUR",
    amountMinor: 1_248_000,
    iban: "DE89370400440532013000",
  },
});
const headers = { "content-type": "application/json", "idempotency-key": randomUUID() };

const unpaid = await fetch(url, { method: "POST", headers, body });
console.log(`unpaid request -> HTTP ${unpaid.status} (expect 402)`);

const signer = toClientCardanoSigner({ mnemonic: config.BUYER_MNEMONIC!, network: CARDANO_NETWORK, provider: blockfrostProvider(config) });
console.log(`buyer ${signer.getAddress()}`);
const client = new x402Client().setSpendControls({
  allowedAssets: [{ network: CARDANO_NETWORK, asset: "lovelace", maxAmountPerPayment: config.MAX_PRICE_LOVELACE.toString() }],
});
client.register("cardano:*", new ExactCardanoScheme(signer));

const paid = await wrapFetchWithPayment(fetch, client)(url, { method: "POST", headers, body });
const settle = new x402HTTPClient(client).getPaymentSettleResponse(name => paid.headers.get(name));
console.log(`paid request -> HTTP ${paid.status}`);
console.log(JSON.stringify(settle, null, 2));
if (settle.success) console.log(`explorer: ${config.EXPLORER_TX_URL}${settle.transaction}`);
console.log(JSON.stringify(await paid.json(), null, 2));
