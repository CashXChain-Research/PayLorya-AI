# Architecture

## Product

**CxC Payment Readiness API**: pay-per-request validation for autonomous payment agents.
Any agent POSTs a structured invoice to `POST /v1/payment-readiness`, pays per response via
x402 on Cardano Preprod, and gets a readiness report. Our Claude agent is the demo customer.
The supplier payout itself is never executed: the run ends in a non-executing draft that
needs human approval.

## Roles

| Role | Code | Wallet |
| --- | --- | --- |
| Seller (paid API) | `src/seller.ts`, `src/readiness.ts` | `SELLER_ADDRESS` (address only, no key on the server) |
| Buyer (agent) | `src/agent.ts`, `src/policy.ts`, `src/extract.ts` | `BUYER_MNEMONIC` (test only) |
| Facilitator | hosted CF preprod facilitator, or `src/facilitator.ts` fallback | none, broadcast only |

All three run in one Node process for the hackathon. The buyer reaches the seller over HTTP
(`PUBLIC_BASE_URL`), so they can be split later without code changes.

## Flow

```
CREATED -> EXTRACTED -> PRECHECKED -> PAYING -> PAID -> DRAFT_READY
                     \-> NEEDS_INFO        \-> SETTLEMENT_UNKNOWN
                                            \-> FAILED      PAID -> NEEDS_INFO | BLOCKED
```

1. `POST /api/runs` with invoice text or JSON.
2. Claude extracts fields (structured output, `effort: low`); JSON input skips the model.
   Amounts are converted to minor units deterministically (`parseAmountMinor`), not by the model.
3. Local precheck (account identifier present), so we do not pay for obviously useless calls.
4. Buyer calls the seller, gets HTTP 402 (`exact`, `cardano:preprod`, `lovelace`, `payTo`).
5. x402 client filters the offer through `filterOffers` (network, scheme, asset, allowlisted
   payTo, price cap) and the `SpendLedger` (session budget, one payment per invoice, max
   payments per run), signs with the buyer wallet, retries with the payment header.
6. Seller verifies via facilitator, runs the handler, settles; the middleware withholds the
   body if settlement fails.
7. Run stores tx hash + explorer URL only from a successful settle response.

## Trust boundary

- The model returns only invoice fields. The extraction schema has no wallet, endpoint, price
  or limit fields, and the invoice text is wrapped as untrusted data.
- Network, asset, recipient allowlist and caps come from env config only.
- Seller holds no signing key. Facilitator holds no funds.
- No CashXChain payout endpoint is called. `payoutExecuted: false`, `executable: false`.
- Route, fees and FX are `demo-fixture` and labeled "Simulated route/fees".
- The report is a data-quality and routing check, not an AML, sanctions or KYB decision.

## Payment safety

- **Idempotency:** the seller handler runs after verify and before settle and can be retried.
  Requests carry `Idempotency-Key` (the run id); the same key returns the cached report.
- **Duplicates:** a different key for the same supplier + invoice id + currency + amount is
  flagged `duplicate` and the verdict is `blocked`.
- **SETTLEMENT_UNKNOWN:** if anything fails after the buyer signed a transaction, the tx may
  already be on-chain. The run moves to `SETTLEMENT_UNKNOWN`, the amount counts against the
  budget, and the invoice is locked against re-payment until resolved.
- The facilitator broadcasts a given Cardano tx at most once (`@x402/cardano` duplicate
  settlement guard).

## Readiness checks

| Check | Source | Logic |
| --- | --- | --- |
| account | deterministic | IBAN mod-97 + country length; BIC format + country; ABA routing checksum |
| corridor | demo-fixture | destination country + currency in the demo corridor table |
| required_fields | demo-fixture | per corridor (SEPA: IBAN; US: routing + account; AE: IBAN + BIC) |
| duplicate | deterministic | fingerprint ledger keyed by Idempotency-Key |
| amount | deterministic | demo ceiling |
| quote | demo-fixture | simulated fee / FX / ETA |

Verdict: `blocked` (corridor, duplicate, amount), `needs_info` (fields, account, warnings),
otherwise `ready_for_review`.

## Not verified yet

- Hosted facilitator URL is taken from developers.cardano.org and has not been exercised by us.
- No live preprod payment has run yet: that is milestone 1 (`npm run smoke:x402`).
- Cloudflare Containers deploy is written against `@cloudflare/containers@0.3.7` and the
  wrangler 4.156 schema but not deployed yet.
- `EXPLORER_TX_URL` default (Cardanoscan preprod) to be confirmed with the first real tx.
