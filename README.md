# CxC AgentPay

**CxC Payment Readiness API**: pay-per-request validation for autonomous payment agents.

An AI agent receives a supplier invoice, extracts the payment fields, and buys a cross-border
payment readiness report from the CxC API, paying per request with **x402 on Cardano Preprod**.
The run ends in a payment draft that a human must approve. No payout is executed.

Built by [CashXChain](https://cashxchain.com) at the TUM Blockchain & AI Hackathon 2026 (Cardano track).

## Why it matters

Agents are starting to pay for services on their own. Two things are missing: services that are
worth paying for, and hard limits between what an AI decides and where money moves.

- **The product:** an API any agent can call and pay per response. It checks whether an
  international payment is ready to send (account validation, corridor, required fields,
  duplicates, simulated route and fees).
- **The safety model:** Claude only extracts invoice fields. A deterministic policy decides
  whether to pay, how much, to whom and how often. Unclear settlements lock the invoice
  instead of paying twice.

## Quick start

```bash
npm install
cp .env.example .env
npm run wallet:new -- seller     # put SELLER_ADDRESS into .env
npm run wallet:new -- buyer      # put BUYER_MNEMONIC into .env, fund the printed address
```

1. Fund the buyer address with tADA from the [Cardano testnets faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).
2. Create a free Blockfrost **preprod** project and set `BLOCKFROST_PROJECT_ID`.
3. Set `ANTHROPIC_API_KEY` (optional; structured JSON invoices work without it).

```bash
npm run dev                      # http://localhost:8787
npm run smoke:x402               # milestone 1: 402 -> preprod payment -> 200 + tx hash
```

If the hosted facilitator is unreachable, set `LOCAL_FACILITATOR=true` to verify and broadcast
in-process via Blockfrost.

## API

| Endpoint | Role | Description |
| --- | --- | --- |
| `POST /v1/payment-readiness` | Seller, x402-paid | Body `{ invoice }`, header `Idempotency-Key`. Returns the readiness report |
| `POST /api/runs` | Agent | Body `{ input }` (invoice text or JSON). Starts a run |
| `GET /api/runs/:id` | Agent | State, timeline, payment proof, report, draft |
| `GET /api/health` | Both | Config status, buyer/seller address, spend |

## Stack

TypeScript, Express, official x402 SDK (`@x402/cardano`, `@x402/express`, `@x402/fetch` 2.29),
Blockfrost, Claude API (`@anthropic-ai/sdk`, optional Cloudflare AI Gateway via `ANTHROPIC_BASE_URL`),
Cloudflare Containers for hosting.

## Deploy (Cloudflare Containers)

Requires Docker locally and a Workers Paid plan.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BLOCKFROST_PROJECT_ID
npx wrangler secret put BUYER_MNEMONIC
npx wrangler secret put SELLER_ADDRESS
npx wrangler deploy
```

Run state is in memory, so the Worker routes everything to a single container instance.

## Tests

```bash
npm test
npm run typecheck
```

## Limitations

- Testnet only (`cardano:preprod`, tADA). Synthetic invoices only.
- Corridors, fees and FX are demo fixtures, labeled as simulated.
- The report is a data-quality and routing check, not an AML, sanctions or KYB decision.
- No CashXChain payout endpoint is called. Every draft needs human approval.
- In-memory state; a restart clears runs and the spend ledger.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the flow, trust boundary and open verification items.
