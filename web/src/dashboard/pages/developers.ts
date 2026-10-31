// Developers (/app/developers, its own sidebar item): API keys and webhooks for the public API (/api/v1 with
// Authorization: Bearer ply_sk_…), and where the API docs and the MCP endpoint are. A new key or
// webhook secret is shown once, right after it is made: the server keeps only its hash.
// Rows reuse the Payees list (.payee-list).
import { esc } from "../../shared/dom.js";
import { ApiError, del, get, post } from "../api.js";
import type { Ctx } from "../state.js";
import type { ApiKey, ApiKeyCreated, ApiKeyScope, Webhook, WebhookCreated, WebhookEvent } from "../types.js";
import { ago, confirmDialog, copyText, date, dialog, empty, fieldError, icon, pageHead, skLines, toast, val } from "../ui.js";

/** Active keys per account (src/cfo/api.ts answers 409 beyond this). */
const MAX_KEYS = 20;
/** What no key can do (src/cfo/api-keys.ts, HUMAN_ONLY). */
const HUMAN_ONLY = "Keys can't approve or sign payments, or change payees, budgets, connections or agent rights. Those always need a person signed in to this dashboard.";
const EVENTS: Array<{ id: WebhookEvent; icon: string; text: string }> = [
  { id: "payment.created", icon: "plus", text: "A new payment is created" },
  { id: "payment.updated", icon: "refresh", text: "A payment changes, such as its status" },
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const scopeLabel = (scopes: ApiKeyScope[]): string => (scopes.includes("write") ? "Read & write" : "Read only");
const copyRow = (value: string, label: string): string =>
  `<div class="addr-row"><span class="mono" title="${esc(value)}">${esc(value)}</span><button type="button" class="icon-btn xs" data-copy="${esc(value)}" aria-label="${esc(label)}">${icon("copy", 13)}</button></div>`;

export function renderDevelopers(view: HTMLElement, ctx: Ctx): void {
  view.innerHTML = `${pageHead("Developers", 'Connect your own software to this account with the REST API, webhooks or MCP. <a href="/developers.html" target="_blank" rel="noopener">Read the API docs</a>')}${developersSection()}`;
  wireDevelopers(view.querySelector<HTMLElement>("#developers")!, ctx);
}

function developersSection(): string {
  const origin = location.origin;
  return `<section class="dev" id="developers" aria-label="Developers">
    <div class="settings">
      <section class="card dev-wide" id="dev-keys">
        <div class="card-head"><div><h2>API keys</h2><p class="muted small">For your own software and scripts. A key acts for this account; it is shown once, when you create it.</p></div><button type="button" class="btn primary sm" data-key-new>${icon("plus", 16, 2.4)}Create key</button></div>
        <div class="callout">${icon("shieldCheck", 16)}<span>${esc(HUMAN_ONLY)}</span></div>
        <div data-key-list><div class="pad">${skLines(2)}</div></div>
      </section>
      <section class="card dev-wide" id="dev-hooks" hidden>
        <div class="card-head"><div><h2>Webhooks</h2><p class="muted small">PayLorya AI notifies your endpoint when a payment is created or changes.</p></div><button type="button" class="btn primary sm" data-hook-new>${icon("plus", 16, 2.4)}Add endpoint</button></div>
        <div data-hook-list><div class="pad">${skLines(1)}</div></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>REST API</h2><p class="muted small">Send a key with each request as <span class="mono">Authorization: Bearer ply_sk_…</span></p></div></div>
        ${copyRow(`${origin}/api/v1`, "Copy API base URL")}
        <p class="fine">${MAX_KEYS} active keys per account, 120 requests per minute per key. An <span class="mono">Idempotency-Key</span> header makes a retried write safe.</p>
        <div class="form-foot"><span></span><a class="btn ghost sm" href="/developers.html" target="_blank" rel="noopener">${icon("external", 15)}API docs</a></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>MCP</h2><p class="muted small">For AI assistants and agents that speak the Model Context Protocol.</p></div></div>
        ${copyRow(`${origin}/mcp`, "Copy MCP endpoint")}
        <p class="fine">In Claude: Settings › Connectors › Add custom connector, paste this URL, then sign in and allow it. It shows up here as a key; revoke it to disconnect. Other clients can send a key as <span class="mono">Authorization: Bearer</span>.</p>
        <div class="form-foot"><span></span><a class="btn ghost sm" href="/developers.html" target="_blank" rel="noopener">${icon("external", 15)}API docs</a></div>
      </section>
    </div>
  </section>`;
}

function keyRow(k: ApiKey): string {
  const off = Boolean(k.revokedAt);
  const when = off ? `Revoked ${date(k.revokedAt)}` : `Created ${date(k.createdAt)} · ${k.lastUsedAt ? `last used ${ago(k.lastUsedAt)}` : "never used"}`;
  return `<li class="${off ? "revoked" : ""}">
    <span class="cm-ic">${icon("key", 17)}</span>
    <div class="pe-who"><b>${esc(k.name)}</b><span>${esc(scopeLabel(k.scopes))}</span></div>
    <div class="pe-details"><span class="mono">${esc(k.prefix)}</span><span class="small">${esc(when)}</span></div>
    <div class="pe-rails">${off ? `<span class="pill t-neutral">Revoked</span>` : ""}</div>
    <div class="pe-act">${off ? "" : `<button class="icon-btn danger-h" type="button" data-revoke="${esc(k.id)}" aria-label="Revoke ${esc(k.name)}" title="Revoke">${icon("trash", 16)}</button>`}</div>
  </li>`;
}

function hookRow(h: Webhook): string {
  return `<li>
    <span class="cm-ic">${icon("webhook", 17)}</span>
    <div class="pe-who"><b title="${esc(h.url)}">${esc(h.url)}</b><span>Added ${esc(date(h.createdAt))}</span></div>
    <div class="pe-details">${(h.events ?? []).map(e => `<span class="mono">${esc(e)}</span>`).join("")}</div>
    <div class="pe-rails"></div>
    <div class="pe-act"><button class="btn ghost xs" type="button" data-hook-test="${esc(h.id)}">${icon("send", 14)}Send test</button><button class="icon-btn danger-h" type="button" data-hook-del="${esc(h.id)}" aria-label="Delete ${esc(h.url)}" title="Delete">${icon("trash", 16)}</button></div>
  </li>`;
}

/** A list that did not load: the server's reason, and a retry. */
function loadError(error: unknown, which: "keys" | "hooks"): string {
  const reason = error instanceof ApiError ? error.message : "Could not load this list.";
  return `<div class="callout bad sm">${icon("alert", 14)}<span>${esc(reason)} <button type="button" class="link-sm" data-retry="${which}">Try again</button></span></div>`;
}

/** Shows a new key or secret once, with a copy button. */
function showOnce(opts: { title: string; what: "key" | "secret"; label: string; value: string; note: string }): Promise<boolean> {
  return dialog({
    title: opts.title,
    body: `<div class="callout warn">${icon("alert", 16)}<span><b>You will not see this ${opts.what} again.</b> Copy it now and keep it somewhere safe, such as a password manager or your server's secret store.</span></div>
      <div class="field"><span class="lbl" id="once-l">${esc(opts.label)}</span><div class="secret-row"><code class="secret" id="once-v" aria-labelledby="once-l">${esc(opts.value)}</code><button type="button" class="btn primary sm" data-copy-once>${icon("copy", 15)}Copy</button></div></div>
      <p class="fine">${opts.note}</p>`,
    onOpen: form => {
      const copy = form.querySelector<HTMLButtonElement>("[data-copy-once]")!;
      copy.addEventListener("click", () => void copyText(opts.value));
      copy.focus();
    },
  });
}

async function createKeyDialog(): Promise<ApiKeyCreated | null> {
  let made: ApiKeyCreated | null = null;
  await dialog({
    title: "Create API key",
    submit: "Create key",
    body: `<div class="field"><label for="k-name">Name</label><input id="k-name" name="name" maxlength="80" placeholder="ERP sync" autocomplete="off"><span class="fine">Say what uses it, so you know later which key to revoke.</span></div>
      <div class="field"><span class="lbl">Access</span>
        <div class="radio-cards">
          <label><input type="radio" name="scope" value="read" checked><span>${icon("eye", 16)}<b>Read only</b><em>See payments, documents, payees and balances</em></span></label>
          <label><input type="radio" name="scope" value="write"><span>${icon("edit", 16)}<b>Read &amp; write</b><em>Also draft payments, upload documents and chat</em></span></label>
        </div>
      </div>
      <div class="callout">${icon("shieldCheck", 16)}<span>${esc(HUMAN_ONLY)}</span></div>`,
    onSubmit: async form => {
      const name = val(form, "name");
      if (!name) return fieldError(form, "name", "Enter a name for this key.");
      const scopes: ApiKeyScope[] = val(form, "scope") === "write" ? ["read", "write"] : ["read"];
      made = await post<ApiKeyCreated>("/api/v1/api-keys", { name, scopes });
      return true;
    },
  });
  return made;
}

async function addHookDialog(): Promise<WebhookCreated | null> {
  let made: WebhookCreated | null = null;
  await dialog({
    title: "Add webhook endpoint",
    submit: "Add endpoint",
    body: `<div class="field"><label for="h-url">Endpoint URL</label><input id="h-url" name="url" type="url" class="mono" placeholder="https://example.com/webhooks/paylorya" autocomplete="off" spellcheck="false"></div>
      <div class="field"><span class="lbl">Events</span>
        <div class="radio-cards">${EVENTS.map(e => `<label><input type="checkbox" name="ev-${e.id}" value="${e.id}" checked><span>${icon(e.icon, 16)}<b class="mono">${e.id}</b><em>${esc(e.text)}</em></span></label>`).join("")}</div>
      </div>`,
    onSubmit: async form => {
      const url = val(form, "url");
      let parsed: URL | undefined;
      try {
        parsed = new URL(url);
      } catch {
        parsed = undefined;
      }
      if (!url) return fieldError(form, "url", "Enter the URL to send events to.");
      if (!parsed || !/^https?:$/.test(parsed.protocol)) return fieldError(form, "url", "Use a full URL, starting with https://");
      const events = EVENTS.map(e => e.id).filter(id => (form.elements.namedItem(`ev-${id}`) as HTMLInputElement | null)?.checked);
      if (!events.length) return fieldError(form, `ev-${EVENTS[0]!.id}`, "Choose at least one event.");
      made = await post<WebhookCreated>("/api/v1/webhooks", { url, events });
      return true;
    },
  });
  return made;
}

/** Loads the lists and handles every button in the section. `root` is #developers. */
function wireDevelopers(root: HTMLElement, ctx: Ctx): void {
  const keysEl = root.querySelector<HTMLElement>("[data-key-list]")!;
  const hooksCard = root.querySelector<HTMLElement>("#dev-hooks")!;
  const hooksEl = root.querySelector<HTMLElement>("[data-hook-list]")!;
  let keys: ApiKey[] = [];
  let hooks: Webhook[] = [];
  let showRevoked = false;

  const paintKeys = () => {
    const active = keys.filter(k => !k.revokedAt);
    const revoked = keys.filter(k => k.revokedAt);
    const rows = showRevoked ? [...active, ...revoked] : active;
    const list = rows.length
      ? `<ul class="payee-list">${rows.map(keyRow).join("")}</ul>`
      : empty({ icon: "key", title: "No API keys yet", text: "Create a key to let your own software read this account or draft payments.", action: `<button class="btn primary sm" type="button" data-key-new>${icon("plus", 15, 2.4)}Create your first key</button>` });
    const foot = keys.length
      ? `<div class="form-foot"><span class="muted small">${active.length} of ${MAX_KEYS} active keys</span>${revoked.length ? `<button type="button" class="link-sm" data-toggle-revoked>${showRevoked ? "Hide revoked keys" : `Show revoked keys (${revoked.length})`}</button>` : ""}</div>`
      : "";
    keysEl.innerHTML = list + foot;
  };
  const paintHooks = () => {
    hooksEl.innerHTML = hooks.length
      ? `<ul class="payee-list">${hooks.map(hookRow).join("")}</ul>`
      : empty({ icon: "webhook", title: "No endpoints yet", text: "Add a URL to hear about payments as they happen, instead of polling the API." });
  };

  const loadKeys = async () => {
    try {
      keys = await get<ApiKey[]>("/api/v1/api-keys", true);
      if (ctx.alive()) paintKeys();
    } catch (error) {
      if (ctx.alive()) keysEl.innerHTML = loadError(error, "keys");
    }
  };
  // Webhooks may not exist on this server yet: a 404 keeps the card hidden.
  const loadHooks = async () => {
    try {
      const list = await get<Webhook[]>("/api/v1/webhooks", true);
      if (!ctx.alive()) return;
      hooks = Array.isArray(list) ? list : [];
      hooksCard.hidden = false;
      paintHooks();
    } catch (error) {
      if (!ctx.alive()) return;
      if (error instanceof ApiError && error.status === 404) {
        hooksCard.hidden = true;
        return;
      }
      hooksCard.hidden = false;
      hooksEl.innerHTML = loadError(error, "hooks");
    }
  };

  root.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const cp = t.closest<HTMLElement>("[data-copy]");
    if (cp) return void copyText(cp.dataset.copy!);
    const retry = t.closest<HTMLElement>("[data-retry]");
    if (retry) return void (retry.dataset.retry === "keys" ? loadKeys() : loadHooks());
    if (t.closest("[data-toggle-revoked]")) {
      showRevoked = !showRevoked;
      return paintKeys();
    }

    if (t.closest("[data-key-new]")) {
      const made = await createKeyDialog();
      if (!made) return;
      const { key, ...stored } = made;
      if (ctx.alive()) {
        keys = [stored, ...keys];
        paintKeys();
      }
      await showOnce({
        title: "Your new API key",
        what: "key",
        label: `${made.name} · ${scopeLabel(made.scopes)}`,
        value: key,
        note: `Send it with each request as <span class="mono">Authorization: Bearer ${esc(made.prefix)}</span>. If it leaks, revoke it here: it stops working at once.`,
      });
      return;
    }
    const rv = t.closest<HTMLElement>("[data-revoke]");
    if (rv) {
      const k = keys.find(x => x.id === rv.dataset.revoke);
      if (!k || !(await confirmDialog(`Revoke ${k.name}?`, "Anything that uses this key stops working at once: its requests are refused. This cannot be undone.", "Revoke key", true))) return;
      try {
        await del(`/api/v1/api-keys/${encodeURIComponent(k.id)}`);
        toast("API key revoked", "ok");
        if (!ctx.alive()) return;
        keys = keys.map(x => (x.id === k.id ? { ...x, revokedAt: new Date().toISOString() } : x));
        paintKeys();
        void loadKeys();
      } catch {
        // the API layer showed the reason
      }
      return;
    }

    if (t.closest("[data-hook-new]")) {
      const made = await addHookDialog();
      if (!made) return;
      const { secret, ...stored } = made;
      if (ctx.alive()) {
        hooks = [...hooks, stored];
        paintHooks();
      }
      await showOnce({
        title: "Your webhook signing secret",
        what: "secret",
        label: `Signing secret for ${made.url}`,
        value: secret,
        note: "Use it to verify that a delivery comes from PayLorya AI. The API docs explain how.",
      });
      return;
    }
    const test = t.closest<HTMLButtonElement>("[data-hook-test]");
    if (test) {
      const h = hooks.find(x => x.id === test.dataset.hookTest);
      if (!h || test.disabled) return;
      test.disabled = true;
      test.classList.add("loading");
      try {
        // The server sends the ping at once and reports the endpoint's answer (src/cfo/webhooks.ts, ping).
        const r = await post<{ delivered: boolean; status: number; error?: string } | undefined>(`/api/v1/webhooks/${encodeURIComponent(h.id)}/test`);
        if (r && !r.delivered) toast(`${hostOf(h.url)} did not accept the test event: ${r.error || `HTTP ${r.status}`}.`, "error");
        else toast(`Test event sent to ${hostOf(h.url)}`, "ok");
      } catch {
        // the API layer showed the reason
      } finally {
        test.disabled = false;
        test.classList.remove("loading");
      }
      return;
    }
    const hd = t.closest<HTMLElement>("[data-hook-del]");
    if (hd) {
      const h = hooks.find(x => x.id === hd.dataset.hookDel);
      if (!h || !(await confirmDialog("Delete this endpoint?", `PayLorya AI stops sending events to ${h.url}.`, "Delete endpoint", true))) return;
      try {
        await del(`/api/v1/webhooks/${encodeURIComponent(h.id)}`);
        toast("Webhook endpoint deleted", "ok");
        if (!ctx.alive()) return;
        hooks = hooks.filter(x => x.id !== h.id);
        paintHooks();
      } catch {
        // the API layer showed the reason
      }
    }
  });

  void loadKeys();
  void loadHooks();
}
