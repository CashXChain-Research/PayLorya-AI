# Workstream D: submission, README, pitch, demo video

| | |
| --- | --- |
| Owner | Valentin |
| Tool | Codex |
| Branch | `docs/submission` |
| Read first | `docs/plan/00-end-result.md` (all of it, especially sections 2, 3, 5, 12), `README.md`, `docs/ARCHITECTURE.md` |
| Depends on | C (live URL), A (evidence, safety scenario outputs), B (final UI at CP3) |
| Delivers | Devfolio submission, final README, pitch, demo video script, a public repo |

## Goal

Judges understand the product in 30 seconds, can verify every claim (live URL, explorer links,
code), and see a credible CashXChain story. Nothing is overstated: simulated parts are labeled, and
there are no compliance claims.

## Start

```bash
git checkout main && git pull && git checkout -b docs/submission
```

Prompt for Codex:

> Read `docs/plan/00-end-result.md` and `docs/plan/valentin-codex.md`. Draft D2-D5 now with
> placeholders like `<LIVE_URL>` and `<TX_LINK>` where inputs are still missing. Every factual
> claim must be backed by the repo (code, evidence JSON, ARCHITECTURE). Do not invent numbers,
> features or partnerships. Edit only the files listed under "You own".

Valentin does the parts that need the web (D1, D6 make-public, D7 screenshots, video recording).

## Tasks

### D1. Rules and deadline (Valentin, on Devfolio)

Check these on tum.devfolio.co and write them into `docs/SUBMISSION.md` (top section):

- submission deadline, which also goes into the checkpoint table in `docs/plan/00-end-result.md`
- required fields
- video length limit
- public-repo and open-source rules
- what the Cardano track judges
- **Adevar Labs**: what it requires. Enter only if it needs no extra build (team decision)
- API3 and BSV: skipped (team decision)

### D2. `docs/SUBMISSION.md`: every Devfolio field, drafted

- **Name and tagline.** Draft: "CxC AgentPay: pay-per-call payment readiness for autonomous
  agents, settled via x402 on Cardano."
- **Problem:** agents start paying for services, but there are few services worth paying for, and
  no hard line between AI decisions and money movement.
- **Solution:** the paid readiness API plus the deterministic spend policy. Claude only extracts.
  The invoice is locked when settlement is unclear.
- **How it works:** the x402 flow (402 -> sign -> verify -> handler -> settle), and what Cardano
  contributes. The buyer signs and never broadcasts; the facilitator never holds funds; the
  transaction is deterministic.
- **Tech stack:** TypeScript, Express, official `@x402/*` 2.29 SDK (`@x402/cardano`), Blockfrost,
  Claude API, Cloudflare Containers (plus AI Gateway if C ships it).
- **Real vs simulated:** copy section 5 of the end-result doc.
- **Challenges and what we learned:**
  - the concurrent double-pay bug found by tests
  - `SETTLEMENT_UNKNOWN` design
  - min-UTxO
  - facilitator choice (fill in from A)
- **What's next:**
  - tUSDM and stablecoin pricing
  - CashXChain sandbox integration
  - persistent ledger
  - more corridors
  - mainnet only after legal review
- **Team:** Valentin Israel (CEO), Korbinian Weber (CTO), CashXChain.
- **Links:** repo, live URL, video, tx evidence.

### D3. README overhaul (you own `README.md`)

Keep the existing quick start and milestone 1 runbook. Restructure around them:

1. A hero line and a 3-sentence pitch.
2. **Live demo** link, **video** link, and **proof**: the explorer link of the evidence tx.
3. "How it works in 60 seconds" with a Mermaid sequence diagram. GitHub renders Mermaid; reuse the
   diagram from the end-result doc.
4. Trust boundary, and the real-vs-simulated table.
5. Quick start, the runbook, and a link to `docs/DEPLOY.md` (from C).
6. Tests: what `tests/agent-x402.test.ts` proves, and what it does not (it is not a live payment).
7. Limitations, team, and license.

Branding: CashXChain (cashxchain.com). Tagline: "The Infrastructure for the money of tomorrow".
State fiat figures in USD.

### D4. `docs/DEMO-SCRIPT.md`: demo video storyboard

- Fit the Devfolio limit; target 2-3 minutes.
- Shot list with timestamps, what to click, and voice-over text. It follows section 2 of the
  end-result doc: SEPA run -> explorer -> report -> draft -> injection -> repeat invoice ->
  `curl` 402.
- Recording plan:
  - Record on the live URL.
  - Pre-record one successful run in case settlement is slow.
  - Settlement waits for a confirmation, so cut the wait in the edit and say so on screen
    ("waiting ~1 min for confirmation, cut").
- No secrets on screen: no `.env`, no terminal history with mnemonics, no Cloudflare dashboard
  secrets.

### D5. `docs/PITCH.md`: live pitch and judge Q&A

- **Slide-by-slide content** for 3-5 minutes:
  1. problem
  2. solution
  3. live demo
  4. why x402 and Cardano
  5. trust boundary
  6. business: CashXChain as infrastructure, a pay-per-call API for agents, and the path to
     stablecoin settlement and real CxC rails
  7. what's next
  8. team
- **Q&A prep:** at least 12 likely judge questions with short, honest answers, for example:
  - What if the AI is prompt-injected?
  - What if settlement fails halfway?
  - Can the agent pay twice?
  - Is this compliant (MiCAR/PSD2)? The demo is testnet and moves no customer funds; the report is
    not an AML/KYB decision; production needs legal review.
  - Why Cardano and not an EVM chain?
  - Why x402 and not an API key with billing?
  - What is real and what is simulated?
  - Who pays the fees?
  - Path to mainnet?
  - Why would agents pay for this?
  - How do you make money?
  - What did you build during the hackathon?

### D6. Public-repo readiness (AT10)

1. **Secret scan of the full git history.** Use `gitleaks` if available. Otherwise grep
   `git log -p` for `sk-ant`, `preprod` + 32-char tokens, BIP39-looking 24-word sequences and
   `.env` contents. Report any findings to Korbi immediately; do not rewrite history yourself.
2. **License decision with Korbi.** `package.json` says `UNLICENSED` today. Note that `@x402/*` is
   Apache-2.0. Prepare `LICENSE`, but commit it only after the decision. Align the `package.json`
   `license` field.
3. At CP4, **Valentin** makes the repo public. That's a human action, not Codex.

### D7. Visuals and final check (CP3-CP4)

- **Screenshots of the live UI** for each panel, saved in `docs/img/` and used in the README and
  Devfolio. Check that there are no secrets in them.
- **At CP4, check in an incognito window:**
  - every README and Devfolio link
  - the live URL
  - the explorer links
  - that the video is public or unlisted

## Files

- **You own:** `README.md`, `docs/SUBMISSION.md`, `docs/PITCH.md`, `docs/DEMO-SCRIPT.md`,
  `docs/img/`, `LICENSE` (after the decision), the `license` field in `package.json`.
- **Do not edit:** `src/`, `public/`, `scripts/`, `tests/`, Cloudflare files, `docs/ARCHITECTURE.md`
  (A), `docs/DEPLOY.md` (C). Link to them instead.

## Writing rules

- English. Short and concrete. Every claim backed by the repo or a link.
- Always say "tADA on Cardano Preprod (testnet)". Never imply mainnet or real funds.
- Label simulated parts ("Simulated route/fees"). Never write "compliant", "AML-checked" or
  "KYB-verified".
- Fiat figures in USD.
- Use the CashXChain palette in any visuals: white, grey, black, `#000066` (navy), `#005577`
  (teal).

## Definition of done

- [ ] Rules, deadline and track requirements captured. The Adevar decision is made.
- [ ] `docs/SUBMISSION.md` is complete, with real links, no placeholders.
- [ ] The README is final, with the live URL, video, evidence, diagram, and real-vs-simulated table.
- [ ] The demo video is recorded and linked, within the limit.
- [ ] `docs/PITCH.md` has slides and Q&A.
- [ ] The secret scan is clean, the license is decided, and the repo is public (AT10).
- [ ] Devfolio is submitted before the deadline.
