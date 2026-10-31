# PayLorya AI — submission draft

**Release status: draft. Do not submit unchanged.** Live proof and event rules are pending.
This document prepares the fields named in the work brief; the actual Devfolio form has not
been inspected. Match its field names and limits before pasting.

## Rules and deadline — D1, Valentin

Official event page: https://tum.devfolio.co — not verified from this environment.
Use the organizer's stated timezone; record an exact date, time and timezone below.

| Requirement | Confirmed value / action |
| --- | --- |
| Submission deadline | `<DEADLINE_WITH_TIMEZONE>` — copy from official rules; Korbi updates the checkpoint table in `docs/plan/00-end-result.md` |
| Required fields / character limits | `<DEVFOLIO_FIELDS_AND_LIMITS>` — compare against this draft |
| Video length limit | `<VIDEO_LIMIT>` — storyboard targets 2:50; shorten if required |
| Public repository requirement | `<PUBLIC_REPO_RULE>` — confirm and check without authentication |
| Open-source / license requirement | `<LICENSE_RULE>` — resolve before choosing a license |
| Cardano track judging criteria | `<CARDANO_CRITERIA>` — confirm eligibility and evidence requirements |
| Adevar Labs | `<ADEVAR_REQUIREMENTS_AND_DECISION>` — enter only if no extra build is needed and the team agrees |
| API3 / BSV | Skipped, per the team plan |
| Final submission | `<SUBMISSION_RECEIPT_URL_OR_TIMESTAMP>` — not submitted |

## Name and tagline

**Name:** PayLorya AI

**Tagline:** Pay-per-call payment readiness for autonomous agents, settled via x402 using
tADA on Cardano Preprod (testnet).

**Brand:** PayLorya AI — Claude reads. Code decides. You approve. (Fiat payouts on CashXChain rails.)

## Problem

An autonomous agent can read an invoice, but that does not make the payment ready to send.
Account details may be invalid, required fields missing, or the invoice duplicated. An agent
also needs a firm limit between interpreting untrusted text and spending money on a service.

## Solution

PayLorya AI combines a paid payment-readiness API with a reference buyer agent. The API
checks account details, required fields, duplicates and a demo amount ceiling, then returns
a readiness report with Simulated route/fees. The buyer purchases that report via x402 using
tADA on Cardano Preprod (testnet).

Claude only extracts invoice fields. Deterministic policy selects the allowed seller and
checks price, budget and invoice locks before signing. If settlement becomes unclear after
signing, the invoice enters SETTLEMENT_UNKNOWN and remains locked against another payment
within that running process. A successful report can produce a draft awaiting human approval.
No supplier payout is executed.

## How it works

1. The user supplies synthetic invoice text or structured JSON. Text uses Claude; JSON skips it.
2. A local precheck requires an IBAN or routing number before buying a report.
3. The seller answers an unpaid request with HTTP 402 and a PAYMENT-REQUIRED offer.
4. The buyer accepts only the configured seller, exact scheme, cardano:preprod network,
   lovelace asset and default transfer method, within the configured price and budget limits.
5. It reserves the invoice and budget atomically, signs locally and retries with PAYMENT-SIGNATURE.
6. The facilitator verifies; the seller generates a buffered report; the facilitator settles
   by broadcasting and waiting according to the configured confirmation policy.
7. Only a successful settlement response with a transaction hash becomes payment proof.
   A ready report ends at DRAFT_READY with executable: false.

Cardano provides the testnet settlement ledger and UTxO-based transaction model. Given a signed
transaction, its identity and outputs are fixed; the language model does not select them.
The buyer does not broadcast and the facilitator holds no funds. Live settlement is an
acceptance gate, not yet proven by this checkout. Report purchases are serialized within each
buyer agent instance; separate deployments still require separate wallets.

## Tech stack

TypeScript ESM, Node.js 22+, Express, official @x402/* 2.29 SDK including @x402/cardano,
Blockfrost, Anthropic's Claude API and Cloudflare Worker → Containers deployment configuration.
Cloudflare deployment is pending validation. ANTHROPIC_BASE_URL supports an optional AI Gateway
route; do not claim Gateway usage until workstream C confirms it shipped.

## Real vs simulated

The end-result plan's target distinction is retained below, with current verification status.
“Real” describes the implementation category; it does not establish that a live run passed.

| Part | Status | Current verification |
| --- | --- | --- |
| x402 request/response cycle | Real: official @x402/* 2.29 SDK | 65 tests passed locally; chain side stubbed |
| Payment buyer → seller | Real on Cardano Preprod, in tADA (test funds) | Live evidence pending A |
| Transaction hash and explorer link | Real, stored only from a successful settle response | Real transaction and explorer verification pending A |
| Field extraction | Real Claude API call; amounts parsed deterministically | Code inspected; live sample outputs pending B |
| IBAN / BIC / ABA checks, duplicate detection | Real, deterministic code | Existing offline suites pass in this instance |
| Corridors, rails, fees, FX, ETA | Simulated (`demo-fixture`, “Simulated route/fees”) | Fixtures in `src/fixtures.ts` |
| Supplier payout | Not executed; no CashXChain payout endpoint is called | Draft has `executable: false`; report has `payoutExecuted: false` |
| Compliance | Data-quality and routing check, not an AML, sanctions or KYB decision | No regulatory claim |

## Challenges and what we learned

- **Concurrent double-payment risk:** tests encode same-invoice and budget races. The ledger
  checks and reserves budget plus invoice identity in one synchronous operation before signing.
  The brief describes a bug found by tests; a historical red test has not been independently
  reproduced here. This is not evidence of safe concurrent spending from real UTxOs.
- **Unknown settlement:** a network error after signing is not proof that no payment happened.
  The conservative state counts the price against the budget and locks the invoice, including
  verify failures after signing and success responses missing a hash.
- **Minimum UTxO:** the price is not the entire funding requirement. Preflight checks seller
  output minimums and buyer funds for price, a maximum fee and change minimum. Rough funding
  guidance in the runbook is not a guaranteed network-fee quote.
- **Facilitator choice:** `<FACILITATOR_MODE_AND_REASON_FROM_A>`. Hosted and in-process modes
  exist; the updated architecture records a successful hosted `/supported` check, but hosted verify/settle
  and a real payment remain unverified. Record confirmation settings and measured wait
  only after A supplies evidence.

## What's next

Explore tUSDM and stablecoin pricing after tADA is proven end to end; integrate a CashXChain
sandbox; add a persistent ledger and more corridors. Mainnet would require legal review,
security review and production operational controls. These are future work, not shipped features.

## Team

Valentin Israel — CEO, CashXChain. Korbinian Weber — CTO, CashXChain.
No external partnership or endorsement is claimed.

## Links and proof register

| Item | Value | Verification needed |
| --- | --- | --- |
| Repository | https://github.com/CashXChain-Research/cxc-agentpay | Public, no authentication, correct branch |
| Live UI / API | `<LIVE_URL>` | C: UI, health, correct live 402 and full agent run |
| Video | `<VIDEO_URL>` | Valentin: public/unlisted, correct duration, no secrets |
| Payment evidence JSON | `<EVIDENCE_PATH>` | A: commit real `evidence/milestone1-*.json` |
| Explorer transaction | `<TX_LINK>` | A: buyer → seller, 2 tADA on Cardano Preprod (testnet) |
| Extraction outputs | `<B_SAMPLE_RESULTS>` | B: all samples and injection case |
| Safety outputs | `<A_SAFETY_RESULTS>` | A/B: injection, repeat, missing bank details; spend and tx checks |
| CI | `<CI_RUN_URL>` | C: typecheck and tests green on submitted main |
| Deployment runbook | [DEPLOY.md](DEPLOY.md) | Available from C; live deployment still needs verification |

## Current checkout checks

Initial inspection base: `12bfc45`. Updated onto `6f665c2` before publishing workstream D.
That main update adds per-agent wallet serialization, unknown-settlement candidate hashes,
recorded hosted-facilitator capability checks, CI and the deployment runbook; it does not supply payment evidence.

- No milestone evidence directory exists in this checkout. The deployment runbook and CI workflow
  are now available from C; their presence does not establish a successful live deploy or CI run.
- Only `sepa_ok`, `us_ok` and `bad_iban` sample buttons exist. Injection and missing-account
  inputs must be pasted manually; the storyboard includes them.
- The current UI shows price/config status, timeline, proof, report and draft. The planned
  header budget/allowlist panel and disabled execute button are not present. The draft displays
  `executable: false`; describe that actual behavior until B ships the final UI.
- Node 24.19.0 / npm 11.9.0 satisfy Node >=22. `npm ci --no-audit --no-fund` installed
  211 packages from the lockfile. `npm run typecheck` passed; `npm test` passed all 65 tests
  across 5 files. The Worker typecheck (`npx tsc -p cloudflare`) also passed. These are current-instance results, not CI or live-chain evidence.
- `npm start` served the UI, health and three samples. Functional requests verified the UI
  title, network/config status and sample keys. With no credentials, agent and paid endpoints
  correctly return 503 configuration errors; this does not prove a working paid 402 offer.
- The command sandbox initially blocked proxy connections and localhost/tsx sockets. The same
  install, server and tests succeeded using supported command escalation; no source or lockfile
  changes were needed. Read-only `git ls-remote origin HEAD` matched inspection HEAD.
- `npm run preflight` exited 1: 2 pass, 5 warn/skipped, 4 fail. Failures are missing required
  configuration, unconfigured seller health/402, and blocked facilitator access. Native Node
  requests need `NODE_USE_ENV_PROXY=1` in this cloud runtime. With it enabled, the facilitator
  failure was confirmed as proxy HTTP 403, rather than a missing GitHub token or application bug.
- Live destinations: `x402.preprod.dev.ecosyseng.cf-deployments.org`,
  `cardano-preprod.blockfrost.io` and (text extraction) `api.anthropic.com`. Configuration draft
  additions do not establish runtime access or successful authentication. No live payment was
  attempted. Local development/tests are validated; the full payment workflow remains blocked.
- No payment or model credentials are configured. No payment was signed, broadcast or deployed.

## Public-repo readiness — D6 / AT10

- [ ] Finish D1 and resolve the license decision below.
- [x] Run the available full-history heuristic scan: 8 commits, 49 unique reachable blobs and
  commit messages across all local refs; the checkout is not shallow. No candidate remained
  after review. Checked Anthropic/GitHub key patterns, Blockfrost preprod tokens, private-key
  headers, credential assignments, tracked `.env` files and English BIP39 mnemonic sequences.
  Initial matches were blank `.env.example` variables/source labels; corrected matching found
  none. Gitleaks is not installed. This is a bounded scan, not proof that every secret format
  is absent; rerun a release scan after merging other workstreams. Do not paste candidate values.
- [ ] A supplies real evidence; C supplies live URL; B supplies sample validation and final UI.
- [ ] Replace every release placeholder in README and submission; recheck all claims against evidence.
- [ ] After CP3, Valentin captures live screenshots in `docs/img/`, checks them for secrets and links them.
- [ ] Valentin records the live video using [DEMO-SCRIPT.md](DEMO-SCRIPT.md).
- [ ] Valentin makes the repository public at CP4.
- [ ] In an incognito browser, check repository, live demo, video and explorer links, including
  links pasted into Devfolio. Confirm video visibility and live endpoint behavior.
- [ ] Submit before the verified deadline and record the receipt. Publication/submission is pending.

### License decision

Current state: `package.json` declares `UNLICENSED`; there is no LICENSE file. Do not present this
as open source until the founders choose and apply a license. Public access and an open-source
license are separate decisions.

Proposed decision for Valentin + Korbi: evaluate Apache-2.0, the license identified for @x402/*
in the brief, against event rules and CashXChain's intended reuse terms. Installed @x402/core, @x402/cardano, @x402/express and @x402/fetch package metadata all declare
Apache-2.0; @x402/cardano LICENSE and NOTICE were also inspected. Review all third-party
LICENSE/NOTICE obligations before distribution. Do not assume a dependency's license
licenses this repository.

Once agreed, add the unmodified official text for the chosen license to LICENSE, any required
notices, and align the package.json license field. No license has been granted or package field
changed in this draft. Exact license text remains pending the decision.

## Claim sources

| Claim | Source |
| --- | --- |
| Config defaults, fixed network | `src/config.ts`, `.env.example` |
| Offer allowlist / limits / reservations | `src/policy.ts`, `tests/policy.test.ts` |
| State machine, proof, non-executing draft | `src/agent.ts`, `src/runs.ts`, `src/types.ts` |
| Seller ordering / idempotency | `src/seller.ts`, `tests/agent-x402.test.ts` |
| Deterministic checks / simulated quotes | `src/readiness.ts`, `src/fixtures.ts`, `tests/readiness.test.ts` |
| Extraction boundary | `src/extract.ts`, `src/agent.ts` |
| Cloudflare target | `cloudflare/worker.ts`, `wrangler.jsonc`, `Dockerfile` |
| Team, scope, decisions | `docs/plan/00-end-result.md`, `docs/plan/valentin-codex.md` |
