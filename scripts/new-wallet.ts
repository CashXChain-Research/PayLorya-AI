// Generates a fresh TEST-ONLY Cardano Preprod wallet (mnemonic + address). Offline.
// Usage: npm run wallet:new -- buyer   |   npm run wallet:new -- seller   |   npm run wallet:new -- supplier
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { toClientCardanoSigner } from "@x402/cardano";

const role = process.argv[2] ?? "wallet";
const mnemonic = generateMnemonic(wordlist, 256);
// Address derivation is local; the provider is never contacted here.
const address = toClientCardanoSigner({
  mnemonic,
  network: "cardano:preprod",
  provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId: "unused" } },
}).getAddress();

console.log(`# ${role} (Cardano Preprod, test funds only, never reuse on mainnet)`);
if (role === "seller") {
  console.log(`SELLER_ADDRESS=${address}`);
  console.log(`# keep the seller mnemonic offline, the server only needs the address:\n# ${mnemonic}`);
} else if (role === "supplier") {
  console.log(`SUPPLIER_CARDANO_ADDRESS=${address}`);
  console.log(`# verified payee wallet for crypto invoices; keep the mnemonic offline to reclaim test funds:\n# ${mnemonic}`);
} else {
  console.log(`BUYER_MNEMONIC="${mnemonic}"`);
  console.log(`# fund via faucet: ${address}`);
}
