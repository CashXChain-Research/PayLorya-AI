# Architecture

## Product

**CxC Payment Readiness API**: pay-per-request validation for autonomous payment agents.
Any agent POSTs a structured invoice to `POST /v1/payment-readiness`, pays per response via
x402 on Cardano Preprod, and gets a readiness report. Our Claude agent is the demo customer.

**Payout (after human approval):** the agent then picks a payout rail with deterministic rules
against a verified payee directory and, once a human approves, executes it: a tADA transfer on
Cardano Preprod for ADA invoices (real testnet tx), or a CashXChain payout for fiat invoices
(CashXChain **sandbox** when `CASHXCHAIN_API_KEY` is set: test ledger, no real money; otherwise
simulated, no API call). The report fee and the
invoice payout are separate transactions with separate budgets.

## Roles

| Role | Code | Wallet |
| --- | --- | --- |
| Seller (paid API) | `src/seller.ts`, `src/readiness.ts` | `SELLER_ADDRESS` (address only, no key on the server) |
| Buyer (agent) | `src/agent.ts`, `src/policy.ts`, `src/extract.ts` | `BUYER_MNEMONIC` (test only) |
| Facilitator | hosted CF preprod facilitator, or `src/facilitator.ts` fallback | none, broadcast only |
| Payout rails | `src/routing.ts`, `src/payout.ts`, `src/payout-cashxchain.ts`, `BuyerAgent.approve()` | buyer wallet pays tADA payouts; fiat via the CashXChain sandbox (`CASHXCHAIN_API_KEY`) or simulated |

All three run in one Node process for the hackathon. The buyer reaches the seller over HTTP
(`PUBLIC_BASE_URL`), so they can be split later without code changes.

## Flow

```
CREATED -> EXTRACTED -> PRECHECKED -> PAYING -> PAID -> DRAFT_READY -> EXECUTING -> EXECUTED
                     \-> NEEDS_INFO        \-> SETTLEMENT_UNKNOWN       \-> REJECTED  \-> PAYOUT_UNKNOWN
                                            \-> FAILED      PAID -> NEEDS_INFO | BLOCKED  \-> FAILED
```

`DRAFT_READY -> EXECUTING` happens only via `POST /api/runs/:id/approve`, and only if the draft is
executable. `PAID -> BLOCKED` also covers a payout route the policy blocks.

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
8. Ready report: `decideRoute` picks the rail and the destination from the payee directory
   (below). Blocked route: `BLOCKED`. Otherwise `DRAFT_READY`, executable only if a route was
   selected.
9. Human approves: the route is derived again from the directory. ADA: the buyer wallet signs a
   plain lovelace transfer to the verified wallet (same `@x402/cardano` signer, `default`
   method), Blockfrost broadcasts it and waits up to 2 min. Fiat: `FiatPayoutClient`, i.e.
   `CashXChainPayoutRoute` with `CASHXCHAIN_API_KEY`, else `simulatedCxcPayouts`.

## Trust boundary

- The model returns only invoice fields. Payee account fields (IBAN, routing, Cardano address)
  are invoice data; the agent's own wallet, endpoint, price and limits are not in the schema.
  The invoice text is wrapped as untrusted data.
- A payout destination is never taken from the invoice. It comes from the verified payee
  record; an invoice account that differs from the record blocks the payout.
- Network, asset, recipient allowlist and caps come from env config only.
- Seller holds no signing key. Facilitator holds no funds.
- CashXChain is called only for an approved fiat payout, only on the sandbox: the base URL is fixed
  and config refuses anything but `cxc_sk_sandbox_` / `cxc_rk_sandbox_` keys. Without the key the
  fiat rail is simulated and labeled. The seller's report keeps `payoutExecuted: false`: the report
  itself never pays anyone.
- Invoice payouts need a human approval per invoice. The approval endpoint is public on the
  demo deployment; payouts are capped by `PAYOUT_MAX_LOVELACE` and `PAYOUT_BUDGET_LOVELACE`.
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
- **Wallet sync:** before the next wallet tx (report payment or invoice payout), the queue waits
  until Blockfrost has indexed the previous one (`GET /txs/{hash}`, up to 90 s), plus 30 s after it
  settled for other indexers such as the hosted facilitator's. A7 (2026-10-30) showed why: a payment
  built ~27 s after the previous block was rejected at verify. Only txs that were (or may have been)
  broadcast are waited for; a verify rejection is not.
- **SETTLEMENT_UNKNOWN:** if anything fails after the buyer signed a transaction, the tx may
  already be on-chain. The run moves to `SETTLEMENT_UNKNOWN`, the amount counts against the
  budget, and the invoice is locked against re-payment until resolved. This includes verify
  rejections (the seller holds the signed tx) and a settle "success" without a tx hash.
  `run.settlement = { transactionHash?, explorerUrl?, reason }` says what to look up before anyone
  pays again. The hash comes from the settle response, or else from decoding the tx we signed, so
  a lost response still leaves an explorer link.
- **Paid without a usable report:** if settle succeeded but the body is not a well-formed report
  (not JSON, or no valid verdict/checks), the run ends `FAILED` with the payment proof kept and
  the invoice locked as paid. It is a failed delivery, not a free retry.
- **Offer filter:** only `exact` / `cardano:preprod` / `lovelace`, allowlisted `payTo`, price
  cap, and the plain `default` transfer method (no Masumi or script locks).
- The facilitator broadcasts a given Cardano tx at most once (`@x402/cardano` duplicate
  settlement guard).

## Route and payout

| Rule | Logic |
| --- | --- |
| Payee | Supplier name matched against the verified payee directory (legal forms dropped). Unknown payee: draft not executable |
| Rail | Currency `ADA` -> `cardano_preprod`; any fiat currency -> `cxc_fiat` |
| Account | ADA: invoice wallet must equal the record's wallet. Fiat: IBAN, or routing + account, must equal the record. Mismatch: `BLOCKED` (possible invoice redirection) |
| Wallet on a fiat invoice | Ignored and flagged (`warn`) unless it is the payee's recorded wallet |
| Limit | ADA payout from 1 tADA (min-UTxO) to `PAYOUT_MAX_LOVELACE` (default 10 tADA) |
| Budget | `PAYOUT_BUDGET_LOVELACE` (default 30 tADA), separate from the report-fee budget |

The demo directory is synthetic (`payeeDirectory()` in `src/routing.ts`). The crypto payee's wallet
is `SUPPLIER_CARDANO_ADDRESS`; without it, the Cardano route is unavailable and the crypto samples
are not offered.

Payout safety mirrors the report payment:

- `approve()` switches to `EXECUTING` synchronously; a second click gets 409.
- The payout ledger reserves the invoice before signing and releases it only if signing threw.
- A definitive node rejection before broadcast (Blockfrost `submitTx` HTTP 400, e.g. a spent
  input) returns the run to `DRAFT_READY` with the hold released: nothing was sent, approve again.
  The SDK's reference signer does not implement `isDefinitiveSubmissionRejection`, so the classifier
  is ours and deliberately narrow (to be confirmed live).
- Any other error after signing: `PAYOUT_UNKNOWN`, amount counted, invoice locked, `run.payout`
  carries the signed tx hash for the explorer. Same for an error from a fiat client, which may have
  accepted the payout before failing.
- A Blockfrost wait timeout after broadcast is `EXECUTED` with `payout.status: "submitted"`.
- Fiat payouts are keyed per invoice (`Idempotency-Key: payout-<fingerprint>`), so a retry or a
  new run after a restart replays instead of paying again. The client gets the verified payee
  record (name, IBAN/BIC or routing/account/type), never text from the invoice. A client that
  proves nothing was sent (`isDefinitiveRejection`) returns the run to `DRAFT_READY`; any other
  error stays `PAYOUT_UNKNOWN`.
- CashXChain route (`src/payout-cashxchain.ts`): source account in the invoice currency,
  beneficiary from the payee record, `POST /v1/banking/payouts` under the agent's key, polled to
  a final status.
  - **Refused** (`isDefinitiveRejection`, nothing paid): any failure before the payout POST; on the
    POST, `plan_limit_exceeded` / `insufficient_balance` (they prove no payout exists under the
    key), or another 4xx on a key this process never sent; and the final statuses `failed` /
    `cancelled`. **Deviation from the payout contract**, agreed with workstream A: the contract
    listed `failed`/`cancelled` as unknown; CashXChain documents both as "did not happen", and a
    same-key retry after `insufficient_balance` replays `failed`, so such an invoice stays
    refusable and cannot pay (CashXChain wants a new key for that, which we do not mint).
  - **Unknown** (locked): 5xx, timeout or network on the POST; any 409 (a payout exists under the
    key); 429 (recorded as `created`); a 4xx on a key this process sent before (a replay re-runs
    CashXChain's checks and can fail after the first attempt settled); `created` after polling;
    `returned`; polling errors.
- Payouts go through the same wallet queue as report payments (one tx in flight per wallet).

## Readiness checks

| Check | Source | Logic |
| --- | --- | --- |
| account | deterministic | IBAN mod-97 + country length; BIC format + country; ABA routing checksum; Cardano address bech32 checksum, `addr_test1` prefix, key credential |
| corridor | demo-fixture | destination country + currency in the demo corridor table |
| required_fields | demo-fixture | per corridor (SEPA: IBAN; US: routing + account; AE: IBAN + BIC; ADA: Cardano address) |
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

- 2026-10-31 (A7 safety, live): `repeat-invoice` PASS (tx `7df56c37…d063`, the repeat was refused
  before signing) and `missing-account` PASS (`NEEDS_INFO`, nothing paid). `prompt-injection` ended
  `SETTLEMENT_UNKNOWN`: the hosted facilitator answered settle with nginx **504 after ~65 s**, but tx
  `8f05dd119428d53511de6c1dade9ed189c62e0cae53dbeefe3b85ce7ce54ffc1` is on chain (block 5355152)
  with exactly 2 tADA to the seller and change to the buyer. Nothing went to the attacker address.
  On the earlier run (2026-10-30), tx `3f1acfbd…` was rejected at verify and never broadcast; its
  reason was lost, which led to the verify-reason fix in #10.
  Evidence: `evidence/safety-2026-10-30T23-56-11-205Z.json`, `evidence/safety-2026-10-31T00-46-10-335Z.json`.

## Not verified yet

- No live payout has run. `blockfrostSubmitter` uses `@x402/cardano`'s provider-only
  `submitTransaction` (Blockfrost `/tx/submit`, then evolution `awaitTx` with a 120 s timeout),
  read from the installed source and covered offline with a stub only.
- Whether Claude copies a 100+ character bech32 address exactly. A single wrong character fails
  the checksum and the run ends `NEEDS_INFO`, so this fails safe.
- CashXChain sandbox payouts are tested offline against a fake that follows the CashXChain docs
  and the backend's mock rail (`tests/fake-cashxchain.ts`), not yet against
  `api.sandbox.cashxchain.com`.
- With `LOCAL_FACILITATOR=true`, verify also calls Blockfrost `POST /utils/txs/evaluate/utxos`;
  untested against real Blockfrost for a script-free tx.
- Cloudflare Containers deploy is written against `@cloudflare/containers@0.3.7` and the
  wrangler 4.156 schema but not deployed yet.
- `EXPLORER_TX_URL` default (Cardanoscan preprod) to be confirmed with the first real tx, in a
  browser: Cardanoscan serves a Cloudflare challenge to scripts, so it cannot be checked automatically.
