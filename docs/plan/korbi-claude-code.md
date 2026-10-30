# Workstream A: live x402 payment and payment core

| | |
| --- | --- |
| Owner | Korbi |
| Tool | Claude Code (on the laptop, with network access to Cardano hosts) |
| Branch | `feat/x402-live` |
| Read first | `docs/plan/00-end-result.md`, `README.md` (milestone 1 runbook), `docs/ARCHITECTURE.md` |
| Delivers to | C (wallets, keys, facilitator decision), B (`run.settlement`), D (evidence, safety outputs) |

## Goal

Real tADA payments buyer -> seller on Cardano Preprod through the x402 cycle, first via
`npm run smoke:x402`, then through the full agent. Then harden the payment path for the live demo:
no UTxO conflicts, a visible unknown-settlement state, and live proof of the safety scenarios.

This is the critical path. CP1 depends on A1-A2.

## Start

```bash
git checkout main && git pull && git checkout -b feat/x402-live && npm ci
```

Prompt for Claude Code:

> Read `docs/plan/00-end-result.md` and `docs/plan/korbi-claude-code.md`. Work through tasks
> A1-A9 in order. Before any command that spends tADA, broadcasts a transaction or touches
> secrets, tell me what you will run and wait for my OK. Commit after each task.

## Tasks

### A1. Wallets, faucet, Blockfrost

1. Generate three wallets:
   ```bash
   npm run wallet:new -- seller
   npm run wallet:new -- buyer      # buyer-local (this laptop)
   npm run wallet:new -- buyer      # buyer-cloud (for Valentin / Cloudflare)
   ```
   Store all mnemonics in the password manager. Only the seller **address** goes onto servers.
2. Fund **both** buyer addresses from the [Cardano testnets faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).
   Each paid call costs about 2 tADA plus fee. Preflight computes the exact minimum.
3. Create a Blockfrost **preprod** project. Ideally create a second one for the cloud, to avoid
   shared rate limits.
4. `cp .env.example .env` and fill in `SELLER_ADDRESS`, `BUYER_MNEMONIC` (buyer-local),
   `BLOCKFROST_PROJECT_ID`, `ANTHROPIC_API_KEY`.

**Done when** `npm run preflight` shows no FAIL except the server checks (server not started yet).

### A2. Milestone 1: first real payment

1. `npm run dev`, then in a second terminal `npm run preflight`: everything must be PASS or WARN.
2. Hosted facilitator first. If the `facilitator` check FAILs, set `LOCAL_FACILITATOR=true`, restart,
   and re-run preflight.
3. `npm run smoke:x402`.
   - On **PAYMENT STATE UNKNOWN**, do not re-run. Check the printed explorer link first.
4. Commit `evidence/milestone1-*.json`.
5. Write down: which facilitator worked, the settle duration (`timingsMs.paid`), the fee, and
   whether the explorer link format is right (`EXPLORER_TX_URL`).

**Done when** the smoke run exits 0, the tx is visible on the explorer, and the evidence is
committed. That is **CP1** for A (AT2). Tell Valentin immediately.

### A3. Reconcile live behaviour with the offline assumptions

The tooling was built against a Blockfrost mock and stubs. Compare it with reality:

- Real Blockfrost field types and status codes, including the 403 for a key from the wrong network.
- What the hosted facilitator's `/supported` actually advertises.
- With `LOCAL_FACILITATOR=true`, whether Blockfrost `POST /utils/txs/evaluate/utxos` answers
  cleanly for a script-free tx.

Fix code and tests where reality differs. Move items in `docs/ARCHITECTURE.md` from
"Not verified yet" to a "Verified live" section, with dates and tx hashes.

### A4. Full agent run locally

Run the `sepa_ok` sample through the UI (`http://localhost:8787`) or with
`POST /api/runs`. It must end `DRAFT_READY` with tx hash and explorer link. Then run `us_ok`.

### A5. UTxO contention (AT7)

Cardano UTxO model: two payments signed from the same wallet before the first one confirms can pick
the same input, and the second then fails.

1. Measure: run two different invoices back to back, then two concurrently.
2. Recommended even if nothing fails: **serialize payments per buyer wallet** in `BuyerAgent`, so
   only one sign -> settle is in flight and the others wait. A promise-chain mutex around the pay
   step is enough.
   - Keep `SpendLedger.reserve()` as is.
   - Add a test to `tests/agent-x402.test.ts`: two concurrent runs for different invoices both
     settle, and the signer calls do not overlap.

### A6. Make `SETTLEMENT_UNKNOWN` visible (contract with B)

Add `run.settlement = { transactionHash?, explorerUrl?, reason }` when a run ends
`SETTLEMENT_UNKNOWN`. Use the tx hash from the settle response, or the signed tx hash if known.
Add tests for each unknown path. Tell B when the field lands.

Stretch: `POST /api/runs/:id/resolve` looks the tx up on Blockfrost.
- If on-chain: the run becomes `PAID`, and the ledger moves the amount from unknown to paid.
- If absent after the validity window: the invoice is unlocked.

Keep it conservative and tested.

### A7. Safety scenarios on the live chain (AT5, AT6)

Run each scenario and save the terminal and UI output for Valentin's pitch:

- **Same invoice twice:** the second run is refused before signing. There is no second tx and
  `spentLovelace` is unchanged.
- **Budget:** set `SESSION_BUDGET_LOVELACE` to allow N payments. Payment N+1 is refused before
  signing.
- **Injection invoice** (sample from B): only the allowlisted seller is paid, at the configured price.

### A8. Demo settings decision

1. Measure settle time with `CARDANO_L1_CONFIRMATIONS` unset (spec default 1) and with `0`
   (block inclusion).
2. Decide which to use for the demo, and record the trade-off in ARCHITECTURE. Mempool (`-1`)
   stays off.

### A9. Hand-off to Valentin (Cloudflare)

Send these via password manager or Signal only:
- the buyer-cloud mnemonic
- the seller address
- the Blockfrost key (or the cloud project)
- the facilitator mode
- `CARDANO_L1_CONFIRMATIONS`
- the final list of env vars

Check that the buyer-cloud address is funded.

## Files

- **You own:** `src/agent.ts`, `src/policy.ts`, `src/seller.ts`, `src/facilitator.ts`,
  `src/config.ts`, `src/runs.ts`, `src/types.ts`, `scripts/` (existing), `evidence/`,
  `.env.example`, `docs/ARCHITECTURE.md`, `tests/agent-x402.test.ts`, `tests/policy.test.ts`,
  `tests/milestone.test.ts`.
- **Do not edit:** `public/`, `src/extract.ts`, `src/fixtures.ts`, `src/readiness.ts`,
  `src/server.ts` (B); `cloudflare/`, `wrangler.jsonc`, `Dockerfile` (C); `README.md` (D).

## Verification before every PR

```bash
npm run typecheck
npm test
```

Plus, for payment changes: one `npm run smoke:x402` against preprod, and the result recorded in
the PR.

## Definition of done

- [ ] Evidence of a real preprod payment committed (AT2).
- [ ] A full local agent run ends `DRAFT_READY` with a tx.
- [ ] Back-to-back and concurrent runs all settle (AT7). Payment serialization is tested.
- [ ] `run.settlement` is shipped and tested, and B is informed.
- [ ] Safety scenarios run live, outputs handed to D (AT5, AT6).
- [ ] ARCHITECTURE "Verified live" is updated. The demo confirmation setting is decided.
- [ ] Wallets and keys handed to C securely.

## Stretch (only after CP2)

**tUSDM pricing.** Only once tADA works end to end (team decision).
- Get tUSDM from the faucet linked in `node_modules/@x402/cardano/README.md`.
- Take the preprod asset id from `DEFAULT_ASSETS` in `@x402/cardano`.
- Extend `filterOffers` and the spend controls for that asset.
- The buyer still needs tADA for the fee.
- Verify everything against the SDK source before writing code.
