// Connections: wallets and accounts with balances, access level, refresh, remove; add from catalog.
import { esc, short } from "../../shared/dom.js";
import { del, get, patch, post } from "../api.js";
import type { Ctx } from "../state.js";
import type { Access, CatalogEntry, Connection, ConnectionCreate, ConnectionKind, CxcState } from "../types.js";
import { ago, balance, confirmDialog, copyText, dialog, empty, fieldError, icon, pageHead, sk, toast, usd, val } from "../ui.js";
import { cardanoWallets, connectCardano, connectEvm, hasEvmWallet } from "../wallets.js";

const KIND_ICON: Record<ConnectionKind, string> = {
  cardano_agent_wallet: "bot",
  cardano_wallet: "wallet",
  evm_wallet: "globe",
  cashxchain: "zap",
  bank: "bank",
};
const NETWORK: Record<string, [string, string]> = {
  "cardano:preprod": ["Cardano Preprod", "testnet"],
  "cardano:mainnet": ["Cardano", ""],
  ethereum: ["Ethereum", ""],
  "cashxchain:sandbox": ["CashXChain", "sandbox"],
  bank: ["Bank", ""],
};
const PLACEHOLDER: Partial<Record<ConnectionKind, string>> = { cardano_wallet: "addr_test1…", evm_wallet: "0x…" };
const CXC_KEY = /^cxc_(sk|rk)_sandbox_[A-Za-z0-9]+$/;

// Set from GET /api/v1/cashxchain: a linked sub-account is what a key-less CashXChain connection reads.
let cxcLinked = false;

/** Whose CashXChain account a connection reads: the workspace's own key, its sub-account, or the shared one. */
function cxcOwner(c: Connection): string {
  if (c.kind !== "cashxchain") return "";
  if (c.keyHint) return `<div class="addr-row owner"><span class="muted small">Your account · key</span><span class="mono" title="Stored encrypted">${esc(c.keyHint)}</span></div>`;
  return `<div class="addr-row owner"><span class="muted small">${cxcLinked ? "Your linked CashXChain sub-account" : "PayLorya AI shared sandbox account"}</span></div>`;
}

/** "Connect Lace" buttons for the browser wallets found; they fill the address field. */
function walletButtons(kind: ConnectionKind): string {
  if (kind !== "cardano_wallet" && kind !== "evm_wallet") return "";
  const wallets: Array<{ id: string; name: string; icon?: string }> =
    kind === "cardano_wallet" ? cardanoWallets() : hasEvmWallet() ? [{ id: "ethereum", name: "browser wallet" }] : [];
  if (!wallets.length) {
    const which = kind === "cardano_wallet" ? "a Cardano wallet such as Lace or Eternl" : "an EVM wallet such as MetaMask";
    return `<p class="fine">${icon("info", 13)} No browser wallet found. Install ${which} to connect with one click, or paste the address.</p>`;
  }
  return `<div class="field"><span class="lbl">Connect a wallet</span><div class="wallet-pick">${wallets
    .map(w => `<button type="button" class="btn ghost sm" data-wallet="${esc(w.id)}">${w.icon ? `<img src="${esc(w.icon)}" alt="" width="18" height="18">` : icon("wallet", 16)}Connect ${esc(w.name)}</button>`)
    .join("")}</div><span class="fine">Your wallet asks for permission and shares this address only: the AI CFO reads balances, it can never sign.</span></div>`;
}

function networkPill(n: string): string {
  const [name, note] = NETWORK[n] ?? [n, ""];
  return `<span class="net">${esc(name)}${note ? `<em>${esc(note)}</em>` : ""}</span>`;
}

function connCard(c: Connection, i: number): string {
  const total = c.balances.reduce((a, b) => a + (b.usdMinor ?? 0), 0);
  const hasUsd = c.balances.some(b => b.usdMinor != null);
  return `<article class="card conn reveal ${c.status}" data-id="${esc(c.id)}" style="--d:${i * 40}ms">
    <div class="conn-head">
      <span class="conn-ic k-${c.kind}">${icon(KIND_ICON[c.kind] ?? "link", 20)}</span>
      <div class="conn-t"><h3>${esc(c.label)}</h3>${networkPill(c.network)}</div>
      <span class="pill ${c.status === "active" ? "t-ok" : c.status === "error" ? "t-bad" : "t-neutral"}">${c.status === "active" ? '<i class="live"></i>Active' : c.status === "error" ? "Error" : "Coming soon"}</span>
    </div>
    ${cxcOwner(c)}
    ${c.address ? `<div class="addr-row"><span class="mono" title="${esc(c.address)}">${esc(short(c.address))}</span><button type="button" class="icon-btn xs" data-copy="${esc(c.address)}" aria-label="Copy address">${icon("copy", 13)}</button></div>` : ""}
    ${c.error ? `<div class="callout bad sm">${icon("alert", 14)}<span>${esc(c.error)}</span></div>` : ""}
    <div class="conn-bal">
      ${hasUsd ? `<b class="conn-total">${esc(usd(total))}</b><span class="muted small">indicative USD</span>` : ""}
      <ul>${c.balances.length ? c.balances.map(b => `<li><span>${esc(b.asset)}</span><b>${esc(balance(b))}</b></li>`).join("") : `<li class="muted small">No balances reported</li>`}</ul>
    </div>
    <div class="conn-access">
      <span class="label-sm">Agent access</span>
      <div class="seg${c.supports.write ? "" : " disabled"}" role="radiogroup" aria-label="Access for ${esc(c.label)}">
        <button type="button" role="radio" aria-checked="${c.access === "read"}" data-access="read" ${c.supports.write ? "" : "disabled"}>${icon("eye", 14)}Read-only</button>
        <button type="button" role="radio" aria-checked="${c.access === "read_write"}" data-access="read_write" ${c.supports.write ? "" : "disabled"}>${icon("pay", 14)}Read &amp; write</button>
      </div>
      ${c.supports.write ? "" : `<span class="fine">Watch-only: this connection cannot send payments.</span>`}
    </div>
    <div class="conn-foot"><span class="muted small">Added ${esc(ago(c.createdAt))}</span>
      <span><button type="button" class="icon-btn" data-rename aria-label="Rename">${icon("edit", 16)}</button><button type="button" class="icon-btn" data-refresh aria-label="Refresh balances" title="Refresh balances">${icon("refresh", 16)}</button><button type="button" class="icon-btn danger-h" data-remove aria-label="Remove connection" title="Remove">${icon("trash", 16)}</button></span></div>
  </article>`;
}

const CXC_NEXT: Record<string, (email: string) => string> = {
  needs_signup: email => `Sign up at the CashXChain sandbox with <b>${esc(email)}</b>, sign in once, then link.`,
  needs_signin: email => `<b>${esc(email)}</b> has a CashXChain account that was never signed in to. Sign in once, then link.`,
  other_platform: email => `<b>${esc(email)}</b> already belongs to another CashXChain platform. Use another email, or end that grant in CashXChain first.`,
  error: () => "CashXChain could not be reached or refused the link. Try again.",
};

/** Your CashXChain sub-account: a sandbox managed account attached by your sign-in email. */
function cxcPanel(s: CxcState): string {
  if (!s.platform) return "";
  const l = s.link;
  if (l?.status === "linked") {
    const accounts = s.accounts?.length
      ? `<ul class="cxc-acc">${s.accounts.map(a => `<li><span>${esc(a.currency)}</span><b>${esc(a.available ?? "–")}</b></li>`).join("")}</ul>`
      : s.accountsError
        ? `<span class="muted small">${esc(s.accountsError)}</span>`
        : `<span class="muted small">No currency accounts yet.</span>`;
    return `<div class="callout info">${icon("zap", 18)}<div><b>CashXChain sub-account linked</b> <span class="pill t-neutral">sandbox</span><br>
      <span class="mono small">${esc(l.accountId ?? "")}</span> · KYB ${esc(l.kybStatus ?? "unknown")} · ${esc(l.email)}<br>
      ${accounts}
      <span class="fine">Your CashXChain connection reads this account. Payouts from it need CashXChain's money permission for this platform${l.canMoveMoney ? " (granted)" : " (not granted yet)"}.</span></div></div>`;
  }
  const next = l ? (CXC_NEXT[l.status] ?? CXC_NEXT.error!)(l.email) : "Linking your CashXChain sandbox sub-account…";
  return `<div class="callout${l?.status === "error" ? " bad" : ""}">${icon("link", 18)}<div><b>CashXChain sub-account not linked yet</b><br>${next}
    ${l?.detail ? `<br><span class="fine">${esc(l.detail)}</span>` : ""}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost xs" href="${esc(s.signupUrl)}" target="_blank" rel="noopener">${icon("external", 14)}CashXChain sign-up</a><button type="button" class="btn primary xs" data-cxc-link>${icon("link", 14)}Link now</button></div></div></div>`;
}

async function addDialog(entry: CatalogEntry): Promise<Connection | null> {
  let made: Connection | null = null;
  await dialog({
    title: `Connect ${entry.name}`,
    submit: "Connect",
    body: `<p class="dlg-text">${esc(entry.description)}</p>
      <div class="field"><label for="c-label">Name <span class="opt-l">optional</span></label><input id="c-label" name="label" placeholder="${esc(entry.name)}" autocomplete="off"></div>
      ${entry.needsAddress ? walletButtons(entry.kind) : ""}
      ${entry.needsAddress ? `<div class="field"><label for="c-addr">Address</label><input id="c-addr" name="address" class="mono" placeholder="${esc(PLACEHOLDER[entry.kind] ?? "Address")}" autocomplete="off" spellcheck="false"></div>` : ""}
      ${
        entry.acceptsApiKey
          ? `<div class="field"><label for="c-key">API key${entry.sharedFallback ? ' <span class="opt-l">optional</span>' : ""}</label><input id="c-key" name="apiKey" type="password" class="mono" placeholder="cxc_sk_sandbox_…" autocomplete="off" spellcheck="false">
        <span class="fine">From your CashXChain sandbox dashboard: a secret key, or a restricted key with accounts:read (to pay, also payments:read, payments:write and beneficiaries:write). Stored encrypted; shown again only by its last four characters.${entry.sharedFallback ? " Leave empty to use PayLorya AI's shared sandbox account." : ""}</span></div>`
          : ""
      }
      <div class="field"><span class="lbl">Agent access</span>
        <div class="radio-cards">
          <label><input type="radio" name="access" value="read" checked><span>${icon("eye", 16)}<b>Read-only</b><em>See balances and history</em></span></label>
          <label class="${entry.supports.write ? "" : "off"}"><input type="radio" name="access" value="read_write" ${entry.supports.write ? "" : "disabled"}><span>${icon("pay", 16)}<b>Read &amp; write</b><em>${entry.supports.write ? "May also send payments, within your policy" : "Not supported by this connection"}</em></span></label>
        </div>
      </div>
      ${entry.kind === "cardano_agent_wallet" || entry.kind === "cardano_wallet" ? `<p class="fine">${icon("info", 13)} Cardano Preprod is a test network. Balances are tADA with no real value.</p>` : ""}
      ${entry.kind === "cashxchain" ? `<p class="fine">${icon("info", 13)} CashXChain sandbox: a test ledger, no real money moves.</p>` : ""}`,
    onOpen: form => {
      form.addEventListener("click", async e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-wallet]");
        if (!b || b.disabled) return;
        b.disabled = true;
        b.classList.add("loading");
        try {
          const address = entry.kind === "cardano_wallet" ? await connectCardano(b.dataset.wallet!) : await connectEvm();
          const input = form.elements.namedItem("address") as HTMLInputElement | null;
          if (input) {
            input.value = address;
            input.closest(".field")?.classList.remove("invalid");
          }
          toast("Address taken from your wallet", "ok");
        } catch (error) {
          fieldError(form, "address", error instanceof Error ? error.message : "The wallet could not be connected.");
        } finally {
          b.disabled = false;
          b.classList.remove("loading");
        }
      });
    },
    onSubmit: async form => {
      const body: ConnectionCreate = { kind: entry.kind, access: (val(form, "access") || "read") as Access };
      const label = val(form, "label");
      if (label) body.label = label;
      if (entry.acceptsApiKey) {
        const apiKey = val(form, "apiKey");
        if (apiKey && !CXC_KEY.test(apiKey)) return fieldError(form, "apiKey", "Use a CashXChain sandbox key: cxc_sk_sandbox_… or cxc_rk_sandbox_…");
        if (!apiKey && !entry.sharedFallback) return fieldError(form, "apiKey", "Paste your CashXChain sandbox API key.");
        if (apiKey) body.apiKey = apiKey;
      }
      if (entry.needsAddress) {
        const address = val(form, "address");
        if (!address) return fieldError(form, "address", "Paste the wallet address.");
        if (entry.kind === "cardano_wallet" && !/^addr_test1[0-9a-z]{20,}$/.test(address)) return fieldError(form, "address", "Use a Cardano Preprod address (addr_test1…).");
        if (entry.kind === "evm_wallet" && !/^0x[0-9a-fA-F]{40}$/.test(address)) return fieldError(form, "address", "Use an EVM address (0x followed by 40 hex characters).");
        body.address = address;
      }
      made = await post<Connection>("/api/v1/connections", body);
      toast(`${made.label} connected`, "ok");
      return true;
    },
  });
  return made;
}

export async function renderConnections(view: HTMLElement, ctx: Ctx): Promise<void> {
  let conns: Connection[] = [];
  let catalog: CatalogEntry[] = [];
  view.innerHTML = `${pageHead("Connections", "Wallets and accounts your AI CFO can see, and the ones it may pay from.", `<a class="btn primary sm" href="#add" id="c-add-top">${icon("plus", 16, 2.4)}Add connection</a>`)}
    <div id="c-cxc"></div>
    <section class="conn-grid" id="c-grid">${Array.from({ length: 3 }, () => `<div class="card">${sk("50%", 18)}<div style="height:14px"></div>${sk("30%", 12)}<div style="height:28px"></div>${sk("60%", 26)}<div style="height:22px"></div>${sk("100%", 38, 12)}</div>`).join("")}</section>
    <section class="catalog" id="add"><div class="section-h"><h2>Add a connection</h2><p class="muted">Read-only by default. Grant write access only where you want the agent to be able to pay from.</p></div><div class="cat-grid" id="c-cat"></div></section>`;
  const grid = view.querySelector<HTMLElement>("#c-grid")!;
  const catEl = view.querySelector<HTMLElement>("#c-cat")!;
  const cxcEl = view.querySelector<HTMLElement>("#c-cxc")!;
  const paintCxc = (s: CxcState) => {
    cxcEl.innerHTML = cxcPanel(s);
    const linked = s.link?.status === "linked";
    if (linked !== cxcLinked) {
      cxcLinked = linked;
      if (conns.some(c => c.kind === "cashxchain" && !c.keyHint)) paint();
    }
  };
  void get<CxcState>("/api/v1/cashxchain", true).then(s => ctx.alive() && paintCxc(s), () => undefined);
  cxcEl.addEventListener("click", async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cxc-link]");
    if (!b) return;
    b.disabled = true;
    b.classList.add("loading");
    try {
      const s = await post<CxcState>("/api/v1/cashxchain/link");
      if (!ctx.alive()) return;
      paintCxc(s);
      toast(s.link?.status === "linked" ? "CashXChain sub-account linked" : "Not linked yet: see the note", s.link?.status === "linked" ? "ok" : undefined);
    } catch {
      b.disabled = false;
      b.classList.remove("loading");
    }
  });

  const paint = () => {
    grid.innerHTML = conns.length
      ? conns.map(connCard).join("")
      : `<div class="card wide-empty">${empty({ icon: "link", title: "No connections yet", text: "Connect your Cardano agent wallet, a watch-only wallet or your CashXChain sandbox account below. Your AI CFO starts reading balances right away." })}</div>`;
  };
  const paintCatalog = () => {
    catEl.innerHTML = catalog
      .map(
        c => `<button type="button" class="cat-item${c.available ? "" : " soon"}" data-kind="${esc(c.kind)}" ${c.available ? "" : "disabled"}>
        <span class="conn-ic k-${c.kind}">${icon(KIND_ICON[c.kind] ?? "link", 20)}</span>
        <span class="cat-t"><b>${esc(c.name)}</b><span>${esc(c.description)}</span></span>
        <span class="cat-f">${c.available ? `<span class="caps">${c.supports.write ? "Read &amp; write" : "Read-only"}</span><span class="cat-go">${icon("plus", 16, 2.4)}</span>` : `<span class="pill t-neutral">Coming soon</span>`}</span>
      </button>`,
      )
      .join("");
  };
  const replace = (c: Connection) => {
    conns = conns.map(x => (x.id === c.id ? c : x));
    const el = grid.querySelector(`[data-id="${CSS.escape(c.id)}"]`);
    if (el) {
      const tmp = document.createElement("div");
      tmp.innerHTML = connCard(c, 0);
      const n = tmp.firstElementChild as HTMLElement;
      n.classList.remove("reveal");
      el.replaceWith(n);
    }
  };

  view.querySelector("#c-add-top")!.addEventListener("click", e => {
    e.preventDefault();
    view.querySelector("#add")!.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  catEl.addEventListener("click", async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
    const entry = b && catalog.find(c => c.kind === b.dataset.kind);
    if (!entry || !entry.available) return;
    const c = await addDialog(entry);
    if (c && ctx.alive()) {
      conns.push(c);
      paint();
      grid.querySelector(`[data-id="${CSS.escape(c.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  grid.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const cp = t.closest<HTMLElement>("[data-copy]");
    if (cp) return void copyText(cp.dataset.copy!);
    const card = t.closest<HTMLElement>(".conn");
    const c = card && conns.find(x => x.id === card.dataset.id);
    if (!c || !card) return;
    const path = `/api/v1/connections/${encodeURIComponent(c.id)}`;
    const acc = t.closest<HTMLButtonElement>("[data-access]");
    if (acc && !acc.disabled) {
      const access = acc.dataset.access as Access;
      if (access === c.access) return;
      if (access === "read_write" && !(await confirmDialog("Allow payments from this connection?", `With read & write access the agent can send payments from “${c.label}”, always within your agent access policy and limits.`, "Allow read & write"))) return;
      try {
        replace(await patch<Connection>(path, { access }));
        toast(access === "read" ? `${c.label} is now read-only` : `${c.label} can now be used for payments`, "ok");
      } catch {
        // toast shown
      }
      return;
    }
    if (t.closest("[data-refresh]")) {
      const btn = t.closest<HTMLButtonElement>("[data-refresh]")!;
      btn.classList.add("spinning");
      btn.disabled = true;
      try {
        replace(await post<Connection>(`${path}/refresh`));
        toast("Balances refreshed", "ok");
      } catch {
        btn.classList.remove("spinning");
        btn.disabled = false;
      }
      return;
    }
    if (t.closest("[data-rename]")) {
      await dialog({
        title: "Rename connection",
        submit: "Save",
        body: `<div class="field"><label for="r-label">Name</label><input id="r-label" name="label" value="${esc(c.label)}" autocomplete="off"></div>`,
        onSubmit: async form => {
          const label = val(form, "label");
          if (!label) return fieldError(form, "label", "Enter a name.");
          replace(await patch<Connection>(path, { label }));
          return true;
        },
      });
      return;
    }
    if (t.closest("[data-remove]")) {
      if (!(await confirmDialog(`Remove ${c.label}?`, "Your AI CFO will stop reading this connection and can no longer pay from it. Nothing on-chain or in your account changes.", "Remove", true))) return;
      try {
        await del(path);
        conns = conns.filter(x => x.id !== c.id);
        paint();
        toast("Connection removed", "ok");
      } catch {
        // toast shown
      }
    }
  });

  const [cs, cat] = await Promise.all([get<Connection[]>("/api/v1/connections"), get<CatalogEntry[]>("/api/v1/connections/catalog", true).catch(() => [])]);
  if (!ctx.alive()) return;
  conns = cs;
  catalog = cat.sort((a, b) => Number(b.available) - Number(a.available));
  paint();
  paintCatalog();
}
