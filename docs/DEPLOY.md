# Deploy: Cloudflare Worker + Container

The Node app runs in one Cloudflare Container. A Worker (`cloudflare/worker.ts`) routes every request
to the single named instance `"main"`, because runs and the spend ledger live in memory.

Static files are not routed there: `assets` in `wrangler.jsonc` uploads `public/` with each deploy, and
Cloudflare's edge serves every request that matches a file (HTML, CSS, JS, fonts, images; compressed,
with ETags) without touching the Worker or the container. `/login` is served from `login.html`
(`html_handling: auto-trailing-slash`). Requests that match no file go to the Worker and the container.
`run_worker_first` sends some paths to the Worker even when a file matches: `/app` and `/app/*` (the
server's login redirect, although `public/app.html` exists) and the API prefixes. A new server route
whose path also exists as a file in `public/` must be added there, or the edge serves the file instead
(`tests/edge-assets.test.ts` checks the current ones).

Verified against `wrangler` 4.156.0 and `@cloudflare/containers` 0.3.7 (installed source and current
Cloudflare docs, 2026-10-30). `wrangler deploy --dry-run` passes with this config.

## Prerequisites

- Cloudflare account on the **Workers Paid** plan (Containers are not available on Free).
- Docker running locally. `wrangler deploy` builds `./Dockerfile` and pushes it to the Cloudflare
  registry.
- `npm ci`, then `npx wrangler login` and `npx wrangler whoami`.
- From workstream A: the **buyer-cloud** mnemonic (funded with tADA), the seller address, a Blockfrost
  preprod project id for the cloud, and the facilitator mode. Get them via password manager or Signal
  only.

## Config

| Name | Kind | Where |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | `npx wrangler secret put` |
| `BLOCKFROST_PROJECT_ID` | secret (cloud project) | `npx wrangler secret put` |
| `BUYER_MNEMONIC` | secret (**buyer-cloud** wallet) | `npx wrangler secret put` |
| `SELLER_ADDRESS` | secret | `npx wrangler secret put` |
| `CASHXCHAIN_API_KEY` | secret, optional: CashXChain **sandbox** key for fiat payouts (see below) | `npx wrangler secret put` |
| `APPROVE_TOKEN` | secret, **required for approvals** (fail-closed): only requests carrying it may approve or reject a draft; unset, approve/reject answer 503 and `/api/health` shows `approvals: "disabled"` | `npx wrangler secret put` |
| `CASHXCHAIN_MASTER_KEY` | secret, optional: CashXChain **sandbox** platform master key (`cxc_mk_sandbox_…`). Every new AI CFO account is attached as a CashXChain sub-account (managed account) by its sign-in email; the owner must have a CashXChain sandbox account with that email and have signed in once. Mint it in the sandbox developer console (dev.sandbox.cashxchain.com, API keys, Platform keys). Live keys (`cxc_mk_live_…`) are dropped at startup with a reason in `/api/health` (`cashxchain.refused`), never a crash | `npx wrangler secret put` |
| `BETTER_AUTH_SECRET` | secret, AI CFO accounts: signs sessions (32+ random characters, `openssl rand -hex 32`). Unset: a random one per start | `npx wrangler secret put` |
| `GOOGLE_CLIENT_ID` | "Continue with Google" (Google Cloud → OAuth client, Web application; redirect URI `https://paylorya.valentin.is/api/auth/callback/google`). Unset: no Google button | variable |
| `GOOGLE_CLIENT_SECRET` | secret of that OAuth client | `npx wrangler secret put` |
| `STRIPE_PUBLISHABLE_KEY` | "Bank account" via Stripe Financial Connections (read-only balances). `pk_test_…` or `pk_live_…`; live needs the Financial Connections registration in the Stripe Dashboard | variable |
| `STRIPE_SECRET_KEY` | matching `sk_test_…` / `sk_live_…` (or a restricted key with Customers write and Financial Connections write) | `npx wrangler secret put` |
| `RESEND_API_KEY` | secret, optional: Resend key. Set: sign-up and login use a 6-digit email code, a password is optional. Unset: email + password, as before | `npx wrangler secret put` |
| `RESEND_FROM` | var, optional: sender, default `PayLorya AI <no-reply@mail.valentin.is>`. Must be on a domain verified in that Resend account, or Resend refuses every send | `vars` in `wrangler.jsonc` |
| `PUBLIC_BASE_URL` | var | `vars` in `wrangler.jsonc`, after the first deploy |
| `LOCAL_FACILITATOR`, `PRICE_LOVELACE`, `MAX_PRICE_LOVELACE`, `SESSION_BUDGET_LOVELACE`, `MAX_PAYMENTS_PER_RUN` | var | `vars` in `wrangler.jsonc` |
| `FACILITATOR_URL`, `CARDANO_L1_CONFIRMATIONS`, `BLOCKFROST_PREPROD_URL`, `EXPLORER_TX_URL`, `DEMO_AMOUNT_CEILING_MINOR`, `FIAT_PAYOUT_MAX_MINOR` (1,000.00), `FIAT_PAYOUTS_PER_SESSION` (5), `FIAT_BUDGET_MINOR` (5,000.00 per currency), `CLAUDE_MODEL`, `ANTHROPIC_BASE_URL`, `DATA_DIR`, `CFO_AI_DAILY_LIMIT` | optional var | set in the dashboard (Variables and Secrets, type Text) or in `vars`; dashboard values survive deploys (`keep_vars: true`) |
| `RUNS_PER_MINUTE_PER_CLIENT` (10), `RUNS_PER_HOUR` (120, all clients together), `MAX_TEXT_CHARS` (20,000), `MAX_RUNS` (500) | optional var: limits for the public `POST /api/runs` (`src/ratelimit.ts`); `/api/health` shows the effective values under `limits` | add to `vars` only to override the default in `src/config.ts` |

Every key in `src/config.ts` (except `PORT`) is forwarded into the container by `cloudflare/env.ts`.
`tests/cloudflare-env.test.ts` fails if the two drift apart. When you add a config key, add it there.

How it reaches the process: the Durable Object constructor sets `this.envVars` from the Worker env
(secrets and vars), and `@cloudflare/containers` passes `envVars` to the container on **start**. A
running container keeps its env, so a changed secret only applies after the container restarts (a
redeploy or sleep).

Instance: `instance_type: "basic"` (1/4 vCPU, 1 GiB). The default `lite` has 256 MiB, and the app idles
at about 165 MiB in Docker before it loads a wallet or pays.

## Deploy

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BLOCKFROST_PROJECT_ID
npx wrangler secret put BUYER_MNEMONIC
npx wrangler secret put SELLER_ADDRESS
npx wrangler secret put CASHXCHAIN_API_KEY   # optional: real CashXChain sandbox payouts
npx wrangler secret put APPROVE_TOKEN        # required for approve/reject (UI asks for it); unset = approvals disabled
npx wrangler deploy
```

Live URL: **https://paylorya.valentin.is** (CashXChain account, pinned via `account_id` in
`wrangler.jsonc`). It is set as `vars.PUBLIC_BASE_URL`; `vars.AUTH_TRUSTED_ORIGINS` keeps sign-in working on
https://cxc-agentpay.cashxchain.workers.dev too. If the URL changes, update it there and run `npx wrangler deploy` again.

The domain is a Cloudflare for SaaS custom hostname on the `cashxchain.ai` zone (valentin.is stays in its own
account): `paylorya.valentin.is` CNAME → `paylorya-origin.cashxchain.ai` (fallback origin, `AAAA 100::`, proxied),
plus the Worker route `paylorya.valentin.is/*` → `cxc-agentpay` on `cashxchain.ai`. Without that route Cloudflare
answers 522; zone-wide redirect rules on `cashxchain.ai` must exclude the hostname.

Alternative to `wrangler secret put`: after the first deploy, add the secrets in the dashboard under
Workers & Pages → `cxc-agentpay` → Settings → Variables and Secrets, type **Secret**. Secrets survive
`wrangler deploy`; plain variables added in the dashboard do not (deploy replaces them with `vars`).
Redeploy afterwards so the container restarts with the new env. The first container start after a deploy can take
a while; retry `/api/health` until it answers.

### CashXChain sandbox payouts

Without `CASHXCHAIN_API_KEY`, an approved fiat invoice uses the simulated stand-in (no API call).
With it, approval sends `POST /v1/banking/payouts` to `https://api.sandbox.cashxchain.com`
(`src/payout-cashxchain.ts`). The base URL is fixed, and the server refuses to start with anything
other than a `cxc_sk_sandbox_` / `cxc_rk_sandbox_` key.

- The sandbox account needs an active account in the invoice currency (EUR for the samples) with test
  funds: app.sandbox.cashxchain.com → Accounts → Get test funds. API keys cannot call the faucet.
- Free plan limits: USD 2,500 per payout, 5,000 per day, 10,000 per month. Over a limit, CashXChain
  refuses the payout and nothing is sent; the samples stay below it.
- `/api/health` reports `cashxchain.ready: true`. An approved EUR sample ends `EXECUTED`, with the
  CashXChain payout id in `run.payout.reference`. Check it in app.sandbox.cashxchain.com.

## Verify

1. **Health:** `curl -s <live>/api/health` shows `x402Ready: true`, `aiReady: true`, the buyer-cloud
   address and the seller address.
2. **AT1, the 402 offer:**
   ```bash
   curl -si -X POST <live>/v1/payment-readiness -H 'content-type: application/json' -d '{}'
   ```
   HTTP 402 with a `PAYMENT-REQUIRED` header: `exact`, `cardano:preprod`, `lovelace`, amount `2000000`,
   payTo = seller. Or run the repo checks (a shell variable overrides `.env`):
   ```bash
   PUBLIC_BASE_URL=<live> npm run preflight
   ```
   With a local `.env` that holds `buyer-local`, the `seller health` check fails on `buyerAddress`.
   That is expected. Everything else must pass.
3. **AT8, a long paid request:** `PUBLIC_BASE_URL=<live> npm run smoke:x402`. This pays 2 tADA from the
   laptop's buyer wallet to the deployed seller, and must exit 0. Cloudflare documents no wall-clock
   limit for HTTP Workers or Durable Objects while the client stays connected, so a 1-4 minute settle
   should pass. Node's `fetch` gives up after 300 s without response headers.
4. **AT3, a full agent run:** open `<live>`, run the SEPA sample, wait for `DRAFT_READY` with a tx hash.
   This pays from the buyer-cloud wallet. The agent reaches the seller through `PUBLIC_BASE_URL` (a
   hairpin through Cloudflare; containers have internet access by default).

## Lifecycle limits (known limitation)

- One instance (`max_instances: 1`, name `"main"`). Demo runs and spend ledgers are in memory.
- AI CFO data is durable: accounts and records in **D1** (`cxc-ai-cfo`), uploaded files in **R2**
  (`cxc-ai-cfo-documents`). Both survive redeploys and sleeps. The container reaches them through the
  Worker's outbound handler at `http://cfo-data.internal` (`cloudflare/cfo-proxy.ts`); that host is not
  reachable from the internet. Schema migrations run on container start (`src/cfo/db.ts`).
- `sleepAfter = "24h"`: after 24 h without requests the container stops; demo runs (in memory) reset,
  AI CFO data does not. A running `basic` instance costs about $0.01 per hour beyond included usage.
- Before judging: one warm-up request to `/api/health`, then no redeploys and no secret changes.
  Static pages load from the edge even while the container starts; `/app` and the APIs wait for it.
  Requests for static files do not count as container activity for `sleepAfter`.

## AI CFO data (D1 + R2)

Created once in the CashXChain account and bound in `wrangler.jsonc` as `CFO_DB` and `CFO_FILES`:

```bash
npx wrangler d1 create cxc-ai-cfo
npx wrangler r2 bucket create cxc-ai-cfo-documents
```

Inspect data: `npx wrangler d1 execute cxc-ai-cfo --remote --command "SELECT email, createdAt FROM user"`.
Locally (no `CFO_DATA_URL`) the app uses SQLite and a folder under `DATA_DIR` instead.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `x402Ready: false` | One of `SELLER_ADDRESS`, `BUYER_MNEMONIC`, `BLOCKFROST_PROJECT_ID` is missing. `npx wrangler secret list`, then redeploy so the container restarts |
| Secret changed but no effect | The container still runs with the old env. Redeploy |
| 500 on `/v1/payment-readiness` | The seller could not fetch `/supported` from the facilitator. Check `FACILITATOR_URL` or switch to `LOCAL_FACILITATOR=true` |
| Container crash or out of memory | `npx wrangler tail`, and the container logs in the dashboard. Raise `instance_type` |
| Payment fails with a UTxO conflict | The same buyer wallet signs somewhere else. Use `buyer-cloud` only in the cloud |
| Runs disappeared | The container slept or was redeployed. See lifecycle limits |

## Fallback: Cloudflare Tunnel

Use this if Containers is blocked for more than about 2 hours.

```bash
npm start
```

```bash
cloudflared tunnel --url http://localhost:8787
```

Set `PUBLIC_BASE_URL` in `.env` to the printed `https://<random>.trycloudflare.com` URL and restart the
app. Limits from the Cloudflare docs: no uptime guarantee, the hostname changes on every start, and
200 in-flight requests. Not verified yet: whether long paid requests (1-4 min) pass the tunnel. Run
`npm run smoke:x402` through it before relying on it on stage.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, the Worker typecheck
(`npx tsc -p cloudflare`) and `npm test` on every PR and on `main`. It does not deploy and holds no
secrets.
