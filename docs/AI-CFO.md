# PayLorya AI (AI CFO)

The product built on top of the hackathon payment engine. One app, one domain:

| Path | What |
| --- | --- |
| `/` | Marketing site |
| `/signup`, `/login` | Accounts (Better Auth): email code by default, password optional |
| `/verify` | Enter the 6-digit email code (sign-up, login, email confirmation; only with `RESEND_API_KEY`) |
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

## What a customer can do

- **Connect** wallets and accounts:
  - The CashXChain agent wallet on Cardano Preprod (read & write).
  - A CashXChain account on the sandbox (read & write).
  - Any Cardano Preprod address (watch-only).
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
- **Shared wallet**: all workspaces share one agent wallet, and its platform caps apply to all of them.
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
- **Wallets by browser popup.** The Cardano and EVM watch-only connections offer "Connect Lace /
  Eternl / …" (CIP-30) and "Connect browser wallet" (EIP-1193, MetaMask). The wallet's permission
  popup hands over an address only; Cardano must be on a testnet (network id 0). The AI CFO reads
  balances and never signs from these wallets.
- **Not possible today:** a "Sign in with CashXChain" popup (the CashXChain auth portal is an OAuth
  client for Google/Apple/Microsoft, not an OAuth provider), and a platform creating CashXChain
  accounts for customers (attach-only by design, see above).
