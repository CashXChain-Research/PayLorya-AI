# PayLorya AI (AI CFO)

The product built on top of the hackathon payment engine. One app, one domain:

| Path | What |
| --- | --- |
| `/` | Marketing site |
| `/signup`, `/login` | Accounts (Better Auth): email code by default, password optional |
| `/verify` | Enter the 6-digit email code, or open it from the email button (sign-up, login, email confirmation; only with `RESEND_API_KEY`) |
| `/app/*` | Dashboard: overview, AI CFO chat, documents, payments, budgets, payees, connections, agent access, activity, settings |
| `/demo`, `/about.html` | The hackathon demo of the invoice agent, unchanged |
| `/api/auth/*` | Better Auth |
| `/api/v1/*` | Dashboard API, session required. Contract: `web/src/dashboard/types.ts` |
| `/api/runs`, `/v1/payment-readiness` | Demo API and the x402-paid readiness API, unchanged |

## Sign-up and login: email code first, password optional (Resend)

With `RESEND_API_KEY` set (`src/cfo/auth.ts`, `src/cfo/mail.ts`), PayLorya AI accounts work without a
password by default. Codes are mailed through Resend (`POST https://api.resend.com/emails`, sender
`RESEND_FROM`).

| Flow | Pages | API |
| --- | --- | --- |
| Sign up (default) | `/signup` (name, email) → `/verify` | `email-otp/send-verification-otp` type `sign-in`, then `sign-in/email-otp` with `name`: creates the account, signs in |
| Log in (default) | `/login` (email) → `/verify` | the same two calls |
| Sign up with a password (optional, "Add a password") | `/signup` → `/verify` | `sign-up/email`, then `email-otp/verify-email` (the address is confirmed before any session) |
| Log in with a password (optional, "Log in with a password instead") | `/login` | `sign-in/email`; an unconfirmed address answers 403 `EMAIL_NOT_VERIFIED`, mails a code and opens `/verify` |
| Add or change a password later | `/app/settings`, "Password" card | `POST /api/v1/me/password` `{password, currentPassword?}`; `/api/v1/me` reports `signIn: {password, codes}` |

- `GET /api/auth-options` → `{codes}` tells the pages whether codes can be delivered. Without
  `RESEND_API_KEY` it is `false` and both pages fall back to email + password, as before.
- `/verify` gets the address (and the purpose and name) through `sessionStorage`, never the URL; a
  direct visit asks for the email. It keeps `?next`.
- Codes: 6 digits, valid 10 minutes, at most 5 wrong tries, stored hashed; a new code voids the
  old one; Better Auth limits the code endpoints to 3 per minute.
- A Resend error is logged and does not fail the request; the user asks for a new code.
- The mail shows the app icon (`PUBLIC_BASE_URL` + `/apple-touch-icon.png`) and, for sign-in and email
  confirmation, a button to `/verify#email=…&code=…&type=…`. The page reads the fragment (never sent
  to the server), drops it from the address bar and submits the code: one click signs in. The code is
  still in the mail for typing. Password reset and email change have no link.

## What a customer can do

- **Connect** wallets and accounts:
  - Their own Cardano Preprod wallet (read, or read & write: they sign each tADA payout in it).
  - Their own CashXChain sandbox account by API key (read & write).
  - The PayLorya AI agent wallet on Cardano Preprod (read-only: it pays the x402 verification fees).
  - Any EVM address, with balances on Ethereum, Base and Polygon mainnet (watch-only).
  - Bank accounts are listed as coming soon.
  - Each connection is Read-only or Read & write. Watch-only kinds cannot be switched to write.
- **Upload any financial document**: PDF, photo, CSV or text. Invoices, receipts, bank and card
  statements, contracts, payroll and tax documents all work.
  - Claude reads each one into structured data: kind, counterparty, amounts, dates, category, payment
    details, line items and statement entries. Those become ledger entries.
  - If a document contains instructions, Claude reports them as notes and does not follow them.
- **Chat with the AI CFO**, with files and photos attached. It answers from real workspace data
  through tools: the overview, documents, transactions, open invoices, the cash forecast, budgets,
  payees, payments and its own permissions.
  - It can create and update budgets.
  - It can draft payments. It cannot approve them, add payees, or change limits, autonomy or access.
- **Plan**:
  - Monthly budgets per category, with this month's spend.
  - A six-month in/out view and spend by category.
  - A cash forecast: connected balances, minus open payables on their due dates, plus open receivables.
- **Pay** through the existing payout engine:
  - A paid x402 verification report first.
  - Then a route to the verified payee, using this workspace's payee directory only.
  - Then the payout within the platform caps: tADA on Preprod, or fiat on the CashXChain sandbox.
- **Control the agent** with an autonomy level:
  - **Read-only**: analyses, plans and drafts. Every payment waits for approval.
  - **Guarded** (default): executes on its own only within a per-payment limit, a monthly limit, and
    known payees. Everything else waits for approval.
  - **Full access**: executes without approval. It still needs a known payee when that rule is on.
    Enabling it requires typing `FULL ACCESS`.
  - With any level, a payment is blocked when no Read & write connection exists for its rail.
  - The policy is `src/cfo/policy.ts`. It is deterministic and unit-tested.
- **Audit**: every action is in the activity log, whether the user, the agent or the system took it.

## Architecture

```
src/cfo/
  sql.ts          storage interface: D1 + R2 via the Worker (Cloudflare), SQLite + folder (local)
  db.ts           schema migrations (same SQL on D1 and SQLite)
  auth.ts         Better Auth on the same database
  store.ts        all data access, scoped by workspace
  policy.ts       agent permission policy (pure)
  ingest.ts       Claude document reading (structured output) to the ledger
  chat.ts         streaming tool loop (SSE) and the tool implementations
  payments.ts     draft, approve, reject, execute through BuyerAgent runs
  connections.ts  catalog and live balances (Blockfrost, public EVM RPCs, CashXChain)
  analytics.ts    overview, budgets, forecast
  api.ts          Express routes
```

- CFO payments use their own `RunStore`, so they never appear in the public demo inbox.
- `Run.payees` passes the workspace's payee directory to the payout engine. That is the only change
  to `src/agent.ts`.

## Limits and honest notes

- **Storage**: D1 for data and R2 for files, durable across deploys. The container reaches them through
  the Worker's outbound handler (`cloudflare/cfo-proxy.ts`), so no Cloudflare API token is involved.
  The R2 bucket was created without an EU jurisdiction; recreate it with `--jurisdiction eu` before
  storing customer documents.
- **Money**:
  - tADA is testnet money.
  - CashXChain payouts are sandbox payouts, or simulated when no key is set.
  - USD figures use fixed indicative rates (`src/cfo/fx.ts`), not market data. tADA has a nominal
    rate only, so that USD limits also constrain tADA payments.
- **Shared agent wallet for fees only**: the x402 verification fees of all workspaces come from one
  agent wallet, and the agent's platform caps (session payout limits and budgets) apply to all
  workspaces together. Payouts leave from each workspace's own wallet or account.
- **Cost guard**: `CFO_AI_DAILY_LIMIT` caps model calls (documents and chat messages) per workspace
  per day. The default is 150.
- **Not advice**: reports are financial analysis, not tax, legal or investment advice, and they are
  not an AML or KYB decision.

## CashXChain sub-accounts (sandbox)

With `CASHXCHAIN_MASTER_KEY` (a sandbox platform master key, `cxc_mk_sandbox_…`), every AI CFO
account gets a CashXChain sub-account: a [Platform managed account](https://docs.cashxchain.com/docs/api/platform).
`src/cfo/cxc-link.ts`.

- CashXChain cannot create an account for someone. The business signs up at
  `auth.sandbox.cashxchain.com/register` itself and signs in once; the platform then attaches it by
  email (`POST /v1/accounts`). So on its first request a new workspace is attached with the owner's
  sign-in email. Without a CashXChain account under that email the link waits as `needs_signup`
  (or `needs_signin` / `other_platform`); the Connections page explains it and offers "Link now".
- Linked: the workspace's CashXChain connection reads the sub-account's own accounts and balances
  (`Cxc-Account` header). `GET /api/v1/cashxchain`, `POST /api/v1/cashxchain/link`.
- Payouts from a sub-account need CashXChain's money permission on the master key
  (`can_delegate_money`, staff-only) and grant scopes beyond the default. Until then a linked
  workspace pays out only with its own API key (below).
- Sandbox only: live keys are dropped at startup (`/api/health` → `cashxchain.refused`).

## Your own CashXChain account and wallets

A workspace uses its own accounts (Connections page). PayLorya AI's shared sandbox account
(`CASHXCHAIN_API_KEY`) serves the public demo only: no workspace reads its balances or pays from it.

- **CashXChain by API key (required).** Adding the CashXChain connection needs the workspace's own sandbox
  key (`cxc_sk_sandbox_…`, or `cxc_rk_sandbox_…` with `accounts:read`; to pay, also
  `payments:read`, `payments:write` and `beneficiaries:write`). The server checks it against
  CashXChain (`GET /v1/banking/accounts`) before storing it. Live keys are refused.
- **Stored sealed.** AES-256-GCM, key derived from `BETTER_AUTH_SECRET` by HKDF, bound to the
  workspace (`src/cfo/vault.ts`, `src/cfo/cxc-keys.ts`). The API returns only a hint
  (`cxc_sk_sandbox_…LzQb`). Rotating `BETTER_AUTH_SECRET` makes stored keys unreadable: the
  connection shows an error and the owner connects the key again. Without `BETTER_AUTH_SECRET`
  own keys are refused.
- **Balances and payouts use that key.** An approved fiat payment of a workspace whose read & write
  CashXChain connection carries a key leaves from that account (`BuyerAgent.useFiatRoute`). If the
  key cannot be opened, the payment fails; it never falls back to the shared account.
- **Without a key** a CashXChain connection is allowed only for a linked sub-account, and it only
  reads. A key-less connection made before keys were required shows an error and cannot pay
  (`NEEDS_OWN_KEY`); remove it and connect again with the key.
- **Wallets by browser popup.** The Cardano and EVM connections offer "Connect Lace / Eternl / …"
  (CIP-30) and "Connect browser wallet" (EIP-1193, MetaMask). The wallet's permission popup hands
  over an address only; Cardano must be on a testnet (network id 0).
- **tADA payouts from the workspace's own wallet (required).** They leave only from a Cardano
  wallet connected with read & write; the agent wallet never pays a workspace's payout, and an old
  read & write connection to it no longer counts (`NEEDS_OWN_WALLET`). Nothing holds the
  customer's keys, and every step is stored, so a restart (a deploy, the container waking up)
  loses nothing:
  1. **Check on Cardano.** On approval the agent buys the x402 verification report on Cardano
     Preprod (agent wallet pays the fee) and routes to the verified payee. The payment then waits
     in `awaiting_signature`, with `cardano: {from, payTo, lovelace, verification}`; the report's
     transaction is linked on the payment.
  2. **Built from the wallet's funds, on click.** "Sign with Lace / Eternl" opens the wallet
     (CIP-30), which must hold the connected address, and sends its `getUtxos()` and change address
     to `POST /api/v1/payments/:id/transaction`. The server builds a plain lovelace transfer to the
     stored payee, change back to the wallet, valid 10 minutes (Evolution SDK, protocol parameters
     from Blockfrost; `src/cfo/wallet-signer.ts`). Funds on any address of the wallet count. Too
     little tADA is refused before anything is built.
  3. **Signed in the wallet.** The wallet shows payee, amount and fee; `signTx(cbor, true)`.
  4. **Sent.** `POST /api/v1/payments/:id/signature` `{txHash, witnessSet}`: the server splices the
     witnesses in without touching the body (`Transaction.addVKeyWitnessesHex`), claims the payment
     (one send per payment), records the transaction, then submits it to Blockfrost.
     - Accepted: `executed`, with transaction and explorer link.
     - Refused by the node (400): nothing was sent; back to `awaiting_signature`, sign again.
     - No answer: stays `executing` with the transaction recorded; the sweep settles it.
  5. **Followed to its block.** `Payments.sweep()` (at start and every minute) marks a sent payout
     `confirmedAt` once Blockfrost has it in a block, and puts one that expired unconfirmed back to
     signing (nothing was sent).
  - `{declined: true}` (Cancel): `rejected`, nothing sent.
- **Payments cut off by a restart** (any rail): one in `executing` that no execution in this
  process owns goes back to `pending_approval` with a note (`INTERRUPTED`). A verification that
  does not finish within 5 minutes goes back the same way (`CHECK_TIMED_OUT`); nothing is paid
  before it. Approving it again
  continues it under the same idempotency key, fixed at the first attempt (`payments.payout_key`):
  CashXChain replays the payout instead of paying twice, and a changed payee or amount is refused.
- **Not possible today:** a "Sign in with CashXChain" popup (the CashXChain auth portal is an OAuth
  client for Google/Apple/Microsoft, not an OAuth provider), and a platform creating CashXChain
  accounts for customers (attach-only by design, see above).
