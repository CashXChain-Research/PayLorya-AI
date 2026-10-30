# Workstream C: Cloudflare integration and deployment

| | |
| --- | --- |
| Owner | Valentin |
| Tool | Claude Code (on the laptop: needs Docker, `wrangler login`, network) |
| Branch | `feat/cloudflare` |
| Read first | `docs/plan/00-end-result.md`, `README.md` (deploy section), `wrangler.jsonc`, `cloudflare/worker.ts`, `Dockerfile`, `src/config.ts`, `src/server.ts` |
| Depends on | A (A9: buyer-cloud wallet, seller address, Blockfrost key, facilitator mode). Steps C1-C3 can start before that |
| Delivers to | everyone: the live URL. D: deploy docs |

## Goal

The full app runs publicly on Cloudflare:
- a Worker in front of one Cloudflare Container running the Node app
- the x402-paid endpoint, the agent API and the demo UI reachable at one URL
- a full agent run on the live URL ends `DRAFT_READY` with a real preprod tx

The deployment is documented so either founder can redeploy.

## Start

```bash
git checkout main && git pull && git checkout -b feat/cloudflare && npm ci
```

Prompt for Claude Code:

> Read `docs/plan/00-end-result.md` and `docs/plan/valentin-claude-code.md`. Work through C1-C12
> in order. Verify every Cloudflare API, config key and CLI flag against the current Cloudflare
> docs and the installed `wrangler` and `@cloudflare/containers` versions; do not assume. Ask me
> before `wrangler deploy`, before setting secrets, and before anything that costs money. Commit
> after each task.

## Tasks

### C1. Prerequisites

- Cloudflare account. Check the current Containers requirements in the Cloudflare docs; the README
  assumes the Workers Paid plan. Install and start Docker.
- Then: `npx wrangler login`, `npx wrangler whoami`.
- Record versions: `npx wrangler --version`. `@cloudflare/containers` is pinned in `package.json`.

### C2. Review the config against reality

The config was written against `@cloudflare/containers@0.3.7` and the wrangler 4.156 schema but
**never deployed**.

1. Check `wrangler.jsonc` against the current Containers docs: the `containers`,
   `durable_objects` and `migrations` blocks, image build, and `max_instances`.
2. Check `cloudflare/worker.ts`:
   - The `Container` class API: `defaultPort`, `sleepAfter`, `envVars`, `getContainer`.
   - **The env forwarding list is incomplete.** It must contain every key of the config schema in
     `src/config.ts` except `PORT`. Missing today: `BLOCKFROST_PREPROD_URL`,
     `CARDANO_L1_CONFIRMATIONS`, `EXPLORER_TX_URL`, `MAX_PAYMENTS_PER_RUN`,
     `DEMO_AMOUNT_CEILING_MINOR`.
   - Add a test that fails when the list and the schema drift apart. For that, `src/config.ts`
     needs to export the schema's keys. That is an additive change: ask Korbi (A owns the file).
     Keep the list itself in a module with no Cloudflare imports, so vitest can load it.
3. Check whether Worker secrets reach the container through `envVars`, set in the Durable Object
   constructor.

### C3. Docker locally

```bash
docker build -t cxc-agentpay .
docker run --rm -p 8787:8787 --env-file .env cxc-agentpay
curl -s localhost:8787/health
```

- Health must show `x402Ready: true`. Check that `.dockerignore` keeps `.env` out of the image.
- Optional, if cold start or memory is a problem: compile with `tsc` to `dist/` and run `node`
  instead of `tsx`. That touches `package.json` and `tsconfig`, so ask Korbi first.

### C4. Secrets and variables

- **Secrets:** add each with `npx wrangler secret put <NAME>`.
  - `ANTHROPIC_API_KEY`
  - `BLOCKFROST_PROJECT_ID` (cloud project)
  - `BUYER_MNEMONIC` (**buyer-cloud** wallet from A)
  - `SELLER_ADDRESS`
- **Non-secret variables** (`PUBLIC_BASE_URL`, `FACILITATOR_URL`, `LOCAL_FACILITATOR`,
  `CARDANO_L1_CONFIRMATIONS`, prices, budget): put them in `vars` in `wrangler.jsonc`. Values come
  from A's hand-off.

### C5. Deploy and AT1

1. `npx wrangler deploy` gives you the `*.workers.dev` URL. Set `PUBLIC_BASE_URL` to it and
   redeploy.
2. Check:
   - `GET <live>/api/health` shows `x402Ready: true`, `aiReady: true`, and the expected buyer and
     seller addresses.
   - **AT1:** an unpaid `POST <live>/v1/payment-readiness` returns 402 with the expected offer.
3. Verify from the laptop with the repo's own tooling. A shell environment variable overrides
   `.env`:
   ```bash
   PUBLIC_BASE_URL=https://<live-url> npm run preflight
   ```
   - The `seller health` check FAILs on `buyerAddress` if your local `.env` holds a different
     buyer wallet than the cloud. That is expected; everything else must pass.
   - To avoid the mismatch, run with a copy of `.env` that holds the cloud values.

Post the URL to Korbi: this is **CP1** for C.

### C6. Long paid requests (AT8)

A paid request blocks while the facilitator settles. It waits for confirmation and the SDK retries
settle once, so it can take 1-4 minutes. Verify that the Worker -> Durable Object -> Container path
does not cut it:

```bash
PUBLIC_BASE_URL=https://<live-url> npm run smoke:x402
```

This pays from the laptop's buyer wallet to the deployed seller. It must exit 0. If it cuts off,
find the limit in the Cloudflare docs and fix it, or document the workaround.

### C7. Full agent run on the live URL (AT3)

Open the live UI, run the `sepa_ok` sample, and get `DRAFT_READY` with a real tx. This uses the
buyer-cloud wallet.
- The agent reaches the seller via `PUBLIC_BASE_URL`, a hairpin through Cloudflare.
- With `LOCAL_FACILITATOR=true`, the seller reaches `${PUBLIC_BASE_URL}/facilitator` the same way.

If hairpin calls fail or are slow, propose an `INTERNAL_BASE_URL` (default
`http://localhost:8787`) for self-calls to Korbi. `src/config.ts` belongs to A.

### C8. Container lifecycle for judging

- One named instance (`"main"`), `max_instances: 1`, and state in memory. A sleep or redeploy
  resets runs **and the spend ledger**.
- Check `sleepAfter` against the judging window and raise it if needed.
- Before judging: one warm-up request, and no redeploys.
- Write all of this into `docs/DEPLOY.md` as a known limitation.

### C9. Cloudflare AI Gateway (optional, strengthens the Cloudflare story)

1. Create an AI Gateway.
2. Set `ANTHROPIC_BASE_URL` to its Anthropic endpoint. Take the exact URL format from the current
   Cloudflare docs.
3. Verify that extraction requests show up in the gateway logs.
4. Add `ANTHROPIC_BASE_URL` to the forwarded variables (it is already in the list) and to the
   deploy docs.

### C10. Custom domain (optional)

If `cashxchain.com` DNS is on Cloudflare, add `agentpay.cashxchain.com` as a custom domain, and
update `PUBLIC_BASE_URL`. Otherwise stay on `workers.dev`.

### C11. Fallback if Containers is blocked for more than about 2 hours

1. Run the app on the laptop and expose it with a Cloudflare Tunnel
   (`cloudflared tunnel --url http://localhost:8787`). Check the exact command in the current
   docs.
2. Set `PUBLIC_BASE_URL` to the tunnel URL.

It's still Cloudflare, and the demo stays live. Document it in `docs/DEPLOY.md`.

### C12. CI and deploy docs

- `.github/workflows/ci.yml`: Node 22, `npm ci`, `npm run typecheck`, `npm test` on every PR and
  on `main`. No deploy from CI, and no secrets in CI.
- `docs/DEPLOY.md` covers:
  - prerequisites
  - exact commands and the list of secrets and vars (names only, never values)
  - verification steps (AT1, AT8, AT3)
  - troubleshooting
  - lifecycle limits
  - the tunnel fallback
- Send Valentin-Codex (D) the link and the live URL.

## Files

- **You own:** `wrangler.jsonc`, `cloudflare/`, `Dockerfile`, `.dockerignore`,
  `.github/workflows/`, `docs/DEPLOY.md`.
- **Shared, additive only, ask first:** `src/config.ts` (export the env keys; maybe
  `INTERNAL_BASE_URL`), `package.json` (a `"deploy"` script line).
- **Do not edit:** the rest of `src/` (A, B), `public/` (B), `README.md` (D). Put deploy details in
  `docs/DEPLOY.md`; D links it.

## Verification before every PR

```bash
npm run typecheck
npm test
```

Plus, for deploy changes: `PUBLIC_BASE_URL=<live> npm run preflight`, with the result in the PR.

## Definition of done

- [ ] Live URL. AT1 (402 offer), AT8 (long request) and AT3 (agent run `DRAFT_READY` with tx) pass.
- [ ] The env forwarding list is complete and drift-tested.
- [ ] Secrets are set via wrangler. Nothing sensitive is in git or in `wrangler.jsonc`.
- [ ] CI is green on PRs and `main` (AT9).
- [ ] `docs/DEPLOY.md` is complete, including the tunnel fallback and lifecycle limits.
- [ ] Optional: AI Gateway and custom domain.
