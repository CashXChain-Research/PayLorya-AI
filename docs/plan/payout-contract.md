# Payout contract (decision A: Approve pays the invoice)

For the sessions building the **CashXChain route** and the **UI**. Owner of the payout core:
workstream A (`src/payout.ts`, `src/vendors.ts`, `src/agent.ts`, `src/policy.ts`, `src/runs.ts`).
Please do not change those files; ask for changes instead.

## Flow

```
invoice -> Claude extracts fields -> precheck -> x402: buy readiness report (2 tADA, Cardano Preprod)
  -> DRAFT_READY (draft.executable says whether Approve can pay)
  -> human clicks Approve -> POST /api/runs/:id/approve
  -> PAYING_OUT -> PAID_OUT | PAYOUT_FAILED (nothing sent, can approve again) | PAYOUT_UNKNOWN (locked)
```

The payout destination always comes from **vendor master data** (`src/vendors.ts`), never from
invoice text:
- **Bank details or a Cardano address differ from master data:** the draft is not payable, because
  that is a possible invoice fraud.
- **The vendor is unknown:** the draft is not payable.
- **Route by vendor:**
  - `route: "cardano"` pays ADA invoices on Cardano Preprod from the buyer wallet.
  - `route: "cashxchain"` pays fiat invoices through the CashXChain sandbox.

## For the CashXChain session: implement a `PayoutRoute`

```ts
// src/payout.ts (exists)
interface PayoutRoute {
  readonly kind: "cardano" | "cashxchain";
  pay(request: PayoutRequest): Promise<PayoutResult>;
}
```

- **Files:** create `src/payout-cashxchain.ts` with `class CashXChainPayoutRoute implements PayoutRoute`
  (`kind = "cashxchain"`), plus `tests/payout-cashxchain.test.ts`. Keep it offline, with a local
  fake HTTP server.
- **Config:** add `CASHXCHAIN_API_KEY` (optional) to `src/config.ts` and `cloudflare/env.ts`; the
  drift test `tests/cloudflare-env.test.ts` checks that they match.
  - Accept only keys starting with `cxc_sk_sandbox_`.
  - The base URL is fixed to `https://api.sandbox.cashxchain.com`.
- **Request fields** (`PayoutRequest`):
  - `idempotencyKey` is stable per invoice: send it as `Idempotency-Key` on the payout POST.
  - `vendor.bank` (`iban`/`bic`, or `routingNumber`/`accountNumber`), `vendor.name`, `vendor.country`
    and `vendor.currency` come from master data.
  - `amountMinor` is in the invoice currency (EUR/USD: cents). The API wants a decimal string with
    exactly the currency's decimals.
  - Use `invoice.id` as `reference`; the production limit is 18 characters.
- **Call sequence** (docs: `CashXChain/public-docs` `docs/api/getting-started.md`, `payouts.md`):
  1. `GET /v1/banking/accounts`: find the source account in the invoice currency.
  2. `POST /v1/banking/beneficiaries` with an `Idempotency-Key` derived from the vendor id. Sandbox
     beneficiaries live in memory; re-registering with the same key returns the same id.
  3. `POST /v1/banking/payouts`, then poll `GET /v1/banking/payouts/{id}` until the status is final.
- **Mapping to the contract:**

  | CashXChain outcome | Return |
  |---|---|
  | `settled` | `{ route: "cashxchain", status: "settled", reference: <payout id>, simulated: true, completedAt }` |
  | Accepted but not yet final | `status: "submitted"` |
  | 4xx before the payout was accepted (`insufficient_balance`, `corridor_unsupported`, `plan_limit_exceeded`, validation errors) | `throw new PayoutRefusedError(<code>)`: nothing was sent |
  | Timeout or network error after the POST, 5xx, a `created` replay, `failed`/`returned` after acceptance | `throw new PayoutUnknownError(message, <payout id if known>)` |

- **Wiring:** in `src/server.ts`, pass the route to `new BuyerAgent(config, runs, undefined, { routes: { cashxchain: … } })`
  when the key is set. Workstream A wires the Cardano route the same way.
- **One-time setup by a human:**
  1. Sandbox account at `auth.sandbox.cashxchain.com/register`.
  2. Test funds at `app.sandbox.cashxchain.com` → Accounts → Get test funds.
  3. A Secret key from `dev.sandbox.cashxchain.com` → API keys, stored as the Cloudflare secret
     `CASHXCHAIN_API_KEY`.

## For the UI session: what to show and call

- **`run.draft`** (on `DRAFT_READY`):
  - `executable` is `true` when Approve can pay.
  - `payout`: `{ route, vendorId, payee }`. Show "Payee from vendor master data: <payee> via
    <route>".
  - `blockedReason`: when not payable, show it and disable Approve. Examples: vendor unknown,
    "… differs from vendor master data (possible invoice fraud)", route not configured.
- **Approve:** `POST /api/runs/:id/approve`.
  - `202 { id, state, payout }` means the payout started: poll `GET /api/runs/:id`.
  - `409 { error }` means it cannot be approved now: show the error.
  - `404` means the run was not found; `503` means the server is not configured.
- **`run.payout`:** `{ route, status: pending|settled|submitted|refused|unknown, vendorId, payee,
  amountMinor, currency, approvedAt, reference?, explorerUrl?, simulated?, completedAt?, reason? }`
  - Cardano: link `explorerUrl` (the invoice payout tx). This is the second tx hash next to the x402
    check payment in `run.payment`.
  - CashXChain: show `reference` (payout id) and a "Sandbox (simulated bank)" badge when
    `simulated`.
- **States to render:**

  | State | Show |
  |---|---|
  | `PAYING_OUT` | Spinner. Cardano waits for one block, about 20–60 s |
  | `PAID_OUT` | Done |
  | `PAYOUT_FAILED` | Nothing was sent: the reason, and Approve again |
  | `PAYOUT_UNKNOWN` | Red: "payment state unknown, invoice locked", plus the reference or link to check |
  | `FAILED` with `run.payment` | "Check was paid, but no usable report was delivered" |

- **Retire the client-side approvals:** the old `localStorage` approve/reject is replaced by the
  endpoint. Reject can stay client-side, since it only hides the draft.
- **Demo samples:** `crypto_ok` is an ADA invoice that is payable. `crypto_wrong_address` has the
  same vendor but a different address: blocked as possible fraud.

## Limits

- **ADA payouts:** at most `PAYOUT_MAX_LOVELACE` per invoice (default 5 tADA) and
  `PAYOUT_BUDGET_LOVELACE` per server session (default 20 tADA). In-memory state resets on restart.
- **Each invoice is paid out at most once.** A `PAYOUT_UNKNOWN` run stays locked until a human checks
  the reference.
- **`POST /api/runs/:id/approve` has no authentication yet.** Payouts can only go to registered
  vendors and are capped, but protect `/api/*` before judging (workstream C).
