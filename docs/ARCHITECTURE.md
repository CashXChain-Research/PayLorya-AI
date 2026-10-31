# Architecture

## Product

**CxC Payment Readiness API**: pay-per-request validation for autonomous payment agents.
Any agent POSTs a structured invoice to `POST /v1/payment-readiness`, pays per response via
x402 on Cardano Preprod, and gets a readiness report. Our Claude agent is the demo customer.
With `CASHXCHAIN_API_KEY` set, a ready draft is prepared as a payout on the **CashXChain sandbox**, and
a human approval sends it there. Without it, the draft does not execute.

## Roles

| Role | Code | Wallet |
| --- | --- | --- |
| Seller (paid API) | `src/seller.ts`, `src/readiness.ts` | `SELLER_ADDRESS` (address only, no key on the server) |
| Buyer (agent) | `src/agent.ts`, `src/policy.ts`, `src/extract.ts` | `BUYER_MNEMONIC` (test only) |
| Facilitator | hosted CF preprod facilitator, or `src/facilitator.ts` fallback | none, broadcast only |
| Supplier payout | `src/payout.ts`, `src/cashxchain.ts` | `CASHXCHAIN_API_KEY`, CashXChain **sandbox** only |

All three run in one Node process for the hackathon. The buyer reaches the seller over HTTP
(`PUBLIC_BASE_URL`), so they can be split later without code changes.

## Flow

```
CREATED -> EXTRACTED -> PRECHECKED -> PAYING -> PAID -> DRAFT_READY
                     \-> NEEDS_INFO        \-> SETTLEMENT_UNKNOWN
                                            \-> FAILED      PAID -> NEEDS_INFO | BLOCKED

DRAFT_READY --approve--> PAYOUT_SENDING -> PAYOUT_SETTLED | PAYOUT_IN_FLIGHT | PAYOUT_FAILED | PAYOUT_UNKNOWN
            --reject---> REJECTED
```

The second line only happens through `POST /api/runs/:id/approve` (a human in the UI).

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
8. Ready report and `CASHXCHAIN_API_KEY` set: prepare the CashXChain payout (below). Moves no money.
9. A human approves: `POST /v1/banking/payouts` on the CashXChain sandbox.

## Trust boundary

- The model returns only invoice fields. The extraction schema has no wallet, endpoint, price
  or limit fields, and the invoice text is wrapped as untrusted data.
- Network, asset, recipient allowlist and caps come from env config only.
- Seller holds no signing key. Facilitator holds no funds.
- The x402 report never pays anyone (`payoutExecuted: false`). The supplier payout is a separate
  step that only a human approval starts; the agent cannot call it.
- The payout's payee and amount necessarily come from the invoice (paying an invoice means paying
  the account printed on it). Protections: the paid report's deterministic checks (IBAN mod-97,
  duplicates, amount ceiling), CashXChain corridor validation and payee-name check, and a human who
  sees supplier, account, amount and fee before approving. A crypto address in the invoice text has
  no field to land in.
- CashXChain is locked to the sandbox: the base URL is a constant and `CASHXCHAIN_API_KEY` must be a
  `cxc_sk_sandbox_` / `cxc_rk_sandbox_` key, or the server refuses to start.
- Route, fees and FX are `demo-fixture` and labeled "Simulated route/fees".
- The report is a data-quality and routing check, not an AML, sanctions or KYB decision.

## Payment safety

- **Idempotency:** the seller handler runs after verify and before settle and can be retried.
  Requests carry `Idempotency-Key` (the run id); the same key returns the cached report.
- **Duplicates:** a different key for the same supplier + invoice id + currency + amount is
  flagged `duplicate` and the verdict is `blocked`.
- **In-flight hold:** `SpendLedger.reserve()` checks and holds budget + invoice in one step
  before signing, so concurrent runs (double click, client retry) cannot both pay. The hold is
  released only if signing itself threw; otherwise it becomes paid or unknown.
- **One payment per wallet at a time:** `BuyerAgent` queues the pay step (402 -> sign -> settle)
  per buyer wallet. Two signers reading the same UTxO set could spend the same input; both would
  pass verify and the second broadcast would fail after signing. Runs wait in `PRECHECKED` for
  their turn. Settle waits for confirmation, so the next payment sees the updated UTxO set. Use a
  separate buyer wallet per deployment (laptop vs cloud) for the same reason.
- **SETTLEMENT_UNKNOWN:** if anything fails after the buyer signed a transaction, the tx may
  already be on-chain. The run moves to `SETTLEMENT_UNKNOWN`, the amount counts against the
  budget, and the invoice is locked against re-payment until resolved. This includes verify
  rejections (the seller holds the signed tx) and a settle "success" without a tx hash.
  `run.settlement = { transactionHash?, explorerUrl?, reason }` says what to look up before anyone
  pays again. The hash comes from the settle response, or else from decoding the tx we signed, so
  a lost response still leaves an explorer link.
- **Offer filter:** only `exact` / `cardano:preprod` / `lovelace`, allowlisted `payTo`, price
  cap, and the plain `default` transfer method (no Masumi or script locks).
- The facilitator broadcasts a given Cardano tx at most once (`@x402/cardano` duplicate
  settlement guard).

## Supplier payout (CashXChain sandbox)

Written against docs.cashxchain.com/docs/api and checked against the backend DTOs and mock rail.

**Prepare** (automatic, after a `ready_for_review` report; no money moves):

| Step | Call | Outcome when it does not work |
| --- | --- | --- |
| Source account | `GET /v1/banking/accounts`: active account in the invoice currency | draft not executable (`blockedReason`) |
| Corridor | `GET /v1/banking/corridors?currency&country&entity_type=business` | `corridor_unsupported` -> `BLOCKED` |
| Account mapping | invoice IBAN / ABA / BIC onto an `accepted_schemes` entry; required corridor fields (e.g. `account_type` for USD/US) | `NEEDS_INFO`, naming the field |
| Beneficiary | `POST /v1/banking/beneficiaries`, key `agentpay-ben-<hash of payee>` | `400` -> `NEEDS_INFO` |
| Payee-name check | `POST …/beneficiaries/{id}/verify`; sandbox always `not_checked` | `may_pay: false` -> `NEEDS_INFO` |
| Quote, balance | `POST /v1/banking/payouts/quote`, `GET …/accounts/{id}/balance` | shown; low balance is a warning |

Any other API failure (auth, 5xx, network) leaves the draft non-executable with the reason.

**Execute** (human approval only):

- `POST /v1/banking/payouts` with `Idempotency-Key: agentpay-payout-<invoice fingerprint>-<attempt>`.
  Same key and body returns the payout as it is now, never a second one. The key is bound to the
  invoice, not the run, so after a restart the same invoice replays the earlier payout.
- Status mapping: `settled` -> `PAYOUT_SETTLED`; `submitted`/`processing` -> `PAYOUT_IN_FLIGHT`
  (polled); `failed`/`cancelled`/`returned` -> `PAYOUT_FAILED`; `created` -> `PAYOUT_UNKNOWN`.
- `4xx` on create: nothing paid -> `PAYOUT_FAILED`. The next approval keeps the same key, except
  after `insufficient_balance`, `idempotency_key_reuse` or `rate_limited` (documented as recording
  the key), or a payout that came back `failed`: then `attempt + 1`. Never skipping an unrecorded
  key means a restart cannot reach a fresh key while an earlier one could still pay.
- `5xx`, timeout, network: `PAYOUT_UNKNOWN`. Approving again ("Check status") replays the same key.
- `approve` checks and sets state synchronously: a double click cannot send twice.
- Not handled (cannot happen in the sandbox): payee-name `accept-verification`, FX quotes for
  cross-currency payouts. Both would be required before production.

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

## Verified offline

- Seller ordering verify -> handler -> settle; body withheld and HTTP 402 on failed settle
  (`@x402/express` source + `tests/agent-x402.test.ts`).
- `@x402/core` retries settle exactly once, only on `settlement_pending` with a tx.
- The middleware fetches the facilitator's `/supported` at startup in the background and
  retries on the first paid request (502 if still unreachable); the server does not crash.

## Verified live

- 2026-10-30: hosted facilitator `GET /supported` returns one kind: x402 v2, `exact`,
  `cardano:preprod`, `assetTransferMethods` `["default","masumi","script"]`,
  `areFeesSponsored: false`, `l1Confirmations` `[0, 20]`. So `CARDANO_L1_CONFIRMATIONS=-1`
  (mempool) is out of range there. `/` and `/health` return 404. Fixture in `tests/milestone.test.ts`.
- 2026-10-30: Blockfrost preprod answers a missing key with 403 "Missing project token" and any
  rejected key (including `mainnet…`/`preview…` prefixes) with 403 "Invalid project token.". The
  preflight hint now treats the prefix as a suggestion only. `/health` needs no key.
- 2026-10-30 (milestone 1): first real x402 payment through the Cloudflare deployment, hosted
  facilitator, `CARDANO_L1_CONFIRMATIONS` unset (1). Run `8a1e92b8`, 2 tADA buyer-cloud -> seller,
  tx `4e959d66ee947505292fbb48c1ec10356ed70b1751dab98b1ad2f37591ea87b2`, block 5354949, fee
  0.168581 tADA, PAYING -> PAID in 32.4 s, run ended `DRAFT_READY`. Outputs checked on Koios.
  Evidence: `evidence/live-run-2026-10-30T23-32-37-254Z.json`.

## Not verified yet

- CashXChain payout path: tested offline against a fake that follows the docs
  (`tests/fake-cashxchain.ts`), not yet against `api.sandbox.cashxchain.com` (this cloud session's
  network policy blocks the CashXChain hosts). First live check: set `CASHXCHAIN_API_KEY`, run the EUR
  sample, approve, and confirm the payout id in the sandbox web app.

- With `LOCAL_FACILITATOR=true`, verify also calls Blockfrost `POST /utils/txs/evaluate/utxos`;
  untested against real Blockfrost for a script-free tx.
- Cloudflare Containers deploy is written against `@cloudflare/containers@0.3.7` and the
  wrangler 4.156 schema but not deployed yet.
- `EXPLORER_TX_URL` default (Cardanoscan preprod) to be confirmed with the first real tx, in a
  browser: Cardanoscan serves a Cloudflare challenge to scripts, so it cannot be checked automatically.
