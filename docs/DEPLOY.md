# Deploy: Cloudflare Worker + Container

The Node app runs in one Cloudflare Container. A Worker (`cloudflare/worker.ts`) routes every request
to the single named instance `"main"`, because runs and the spend ledger live in memory.

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
| `BETTER_AUTH_SECRET` | secret, AI CFO accounts: signs sessions (32+ random characters, `openssl rand -hex 32`). Unset: a random one per start | `npx wrangler secret put` |
| `PUBLIC_BASE_URL` | var | `vars` in `wrangler.jsonc`, after the first deploy |
| `LOCAL_FACILITATOR`, `PRICE_LOVELACE`, `MAX_PRICE_LOVELACE`, `SESSION_BUDGET_LOVELACE`, `MAX_PAYMENTS_PER_RUN` | var | `vars` in `wrangler.jsonc` |
| `FACILITATOR_URL`, `CARDANO_L1_CONFIRMATIONS`, `BLOCKFROST_PREPROD_URL`, `EXPLORER_TX_URL`, `DEMO_AMOUNT_CEILING_MINOR`, `CLAUDE_MODEL`, `ANTHROPIC_BASE_URL`, `DATA_DIR`, `CFO_AI_DAILY_LIMIT` | optional var | add to `vars` only to override the default in `src/config.ts` |

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
npx wrangler deploy
```

Live URL: **https://cxc-agentpay.cashxchain.workers.dev** (CashXChain account, pinned via `account_id`
in `wrangler.jsonc`). It is set as `vars.PUBLIC_BASE_URL`. If the URL changes, update it there and run
`npx wrangler deploy` again.

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
- AI CFO accounts and workspace data live in SQLite at `DATA_DIR/cfo.db` inside the container.
  Cloudflare Containers have **no persistent disk**: a redeploy or a sleep **deletes all accounts,
  documents and chats**. Fine for a demo; before real customers, move the store to Postgres or D1
  (Better Auth supports both; `src/cfo/store.ts` is the only data-access layer to port).
- `sleepAfter = "24h"`: after 24 h without requests the container stops, with the effect above.
  A running `basic` instance costs about $0.01 per hour beyond the plan's included usage.
- Before judging: one warm-up request to `/api/health`, then no redeploys and no secret changes.

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
