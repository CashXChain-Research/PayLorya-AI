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
- Network, asset and recipient allowlist come from env config only. Budgets and caps start from
  env config and can be changed at runtime only with the operator token (`PUT /api/budget`,
  bounded by `HARD_MAX` in `src/budget.ts`).
- Seller holds no signing key. Facilitator holds no funds.
- CashXChain is called only for an approved fiat payout, only on the sandbox: the base URL is fixed
  and config refuses anything but `cxc_sk_sandbox_` / `cxc_rk_sandbox_` keys. Without the key the
  fiat rail is simulated and labeled. The seller's report keeps `payoutExecuted: false`: the report
  itself never pays anyone.
- Invoice payouts need a human approval per invoice, with the operator token, from the payment
  confirmation window (`GET /api/runs/:id/preview`: amount, source account or wallet, verified
  destination, check proof, budget line). Payouts are capped per payout and per session.
- **Chat (`POST /api/chat`, `src/chat.ts`):** Claude with functions over the agent:
  `get_balances`, `list_invoices`, `get_invoice`, `list_payees`, `prepare_payment`,
  `submit_invoice`. None of them approves or pays: `prepare_payment` builds the same preview and
  asks the browser to open the confirmation window, and only the human's click there approves.
  `submit_invoice` accepts only text that appears in a user message of the conversation (so a
  tool result or an injected document cannot start a paid check) and goes through the same gate
  as `POST /api/runs`. Function results with invoice data are marked as untrusted content; the
  raw invoice text is never returned to the model. Chat has its own limits (20 messages per minute
  per client, 300 per hour) and answers 503 without `ANTHROPIC_API_KEY`, in which case the UI uses
  its rule-based answers.
- Route, fees and FX are `demo-fixture` and labeled "Simulated route/fees".
- The report is a data-quality and routing check, not an AML, sanctions or KYB decision.

## Payment safety

- **Idempotency:** the seller handler runs after verify and before settle and can be retried.
  Requests carry `Idempotency-Key` (the run id); the same key returns the cached report. Run ids
  are public (`GET /api/runs`), so the key is bound to the invoice: a key reused for a different
  invoice gets 409 from the handler (no settle), and the agent refuses a report whose
  `invoiceFingerprint` is not the run's.
- **Duplicates:** a different key for the same supplier + invoice id + currency + amount is
  flagged `duplicate` and the verdict is `blocked`.
- **In-flight hold:** `SpendLedger.reserve()` checks and holds budget + invoice in one step
  before signing, so concurrent runs (double click, client retry) cannot both pay. The hold is
  released only if signing itself threw; otherwise it becomes paid or unknown.
- **One payment per wallet at a time:** `BuyerAgent` queues the pay step (402 -> sign -> settle)
  per buyer wallet. Two signers reading the same UTxO set could spend the same input; both would
  pass verify and the second broadcast would fail after signing. Runs wait in `PRECHECKED` for
  their turn. Settle waits for block inclusion, so the next payment sees the updated UTxO set. Use a
  separate buyer wallet per deployment (laptop vs cloud) for the same reason.
- **Settle depth (A8):** the deployment sets `CARDANO_L1_CONFIRMATIONS=0` (`wrangler.jsonc` vars):
  settle reports success on canonical block inclusion (`@x402/cardano` README), inside the hosted
  facilitator's range [0, 20]. With the default 1, settle took 32.4 s once and hit an nginx 504
  after ~65 s once (A7). Trade-off: a one-block rollback could undo a paid report; fine on testnet,
  revisit before mainnet.
- **Wallet sync:** before the next wallet tx (report payment or invoice payout), the queue waits
  until Blockfrost has indexed the previous one (`GET /txs/{hash}`, up to 90 s), plus 30 s after it
  settled for other indexers such as the hosted facilitator's. A7 (2026-10-30) showed why: a payment
  built ~27 s after the previous block was rejected at verify. Every tx that was or may have been
  broadcast is waited for: a request that died after signing, a failed settle (including A7's 504
  with an empty hash, where the tx still landed) and a settle "success" without a hash. Only a
  verify rejection (HTTP 402 without `PAYMENT-RESPONSE`) is skipped; `@x402/core` sets that header
  on every settle failure, network errors included.
- **SETTLEMENT_UNKNOWN:** if anything fails after the buyer signed a transaction, the tx may
  already be on-chain. The run moves to `SETTLEMENT_UNKNOWN`, the amount counts against the
  budget, and the invoice is locked against re-payment until resolved. This includes verify
  rejections (the seller holds the signed tx), a settle "success" without a tx hash, and a settle
  "success" for a hash other than the tx we signed (our own tx is then the one looked up).
  `run.settlement = { transactionHash?, explorerUrl?, reason }` says what to look up before anyone
  pays again. The hash comes from the settle response, or else from decoding the tx we signed, so
  a lost response still leaves an explorer link.
- **Reconciliation from chain evidence** (`BuyerAgent.reconcile`): for a `SETTLEMENT_UNKNOWN` or a
  Cardano `PAYOUT_UNKNOWN` with a known tx hash, a background check polls Blockfrost every 15 s for
  up to 20 min (outside the wallet queue).
  - Tx on chain with an output of exactly the signed amount to the expected address
    (`GET /txs/{hash}/utxos`, collateral outputs ignored): report fee -> `FAILED` with an on-chain
    payment proof, counted once, invoice locked as paid (the report itself was never delivered);
    payout -> `EXECUTED`, `status: "confirmed"`.
  - Outputs that do not match: stays unknown with a timeline note; a human checks.
  - Proven expired: only for the tx we signed ourselves, when its validity end (TTL) is at least
    600 slots (~10 min) behind Blockfrost's latest block and the tx is still not indexed. The tip
    is read before the tx lookup, so a tx indexed in between counts as paid. Report fee ->
    `FAILED`, refunded, invoice unlocked; payout -> `DRAFT_READY`, approve again. This rests on the
    ledger rule (no tx lands at or after its TTL) and a ~30-block rollback margin, not on Cardano's
    formal 2160-block finality.
  - Fiat `PAYOUT_UNKNOWN` is not reconciled automatically: `run.payout.reference` keeps the
    CashXChain payout id when one exists, and the label names the `Idempotency-Key`.
- **Paid without a usable report:** if settle succeeded but the body is not a well-formed report
  (not JSON, or no valid verdict/checks) or is a report for another invoice, the run ends `FAILED`
  with the payment proof kept and the invoice locked as paid. It is a failed delivery, not a free
  retry.
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
- **Who may decide (fail-closed):** `POST /api/runs/:id/approve|reject` needs
  `Authorization: Bearer <token>` (or `X-Approve-Token`) matching `APPROVE_TOKEN`, compared in
  constant time; 401 otherwise. Without `APPROVE_TOKEN` approvals are disabled: 503
  `approvals disabled: APPROVE_TOKEN not configured`. `/api/health` reports
  `approvals: "operator-token" | "disabled"` (and `approvalTokenRequired: true`) so the UI knows.
- **Fiat caps:** fiat payouts hold no lovelace, so they are capped separately:
  `FIAT_PAYOUT_MAX_MINOR` per payout (above it the route is `unavailable` and the draft stays for
  manual handling; not `blocked`, which is reserved for fraud signals), `FIAT_BUDGET_MINOR` total
  per currency (5,000.00 by default, per-currency overrides at runtime) and
  `FIAT_PAYOUTS_PER_SESSION` (payouts sent or possibly sent; a definitive refusal frees its slot and
  its amount). Defaults 1,000.00 and 5 keep the public demo under the CashXChain sandbox day limit
  (USD 5,000).
- **Runtime budgets (`GET/PUT /api/budget`):** the operator token holder can change the check
  budget, the Cardano per-payout max and total, the fiat per-payout max, the fiat total per
  currency and the fiat payout count. Values above `HARD_MAX` (100 tADA checks, 100 tADA per payout,
  500 tADA total, 2,500.00 per fiat payout, 5,000.00 per currency, 50 payouts) are refused with 400.
  `approve()` derives the route again with the current limits: a click the limits refuse returns
  409 with the reason and keeps the draft; a draft held back by a cap becomes payable once the cap
  is raised (same directory, same payee).
- **Source account (fiat):** CashXChain pays from the first active account in the invoice currency
  (`sourceFor` in `src/payout-cashxchain.ts`); the preview shows that account and its available
  balance and warns when the balance is below the amount (CashXChain would refuse: nothing paid).
- The payout ledger reserves the invoice before signing and releases it only if signing threw.
- A definitive node rejection before broadcast (Blockfrost `submitTx` HTTP 400, e.g. a spent
  input) returns the run to `DRAFT_READY` with the hold released: nothing was sent, approve again.
  The SDK's reference signer does not implement `isDefinitiveSubmissionRejection`, so the classifier
  is ours and deliberately narrow (to be confirmed live).
- Any other error after signing: `PAYOUT_UNKNOWN`, amount counted, invoice locked, `run.payout`
  carries the signed tx hash for the explorer. Same for an error from a fiat client, which may have
  accepted the payout before failing.
- A Blockfrost wait timeout after broadcast is `EXECUTED` with `payout.status: "submitted"`.
- Payouts are keyed per invoice from verified inputs only: `payoutKey` = directory payee name,
  invoice id without case/spaces/punctuation, currency, amount. Extracted supplier text varies
  between runs, so the run fingerprint is not used. The key drives the payout ledger (one payout
  per invoice per process) and the fiat `Idempotency-Key: payout-<key>`, so a retry or a new run
  after a restart replays at CashXChain instead of paying again. Cardano payouts are protected
  only in memory: a restart forgets them (known limitation). The client gets the verified payee
  record (name, IBAN/BIC or routing/account/type), never text from the invoice. A client that
  proves nothing was sent (`isDefinitiveRejection`) returns the run to `DRAFT_READY`; any other
  error stays `PAYOUT_UNKNOWN`.
- CashXChain route (`src/payout-cashxchain.ts`): source account in the invoice currency,
  beneficiary from the payee record, `POST /v1/banking/payouts` under the agent's key, polled to
  a final status. `reference` is `payoutKey`'s normalized invoice id (lower-cased, letters and
  digits only), then upper-cased, so every id variant behind one key sends the same body.
  - **Refused** (`isDefinitiveRejection`, nothing paid): any failure before the payout POST; on the
    POST, only `corridor_unsupported`, `plan_limit_exceeded` and `insufficient_balance`; and the
    final statuses `failed` /
    `cancelled`. **Deviation from the payout contract**, agreed with workstream A: the contract
    listed `failed`/`cancelled` as unknown; CashXChain documents both as "did not happen", and a
    same-key retry after `insufficient_balance` replays `failed`, so such an invoice stays
    refusable and cannot pay (CashXChain wants a new key for that, which we do not mint).
  - **Unknown** (locked): 5xx, timeout or network on the POST; any 409 (a payout exists under the
    key); 429 (recorded as `created`); every other 4xx; `created` after polling; `returned`;
    polling errors.
  - **Why the 4xx split** (CashXChain backend `http/banking/payouts.rs`): a replay of a key re-runs
    the verification, account-hold, beneficiary/account-ownership and payee-name checks before it
    finds the stored payout, so a 403/404/422 from those can hide a payout that already settled,
    e.g. one sent before a restart. Corridor and plan-limit checks run only on a first attempt,
    and a funds refusal replays as 200 `failed`, so those three codes prove nothing exists under
    the key. Keys never expire (`idempotency.md`: "stays bound to that transaction").
- Payouts go through the same wallet queue as report payments (one tx in flight per wallet).

## Public endpoint limits

`POST /api/runs` starts a model call and possibly a paid request, so it is gated before either
(`src/ratelimit.ts`), in this order: 400 (no input), 413 (free text over `MAX_TEXT_CHARS`,
default 20,000; structured invoice JSON is exempt), 429 (fixed windows:
`RUNS_PER_MINUTE_PER_CLIENT` 10 per client IP, `RUNS_PER_HOUR` 120 overall; `Retry-After` set),
503 (store full), else 202. Refused requests count against nothing. The client is identified by
`CF-Connecting-IP`, else the first `X-Forwarded-For` entry, else the socket; `/api/health` reports
which one under `limits.clientIdFrom`. `RunStore` keeps at most `MAX_RUNS` (500): settled runs are
evicted first (oldest first), then parked ones (`DRAFT_READY`, `*_UNKNOWN`), never in-flight ones.
An evicted run disappears from the UI, but the spend and payout ledgers still block paying its
invoice twice.

## Readiness checks

| Check | Source | Logic |
| --- | --- | --- |
| account | deterministic | IBAN mod-97 + country length; BIC format + country; ABA routing checksum; Cardano address bech32 checksum, `addr_test1` prefix, key credential |
| corridor | demo-fixture | destination country + currency in the demo corridor table; the fail message names a currency mismatch for a served country |
| required_fields | demo-fixture | per corridor (SEPA: IBAN; US: routing + account; AE: IBAN + BIC; ADA: Cardano address) |
| duplicate | deterministic | fingerprint ledger keyed by Idempotency-Key |
| amount | deterministic | demo ceiling |
| quote | demo-fixture | simulated fee / FX / ETA |
| reference | deterministic | informational, always `pass`: payment reference present, or reconcile by invoice id |

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

- No live payout is recorded in `evidence/` yet. `blockfrostSubmitter` uses `@x402/cardano`'s provider-only
  `submitTransaction` (Blockfrost `/tx/submit`, then evolution `awaitTx` with a 120 s timeout),
  read from the installed source and covered offline with a stub only.
- Whether Claude copies a 100+ character bech32 address exactly. A single wrong character fails
  the checksum and the run ends `NEEDS_INFO`, so this fails safe.
- CashXChain sandbox payouts are tested offline against a fake that follows the CashXChain docs
  and the backend's mock rail (`tests/fake-cashxchain.ts`), not yet against
  `api.sandbox.cashxchain.com`.
- With `LOCAL_FACILITATOR=true`, verify also calls Blockfrost `POST /utils/txs/evaluate/utxos`;
  untested against real Blockfrost for a script-free tx.
- Reconciliation against real Blockfrost: the `/txs/{hash}/utxos` body of a landed tx, a non-null
  `slot` from `/blocks/latest`, and an end-to-end resolution on the deployment (the remote scripts
  treat `SETTLEMENT_UNKNOWN` as final; fetch `/api/runs/:id` again within 20 min).
- Settle times with `CARDANO_L1_CONFIRMATIONS=0` on the hosted facilitator.
- That `CF-Connecting-IP` reaches the container (`/api/health` -> `limits.clientIdFrom` should be
  `cf-connecting-ip`). Judges on one conference Wi-Fi share one per-client quota.
- `EXPLORER_TX_URL` default (Cardanoscan preprod) to be confirmed with the first real tx, in a
  browser: Cardanoscan serves a Cloudflare challenge to scripts, so it cannot be checked automatically.
