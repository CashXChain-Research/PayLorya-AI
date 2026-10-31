# PayLorya AI — pitch and judge Q&A

Target: 4 minutes, eight slides. Confirm event limits before presenting. This script describes
the implemented design; switch to past-tense live success claims only when the proof register in
[SUBMISSION.md](SUBMISSION.md) is complete. All payments use tADA on Cardano Preprod (testnet).

## Slides and spoken track

| Time | Slide content | Speaker notes |
| --- | --- | --- |
| 0:00–0:25 | **1. Reading an invoice is not payment readiness.** Invalid account details, missing fields, duplicates | “Agents can interpret a supplier invoice. They still need to know whether its payment data is usable. And untrusted invoice text must never become authority to spend.” |
| 0:25–0:50 | **2. A readiness API an agent can buy.** Invoice → paid report → review draft | “PayLorya AI sells a report per request. It checks account details and duplicates, with Simulated route/fees. Our Claude agent is the demo customer. The supplier payout is never executed.” |
| 0:50–1:50 | **3. Show the product.** Live invoice, timeline, proof, report, draft | Use the short successful take from DEMO-SCRIPT. “Watch extraction, the 402 offer, the settled report purchase and the non-executing draft.” Open the real explorer proof only when verified. Shorten idle confirmation time with a disclosed edit; if live evidence is unavailable, say “implemented flow; live settlement pending” and show no fabricated proof. |
| 1:50–2:20 | **4. Why x402 + Cardano.** HTTP price discovery; testnet ledger proof | “HTTP 402 lets an agent discover a price and retry with payment authorization. The official Cardano SDK builds a signed transaction; the facilitator broadcasts it. Cardano Preprod lets us demonstrate settlement with test funds. This is no claim that another chain could not implement the product.” |
| 2:20–2:55 | **5. The trust boundary.** Claude extracts; code authorizes; humans approve payout | “The model has no wallet or spending-limit fields. Code checks seller, asset, network, price and budget. It reserves an invoice before signing. If settlement becomes unclear, SETTLEMENT_UNKNOWN counts that price and locks the invoice. The final draft cannot execute a supplier payout.” |
| 2:55–3:20 | **6. Business.** CashXChain infrastructure; pay per API report | “CashXChain's direction is infrastructure for agent payments. A pay-per-call readiness API is a concrete entry point. Today's two-tADA test price is a demo setting, not a commercial USD price or revenue result. Real CashXChain rails are future integration work.” |
| 3:20–3:45 | **7. What comes next.** Persistent ledger, stablecoin pricing, sandbox, more corridors | “First prove the live workflow and persist its payment locks. Then explore tUSDM pricing and a CashXChain sandbox. Mainnet requires legal and security review. Current corridors, FX, fees and timing remain simulated.” |
| 3:45–4:00 | **8. Team and proof.** Valentin Israel, CEO; Korbinian Weber, CTO; links | “We are Valentin and Korbi, and this is PayLorya AI: Claude reads, code decides, you approve. Here are the code, live demo and payment evidence.” Display only verified links; omit missing resources rather than showing placeholders to judges. |

No market-size numbers, savings, traction, partnerships or production claims are substantiated
by this repository. Do not add them without a source. Show fiat fee examples in USD and preserve
“Simulated route/fees” next to them.

## Judge Q&A

**1. What if the AI is prompt-injected?**
Claude extracts invoice fields, not payment policy. Recipient, network, asset, caps and budget
come from config and deterministic checks. This limits payment authority; it does not guarantee
that extracted invoice data is correct. The live injection case still needs recording and validation.

**2. What if settlement fails halfway?**
Once signing succeeds, a failure can mean the transaction exists elsewhere. The run becomes
SETTLEMENT_UNKNOWN, counts its price and locks the invoice in that process. An operator must
reconcile it; blindly rerunning or restarting is unsafe. There is no persistent reconciliation UI.

**3. Can the agent pay twice?**
The in-memory ledger rejects paid, pending and unknown invoices and reserves atomically before
signing. Existing tests exercise same-invoice concurrency with a stub signer. Restarts lose these
locks, and real distinct-invoice UTxO concurrency remains a live acceptance test. No global
exactly-once guarantee is claimed.

**4. Is this compliant with MiCAR or PSD2?**
The demo uses testnet assets and no customer funds, and executes no supplier payout. Its report
is not an AML, sanctions or KYB decision. Production would require legal review; this demo does
not establish regulatory compliance or an exemption.

**5. Why Cardano rather than an EVM chain?**
Cardano is our chosen track and the official x402 Cardano SDK supports this HTTP payment flow.
Preprod supplies an inspectable test ledger. We do not claim benchmarks or superiority over EVM.

**6. Why x402 instead of API keys and monthly billing?**
An agent can discover the request's price and authorize payment through HTTP without a separate
billing signup in this demo. Production may still need authentication, rate limits and abuse
controls. x402 does not remove those operational requirements.

**7. What is real and what is simulated?**
The SDK integration, deterministic validation and Claude extraction path are implemented.
Payment targets tADA on Cardano Preprod (testnet); live proof is pending until A supplies it.
Corridors, rails, fees, FX and ETA are fixtures. Supplier payouts and compliance decisions are absent.

**8. Who pays the fees?**
The buyer funds the report price plus Cardano transaction fees and needs sufficient UTxOs for
change. Preflight checks these requirements. The session ledger tracks report prices, not a
total wallet-debit cap. Simulated fiat routing fees are separate from the on-chain purchase.

**9. What is the path to mainnet?**
Legal review, security review, persistent accounting and reconciliation, wallet operations,
monitoring and production integrations come first. Mainnet is a non-goal for this hackathon build.

**10. Why would agents pay for this?**
The proposed value is a structured, machine-readable check before preparing a cross-border
payment. Willingness to pay and commercial demand are hypotheses; this repo contains no
customer validation or measured savings.

**11. How do you make money?**
The proposed model charges per readiness report. Two tADA is the configurable test price.
Commercial USD pricing, margins and adoption are not established here.

**12. What did you build during the hackathon?**
The repository contains the paid readiness endpoint, reference buyer, extraction path, spend
policy, report UI, milestone tooling, tests and Cloudflare deployment configuration. Use commit
history to establish timing; do not claim every component was newly built during the event
without checking the official eligibility window.

**13. Does the facilitator have custody?**
It verifies and broadcasts the buyer's signed transaction; it holds no funds. The seller needs
only its receiving address. The buyer process holds the signing mnemonic and must be protected.

**14. Does a valid IBAN prove the account belongs to the supplier?**
No. The code checks checksum/country length, BIC format/country and ABA checksum. It does not
verify account ownership, bank existence, recipient identity or whether a payout will succeed.

**15. Why not pay the supplier automatically?**
This product purchases readiness data. Its trust boundary ends at a non-executing draft with
human approval required. No CashXChain payout API is called.

**16. What happens if the container restarts?**
Runs, spend accounting and invoice locks reset. The Worker targets one named instance, but that
does not provide durable storage. A persistent ledger is necessary before stronger guarantees.

**17. What if Claude is down?**
Structured JSON bypasses the model and still exercises the policy/API path. Label that fallback;
it is not evidence that live text extraction works. There is no automatic model fallback.

**18. How can judges independently verify it?**
Check source and tests, request the unpaid 402 offer, then compare a real recorded run's
transaction hash with the committed evidence and explorer seller output. README and submission
must contain verified URLs before release. Local stub tests alone are not on-chain proof.

## Presenter handoff

Use the [demo storyboard](DEMO-SCRIPT.md) for clicks and safety inputs. Obtain live URL and
facilitator details from C/A, sample results from B, and evidence from A. Do not sign, broadcast
or deploy during rehearsal without the human confirmation required by the team plan.
