# PayLorya AI API

Read cash, forecasts, documents and payments from your own systems and agents, and draft payments.
A person approves every payment you draft.

| | |
| --- | --- |
| Base URL | `https://paylorya.valentin.is/api/v1` |
| MCP | `https://paylorya.valentin.is/mcp` (Streamable HTTP) |
| Spec | [`/openapi.json`](../public/openapi.json) (OpenAPI 3.1), served at `https://paylorya.valentin.is/openapi.json` |
| Web version | `https://paylorya.valentin.is/developers` ([`public/developers.html`](../public/developers.html)) |

Test networks only: tADA on Cardano Preprod and the CashXChain sandbox. No real money moves.

Source of truth: [`src/cfo/api-keys.ts`](../src/cfo/api-keys.ts) (scopes, human-only list, rate limit,
key format), [`src/cfo/api.ts`](../src/cfo/api.ts) (routes, input schemas, bearer middleware,
idempotency, errors), [`src/cfo/store.ts`](../src/cfo/store.ts) (response shapes), and
[`tests/public-api.test.ts`](../tests/public-api.test.ts).

- [Quickstart](#quickstart)
- [Authentication](#authentication)
- [Scopes and human-only actions](#scopes-and-human-only-actions)
- [Drafting payments](#drafting-payments)
- [Errors](#errors)
- [Rate limits](#rate-limits)
- [Idempotency](#idempotency)
- [Endpoints](#endpoints)
- [MCP for agents](#mcp-for-agents)
- [Webhooks](#webhooks)

## Quickstart

1. **Create a key.** In the dashboard, open Developers (left menu, `/app/developers`) and create an API key. Pick its
   scopes (`read`, `write`). Copy it right away: it is shown once.
2. **Make your first call.** Check which account the key acts for:

   ```bash
   export PAYLORYA_API_KEY=ply_sk_…

   curl https://paylorya.valentin.is/api/v1/me \
     -H "Authorization: Bearer $PAYLORYA_API_KEY"
   ```

   ```json
   {
     "workspace": {
       "id": "1ecc0ce2-…",
       "name": "Brenner Trading",
       "baseCurrency": "USD",
       "autonomy": "guarded",
       "limits": { "perPaymentUsdMinor": 50000, "monthlyUsdMinor": 500000, "knownPayeesOnly": true },
       "createdAt": "2026-10-31T09:12:44.155Z"
     },
     "apiKey": {
       "id": "546f8819-…",
       "name": "ERP sync",
       "prefix": "ply_sk_AbFp…QJ8i",
       "scopes": ["read", "write"],
       "createdAt": "2026-10-31T09:20:01.166Z",
       "lastUsedAt": "2026-10-31T09:21:13.218Z"
     }
   }
   ```

3. **Draft a payment.** Find the payee, then draft. It waits for a person to approve it in the dashboard.

   ```bash
   curl https://paylorya.valentin.is/api/v1/payees \
     -H "Authorization: Bearer $PAYLORYA_API_KEY"

   curl https://paylorya.valentin.is/api/v1/payments \
     -H "Authorization: Bearer $PAYLORYA_API_KEY" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: inv-2026-114" \
     -d '{"payeeId":"<payee id>","amountMinor":12000,"currency":"EUR","reason":"INV-2026-114"}'
   ```

## Authentication

```
Authorization: Bearer ply_sk_…
```

- A key is `ply_sk_` followed by 40 letters and digits. It acts for the account that created it, and
  sees only that account's data.
- PayLorya AI stores only a SHA-256 hash of the key and a recognisable prefix (`ply_sk_AbCd…WxYz`).
  Lose the key and you create a new one.
- Revoke a key under Developers; it stops working at once. An account holds up to 20 active keys.
- An unknown, mistyped or revoked key gets `401` with `"code": "invalid_key"`.
- Call the API from your server or agent runtime, not from a browser page: the API sends no CORS
  headers, and the key would be exposed.

## Scopes and human-only actions

| Scope | Allows |
| --- | --- |
| `read` | Every `GET`: overview, forecast, payments, payees, budgets, transactions, documents, activity, chats, connections. |
| `write` | Drafting payments, uploading and deleting documents, starting and deleting chats, and messaging the AI CFO. |

A call outside the key's scopes gets `403` `insufficient_scope`.

### Human-only actions

Some actions move money, sign, or change credentials and the agent's rights. They stay with a person
signed in to the dashboard. Any key, whatever its scopes, gets `403` `human_only` for:

- approving, rejecting and signing payments;
- connections (banks, wallets, CashXChain): adding, changing, refreshing, removing;
- payees and budgets: adding, changing, removing;
- the workspace and the agent's rights (autonomy, limits);
- API keys and webhook endpoints: creating and removing;
- requesting test tADA, linking CashXChain, and passwords.

Reading them is fine: a `read` key can list payees, budgets, connections, API keys (never the keys
themselves) and webhook endpoints.

> Payees count as rights. With full access the agent pays saved payees without asking, so a leaked key
> must not be able to add a payee or change its account details.

## Drafting payments

`POST /payments` drafts a payment to a saved payee. A payment drafted with a key always waits for a
person: its `status` is `pending_approval`, or `blocked` when it cannot execute as it stands (for
example, no agent wallet or no connection with read & write access). `policy.checks` says why.
Nothing is paid until someone approves it in the dashboard.

```json
{
  "id": "c0a8f3f2-…",
  "payeeId": "8b1f2c9e-…",
  "payeeName": "Brenner GmbH",
  "amountMinor": 12000,
  "currency": "EUR",
  "usdMinor": 12960,
  "rail": "cashxchain",
  "reason": "INV-2026-114",
  "status": "pending_approval",
  "requestedBy": "user",
  "policy": {
    "decision": "approval",
    "checks": [
      { "id": "rail", "status": "pass", "message": "CashXChain (sandbox)" },
      { "id": "autonomy", "status": "pass", "message": "A person confirms this payment" }
    ]
  },
  "createdAt": "2026-10-31T09:25:40.019Z"
}
```

| Field | Rule |
| --- | --- |
| `payeeId` | A saved payee from `GET /payees`. Payees are added in the dashboard. |
| `amountMinor` | Positive integer in the currency's minor unit: `12000` EUR is 120.00 EUR; ADA is in lovelace (1 tADA = `1000000`); JPY has no minor unit. |
| `currency` | `ADA` pays tADA on Cardano Preprod. `USD`, `EUR`, `GBP`, `CHF`, `AED`, `PLN`, `SEK` go to the CashXChain sandbox. `JPY` has no rail and is drafted as `blocked`. |
| `reason` | 1 to 300 characters, e.g. the invoice number. |
| `documentId` | Optional: links the payment to an uploaded document. |

One payment per bill: a draft for the same payee and amount while one is still open, or for a
document that already has an open or paid payment, is refused with `409` and creates nothing.

Statuses: `pending_approval`, `blocked`, `approved`, `executing`, `awaiting_signature` (a tADA payout
waiting for the owner's wallet), `executed`, `rejected`, `failed`. Follow them with `GET /payments` or
the [`payment.updated`](#webhooks) webhook.

> Messages to the AI CFO (`POST /chats/{id}/messages`) are different: there the AI CFO acts as the
> agent, and the payments it drafts follow the account's agent autonomy and limits, set in the
> dashboard, exactly as in the dashboard chat.

## Errors

Errors are JSON with a message for people and, on auth, scope, rate-limit and idempotency errors, a
`code` for machines:

```json
{ "error": "This key lacks the \"write\" scope.", "code": "insufficient_scope" }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | none | Invalid input; the message names each field, e.g. `amountMinor: Too small…` |
| 400 | `invalid_request` | `Idempotency-Key` longer than 200 characters. |
| 401 | `invalid_key` | Unknown, mistyped or revoked key. |
| 403 | `insufficient_scope` | The key lacks `read` or `write`. |
| 403 | `human_only` | Only a person in the dashboard can do this. |
| 404 | none | No such record in this account. |
| 409 | `idempotency_in_progress` | A request with this `Idempotency-Key` is still running. |
| 409 | none | Conflicts with the current state: an open payment for the same bill, or a chat that is still answering. |
| 413 | none | File larger than 15 MB. |
| 422 | `idempotency_mismatch` | The `Idempotency-Key` was used with a different request. |
| 429 | `rate_limited` | Over 120 requests per minute with this key. Wait `retry-after` seconds. |
| 429 | none | The account's daily AI limit (documents and chat messages) is reached. |
| 500 | none | Something went wrong on our side. Retry; with the same `Idempotency-Key` it is safe. |
| 503 | none | The AI model is not configured on this server (documents, chat). |

## Rate limits

- **Per key:** 120 requests per minute, with bursts up to 120. Every authenticated request counts,
  including refused ones. Over the limit: `429` `rate_limited` and a `retry-after` header in seconds.
- **Per account and day:** document uploads and messages to the AI CFO share a daily AI limit (150 by
  default, `CFO_AI_DAILY_LIMIT`), across the dashboard and the API. When it is reached: `429` without a
  `code`, until the next day (UTC).

```
HTTP/1.1 429 Too Many Requests
retry-after: 1

{ "error": "Too many requests with this key: try again in 1 s.", "code": "rate_limited" }
```

## Idempotency

Send an `Idempotency-Key` header on every write (`POST`, `DELETE`), e.g. your invoice or job id. A
retry after a timeout then never drafts a second payment.

- Same key, same method, path and body: you get the first reply again, with the header
  `idempotent-replayed: true`.
- Same key, different request: `422` `idempotency_mismatch`.
- Same key while the first request is still running: `409` `idempotency_in_progress`. Retry shortly.
- A first reply of `5xx` is not kept: a retry with the same key runs again.
- Keys are kept for 24 hours, separately for each API key. At most 200 characters.
- A reply without a JSON body (`204`, the chat stream) is replayed as its status alone.

## Endpoints

All paths are relative to `https://paylorya.valentin.is/api/v1`. Amounts are integers
in minor units; `usdMinor` fields are indicative USD cents. Full schemas:
[`openapi.json`](../public/openapi.json).

| Endpoint | Scope | What it does |
| --- | --- | --- |
| `GET /me` | read | The account and the key making the call. |
| `GET /overview` | read | Cash, open payables, approvals waiting, spend by category, six months, budgets, agent limits. |
| `GET /forecast?days=90` | read | Daily cash forecast, 7 to 365 days (default 90). |
| `GET /payments` | read | Payments, newest first. |
| `POST /payments` | write | Draft a payment. It waits for approval. |
| `GET /payees` | read | Saved payees with their account details. |
| `GET /budgets` | read | Monthly budgets with this month's spend. |
| `GET /transactions?month=2026-10` | read | Ledger; money out is negative. `month` is optional. |
| `GET /activity?limit=100` | read | Activity log, 1 to 500 entries (default 100). |
| `GET /documents` | read | Documents with their extracted summary fields. |
| `POST /documents` | write | Upload one file: `{filename, mimeType, dataBase64}`, at most 15 MB. Returns `processing`; the AI CFO reads it in the background. |
| `GET /documents/{id}` | read | One document with extracted fields, transactions and payments. |
| `GET /documents/{id}/file` | read | The original file. |
| `DELETE /documents/{id}` | write | Delete a document. |
| `GET /chats` | read | Chats with the AI CFO. |
| `POST /chats` | write | Start a chat. |
| `GET /chats/{id}` | read | A chat with its messages. |
| `POST /chats/{id}/messages` | write | Message the AI CFO: `{text, attachments?}`. Answers as a Server-Sent Events stream. |
| `DELETE /chats/{id}` | write | Delete a chat. |
| `GET /connections` | read | Banks, wallets and CashXChain accounts with balances. |
| `GET /api-keys` | read | The account's keys: name, prefix, scopes, last use. |
| `GET /webhooks` | read | Webhook endpoints. |

Also readable: `/connections/catalog`, `/cashxchain` (the CashXChain sandbox sub-account) and
`/funding` (test-tADA status).

Human only (`403 human_only` with any key): `POST /payments/{id}/approve`, `/reject`,
`/transaction`, `/signature`; every write under `/connections`, `/payees`, `/budgets`, `/api-keys` and
`/webhooks`; `PATCH /workspace`; `POST /funding`; `POST /cashxchain/link`; `POST /me/password`.

### Uploading a document

```bash
printf '{"filename":"invoice.pdf","mimeType":"application/pdf","dataBase64":"%s"}' \
  "$(base64 < invoice.pdf | tr -d '\n')" > upload.json

curl https://paylorya.valentin.is/api/v1/documents \
  -H "Authorization: Bearer $PAYLORYA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: upload-invoice-2026-114" \
  --data-binary @upload.json
```

### Asking the AI CFO

```bash
CHAT=$(curl -s -X POST https://paylorya.valentin.is/api/v1/chats \
  -H "Authorization: Bearer $PAYLORYA_API_KEY" | jq -r .id)

curl -N https://paylorya.valentin.is/api/v1/chats/$CHAT/messages \
  -H "Authorization: Bearer $PAYLORYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Which invoices are due this week?"}'
```

```
event: user
data: {"message":{"id":"…","role":"user","text":"Which invoices are due this week?","createdAt":"…"}}

event: tool
data: {"name":"list_documents","status":"start","summary":"…"}

event: text
data: {"delta":"Two invoices are due this week: "}

event: done
data: {"message":{"id":"…","role":"assistant","text":"Two invoices are due this week: …","createdAt":"…"}}
```

Events: `user`, `text` (`{delta}`), `tool` (`{name, status, summary}`), `done` (`{message}`) and
`error` (`{message}`).

## MCP for agents

Agents that speak the Model Context Protocol connect over Streamable HTTP with the same API key.
What a key may not do over REST, it may not do over MCP: there is no tool to approve, sign or change
payees.

| | |
| --- | --- |
| Endpoint | `https://paylorya.valentin.is/mcp` |
| Transport | Streamable HTTP |
| Auth | OAuth sign-in (claude.ai, Claude Desktop), or `Authorization: Bearer ply_sk_…` |

**Claude (claude.ai and Claude Desktop):**

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Paste `https://paylorya.valentin.is/mcp` and click **Connect**.
3. Sign in to PayLorya AI and click **Allow**. Choose **Read & draft** (read, draft payments, ask the
   AI CFO) or **Read only**.

Claude finds the sign-in by itself (OAuth 2.1 with PKCE and dynamic client registration; metadata at
`/.well-known/oauth-protected-resource/mcp`). Its token is an API key of your account named
*Claude (connector)*, listed under Developers in the dashboard: revoke it there to disconnect Claude.

**Claude Code:**

```bash
claude mcp add --transport http paylorya https://paylorya.valentin.is/mcp \
  --header "Authorization: Bearer ply_sk_…"
```

**JSON config**, for a project's `.mcp.json`; Claude Code expands `${PAYLORYA_API_KEY}` from the
environment. Other MCP clients that support Streamable HTTP take the same URL and header.

```json
{
  "mcpServers": {
    "paylorya": {
      "type": "http",
      "url": "https://paylorya.valentin.is/mcp",
      "headers": {
        "Authorization": "Bearer ${PAYLORYA_API_KEY}"
      }
    }
  }
}
```

| Tool | What it does | Like |
| --- | --- | --- |
| `get_overview` | Cash, payables, approvals waiting, budgets. | `GET /overview` |
| `get_forecast` | Cash forecast, day by day (`days`: 7–365). | `GET /forecast` |
| `list_payments` | Payments and their status (optional `status` filter). | `GET /payments` |
| `draft_payment` | Draft a payment to a saved payee (`payeeId`, `amountMinor`, `currency`, `reason`, optional `documentId`, `idempotencyKey`). It waits for a person's approval. | `POST /payments` |
| `list_payees` | Saved payees. | `GET /payees` |
| `list_budgets` | Budgets with this month's spend. | `GET /budgets` |
| `list_transactions` | The ledger (optional `month`). | `GET /transactions` |
| `list_documents` | Documents. | `GET /documents` |
| `get_document` | One document with its extracted fields. | `GET /documents/{id}` |
| `get_activity` | Activity log. | `GET /activity` |
| `ask_cfo` | Ask the AI CFO (`question`, optional `chatId`). With a key it cannot change budgets, and what it drafts waits for approval. | chat |

## Webhooks (coming soon)

> Webhooks are being rolled out: until they are, these endpoints answer 404 and the dashboard does not
> show them. This is the contract they will follow.

Get told when a payment is drafted or changes status, instead of polling. Add an endpoint in the
dashboard (Developers): its URL must be HTTPS, and you can pick the events. The signing secret
(`whsec_…`) is shown once. A key can list endpoints with `GET /webhooks`; adding, removing and
testing them is human only.

| Endpoint | Who |
| --- | --- |
| `GET /webhooks` | read scope |
| `POST /webhooks` `{url, events?}` → `{id, url, events, createdAt, secret}` | dashboard only |
| `DELETE /webhooks/{id}` | dashboard only |
| `POST /webhooks/{id}/test` (sends `ping`) | dashboard only |

| Event | When | `data` |
| --- | --- | --- |
| `payment.created` | A payment was drafted. | `{payment}` |
| `payment.updated` | A payment changed status. | `{payment, previousStatus}` |
| `ping` | The dashboard's test button. | |

```
POST /your/endpoint
content-type: application/json
x-paylorya-event: payment.updated
x-paylorya-delivery: …
x-paylorya-signature: t=1793448000,v1=5f2b9c…

{
  "id": "evt_…",
  "type": "payment.updated",
  "createdAt": "2026-10-31T10:02:11.000Z",
  "data": {
    "payment": { "id": "c0a8f3f2-…", "status": "approved", "…": "…" },
    "previousStatus": "pending_approval"
  }
}
```

### Verifying the signature

`x-paylorya-signature` is `t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 with your secret
over `<t>.<raw body>`. Verify it against the raw body, before parsing:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const SECRET = process.env.PAYLORYA_WEBHOOK_SECRET; // whsec_…

/** True when the signature matches the raw body and is at most 5 minutes old. */
function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map(kv => kv.trim().split("=")));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const app = express();
app.post("/webhooks/paylorya", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(raw, req.get("x-paylorya-signature") ?? "", SECRET)) return res.sendStatus(400);
  const event = JSON.parse(raw);
  if (event.type === "payment.updated") {
    const { payment, previousStatus } = event.data;
    console.log(`${payment.id}: ${previousStatus} -> ${payment.status}`);
  }
  res.sendStatus(204);
});
app.listen(3000);
```

### Delivery

- Answer with any `2xx` to acknowledge. Anything else, or no answer, is retried with backoff, about 6
  attempts in all.
- Retries can deliver the same event more than once: deduplicate on the event `id`.
- Answer quickly and do slow work afterwards.
