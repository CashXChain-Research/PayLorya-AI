# Workstream A: live x402 payment and payment core

| | |
| --- | --- |
| Owner | Korbi |
| Tool | Claude Code |
| Branch | `feat/x402-live` (cloud sessions push to their session branch) |
| Read first | `docs/plan/00-end-result.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md` |
| Depends on | C: live URL with the keys set as Cloudflare secrets |
| Delivers to | C (buyer-cloud wallet, seller address, facilitator mode), B (`run.settlement`), D (evidence, safety outputs) |

## Team decision: API keys live only on Cloudflare (2026-10-30)

The Blockfrost and Anthropic keys exist only as Cloudflare secrets, never in a laptop `.env`.

Consequences:
- **No local payments.** `npm run smoke:x402` and the secret-dependent checks of
  `npm run preflight` sign and query Blockfrost locally, so they cannot run on the laptop.
- **Live payments go through the deployment.** Every real payment is driven over HTTP against the
  deployed instance with the remote tooling (`remote:check`, `remote:run`, `remote:safety`). The
  server's buyer wallet (`buyer-cloud`) pays.
- **Milestone 1 waits for C.** The first real payment needs Valentin's deploy (CP1 for C).

## Goal

Real tADA payments buyer -> seller on Cardano Preprod through the x402 cycle, proven on the live
deployment with committed evidence. The payment path is hardened for the live demo: no UTxO
conflicts, a visible unknown-settlement state, and live proof of the safety scenarios.

## Status

| Task | Status |
| --- | --- |
| A1 Wallets | Done: seller, buyer-local and buyer-cloud created locally. Mnemonics are in the password manager, never in chat or git |
| A2 First real payment | Waiting for C's live URL |
| A3 Reconcile with live services | Done: hosted facilitator `/supported` and Blockfrost error codes verified live (see ARCHITECTURE "Verified live") |
| A4 Full agent run | Waiting for C's live URL |
| A5 Wallet queue | Done (merged in #3) |
| A6 `run.settlement` | Done (merged in #3) |
| A7 Safety scenarios | Tooling being built; the run waits for C |
| A8 Demo settings | Waiting for A2 timings |
| A9 Hand-off | buyer-cloud mnemonic and seller address to Valentin |

## Tasks

### A2. First real payment (milestone 1, AT2)

Once Valentin posts the live URL and has set the secrets:

```bash
npm run remote:check -- --url https://<live-url>
```

This is read-only and needs no keys. It checks health (`x402Ready`, `aiReady`, network), the
facilitator's `/supported`, and the live 402 offer against the server's seller and price. The buyer
balance cannot be checked without a key, so look up the buyer-cloud address on the explorer and
check it has more than about 4 tADA.

```bash
npm run remote:run -- --url https://<live-url> --yes
```

This spends about 2 tADA from the server's buyer wallet. The run must end `DRAFT_READY`; then commit
`evidence/live-run-*.json`. On **SETTLEMENT_UNKNOWN**, do not re-run: open the printed explorer
link first.

Record the facilitator in use (hosted or local), the settle duration, the fee, and whether the
explorer link format is right. Check the link in a browser: Cardanoscan blocks scripts.

### A4. Full agent run with a text invoice

```bash
npm run remote:run -- --url https://<live-url> --sample sepa_ok --yes
```

This runs Claude extraction on the server. Then run `us_ok`.

### A7. Safety scenarios (AT5, AT6)

```bash
npm run remote:safety -- --url https://<live-url> --yes
```

It spends up to about 4 tADA and runs three scenarios:
- the same invoice twice
- an invoice without bank details
- a prompt-injection invoice

Commit `evidence/safety-*.json` and hand the output to Valentin for the pitch. Budget exhaustion is
manual: set `SESSION_BUDGET_LOVELACE` low on the server, run until refused, then restore it.

### A8. Demo settings decision

1. Compare the settle time with `CARDANO_L1_CONFIRMATIONS` unset (spec default 1) and with `0`
   (block inclusion), using the `remote:run` timings. Each value is a Cloudflare var, so each
   change needs a redeploy.
2. Decide which to use for the demo, and record the trade-off in ARCHITECTURE. Mempool (`-1`) is
   out of range on the hosted facilitator.

### A9. Hand-off to Valentin (Cloudflare)

Send these via password manager or Signal only:
- the **buyer-cloud** mnemonic
- the seller address
- the facilitator mode
- `CARDANO_L1_CONFIRMATIONS`

The Blockfrost and Anthropic keys go straight from their dashboards into `wrangler secret put`. Fund
the buyer-cloud address from the [faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)
first.

## Files

- **You own:** `src/agent.ts`, `src/policy.ts`, `src/seller.ts`, `src/facilitator.ts`,
  `src/config.ts`, `src/runs.ts`, `src/types.ts`, `scripts/`, `evidence/`, `.env.example`,
  `docs/ARCHITECTURE.md`, `tests/agent-x402.test.ts`, `tests/policy.test.ts`,
  `tests/milestone.test.ts`, the remote tooling tests.
- **Do not edit:** `public/`, `src/extract.ts`, `src/fixtures.ts`, `src/readiness.ts`,
  `src/server.ts` (B); `cloudflare/`, `wrangler.jsonc`, `Dockerfile`, `docs/DEPLOY.md` (C);
  `README.md` (D).

## Verification before every PR

```bash
npm run typecheck
npm test
```

Plus, for payment changes once the URL is live: one `npm run remote:run -- --url <live> --yes`,
with the result recorded in the PR.

## Definition of done

- [ ] Evidence of a real preprod payment from the live URL committed (AT2).
- [ ] A text-invoice agent run on the live URL ends `DRAFT_READY` with a tx (AT3, with C).
- [x] Back-to-back and concurrent runs are serialized per wallet and tested (AT7). Still to be
      observed live.
- [x] `run.settlement` is shipped and tested.
- [ ] Safety scenarios run live, with evidence handed to D (AT5, AT6).
- [ ] ARCHITECTURE "Verified live" covers the first payment. The demo confirmation setting is
      decided.
- [ ] Wallet hand-off to C done.

## Stretch (only after CP2)

**tUSDM pricing.** Only once tADA works end to end (team decision).
- Get tUSDM from the faucet linked in `node_modules/@x402/cardano/README.md`.
- Take the preprod asset id from `DEFAULT_ASSETS` in `@x402/cardano`.
- Extend `filterOffers` and the spend controls for that asset.
- The buyer still needs tADA for the fee.
- Verify everything against the SDK source before writing code.
