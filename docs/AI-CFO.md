# PayFlow AI (AI CFO)

The product built on top of the hackathon payment engine. One app, one domain:

| Path | What |
| --- | --- |
| `/` | Marketing site |
| `/signup`, `/login` | Accounts (Better Auth, email + password) |
| `/app/*` | Dashboard: overview, AI CFO chat, documents, payments, budgets, payees, connections, agent access, activity, settings |
| `/demo`, `/about.html` | The hackathon demo of the invoice agent, unchanged |
| `/api/auth/*` | Better Auth |
| `/api/v1/*` | Dashboard API, session required. Contract: `web/src/dashboard/types.ts` |
| `/api/runs`, `/v1/payment-readiness` | Demo API and the x402-paid readiness API, unchanged |

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
  (`can_delegate_money`, staff-only) and grant scopes beyond the default; until then payouts keep
  using the platform's own sandbox account (`CASHXCHAIN_API_KEY`).
- Sandbox only: live keys are dropped at startup (`/api/health` → `cashxchain.refused`).
