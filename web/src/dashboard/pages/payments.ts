// Payments: approvals queue, full history with policy checks, new payment dialog.
import { esc, short, shortHash } from "../../shared/dom.js";
import { ApiError, get, post } from "../api.js";
import { type Ctx, refreshBadges } from "../state.js";
import type { Payee, PayeeInput, Payment, PaymentCreate } from "../types.js";
import { cardanoWallets, signCardano } from "../wallets.js";
import {
  amount,
  avatar,
  date,
  dateTime,
  dialog,
  empty,
  fieldError,
  icon,
  pageHead,
  railChip,
  skLines,
  statusPill,
  toast,
  toMinor,
  usd,
  val,
} from "../ui.js";


export async function decide(id: string, action: "approve" | "reject"): Promise<Payment> {
  const p = await post<Payment>(`/api/v1/payments/${encodeURIComponent(id)}/${action}`);
  toast(
    action === "approve"
      ? p.status === "executed"
        ? `Approved and paid ${p.payeeName}`
        : p.status === "failed" || p.status === "blocked"
          ? `Approved, but the payment ${p.status === "failed" ? "failed" : "was blocked"}`
          : p.currency === "ADA"
            ? `Approved. Sign the payment to ${p.payeeName} in your wallet in a moment.`
            : `Approved. Paying ${p.payeeName}…`
      : `Rejected payment to ${p.payeeName}`,
    action === "approve" && (p.status === "failed" || p.status === "blocked") ? "error" : "ok",
  );
  void refreshBadges();
  return p;
}

const CHECK_ICON = { pass: "check", warn: "alert", fail: "x" } as const;
export function checksList(p: Payment): string {
  if (!p.policy.checks.length) return `<p class="muted small">No policy checks recorded.</p>`;
  return `<ul class="checks">${p.policy.checks
    .map(c => `<li class="ck-${c.status}"><span class="ck-ic">${icon(CHECK_ICON[c.status], 12, 2.8)}</span><span>${esc(c.message)}</span></li>`)
    .join("")}</ul>`;
}
const DECISION: Record<Payment["policy"]["decision"], [string, string]> = {
  auto: ["Within agent limits", "t-ok"],
  approval: ["Needs your approval", "t-warn"],
  blocked: ["Blocked by policy", "t-bad"],
};
/** An unsaved payee's account, as carried by the draft: what approving would pay. */
function destinationText(p: Payment): string {
  const d = p.destination;
  const parts = [
    d?.iban ? `IBAN ${d.iban}` : "",
    d?.bic ? `BIC ${d.bic}` : "",
    d?.routingNumber ? `ABA ${d.routingNumber} / ${d.accountNumber ?? "?"}` : "",
    d?.cardanoAddress ? short(d.cardanoAddress) : "",
  ].filter(Boolean);
  return parts.length ? `<span class="mono">${esc(parts.join(" · "))}</span> <span class="pill t-warn">not saved</span>` : `<span class="muted">No account details</span>`;
}

function checkSummary(p: Payment): string {
  const c = p.policy.checks;
  const fail = c.filter(x => x.status === "fail").length;
  const warn = c.filter(x => x.status === "warn").length;
  const pass = c.filter(x => x.status === "pass").length;
  return `<span class="ck-sum">${pass ? `<span class="ck-pass">${icon("check", 11, 3)}${pass}</span>` : ""}${warn ? `<span class="ck-warn">${icon("alert", 11, 2.6)}${warn}</span>` : ""}${fail ? `<span class="ck-fail">${icon("x", 11, 3)}${fail}</span>` : ""}</span>`;
}

/** Inline approve/reject buttons; the containing element needs data-pid. */
// Payments whose wallet popup is open: a refresh of the list must not offer to sign them twice.
const signing = new Set<string>();

/** "Sign with Lace" (one per wallet in this browser) and Cancel, while a tADA payout waits. */
function signButtons(p: Payment): string {
  const r = p.signRequest!;
  const busy = signing.has(p.id);
  const wallets = cardanoWallets();
  const data = `data-pid="${esc(p.id)}" data-tx="${esc(r.txHash)}" data-cbor="${esc(r.txCbor)}" data-addr="${esc(r.address)}"`;
  const sign = wallets.length
    ? wallets
        .map(w => `<button type="button" class="btn primary xs${busy ? " loading" : ""}" data-act="sign" data-wallet="${esc(w.id)}" ${data} ${busy ? "disabled" : ""}>${icon("wallet", 14)}Sign with ${esc(w.name)}</button>`)
        .join("")
    : `<span class="muted small">Install Lace or Eternl to sign</span>`;
  return `<span class="decide"><button type="button" class="btn ghost xs" data-act="decline" ${data} ${busy ? "disabled" : ""}>Cancel</button>${sign}</span>`;
}

/** A payment that waits for its owner: an approval, or a wallet signature. */
export const needsYou = (p: Payment): boolean => p.status === "pending_approval" || (p.status === "executing" && Boolean(p.signRequest));

export const decisionButtons = (p: Payment): string =>
  p.status === "pending_approval"
    ? `<span class="decide"><button type="button" class="btn ghost xs" data-act="reject" data-pid="${esc(p.id)}">Reject</button><button type="button" class="btn primary xs" data-act="approve" data-pid="${esc(p.id)}">${icon("check", 14, 2.6)}Approve</button></span>`
    : p.status === "executing" && p.signRequest
      ? signButtons(p)
      : "";

export function paymentRow(p: Payment, open = false): string {
  const isAda = p.currency === "ADA";
  return `<li class="pay-row${open ? " open" : ""}" data-row="${esc(p.id)}" id="pay-${esc(p.id)}">
    <div class="pay-main" role="button" tabindex="0" aria-expanded="${open}" data-toggle>
      ${avatar(p.payeeName)}
      <div class="pay-who"><b>${esc(p.payeeName)}</b><span>${esc(p.reason || "No reason given")}</span></div>
      <div class="pay-rail">${railChip(p.rail)}</div>
      <div class="pay-by"><span class="by by-${p.requestedBy}">${icon(p.requestedBy === "agent" ? "bot" : "user", 13, 2)}${p.requestedBy === "agent" ? "Agent" : "You"}</span><em>${esc(date(p.createdAt))}</em></div>
      <div class="pay-amt"><b>${esc(amount(p.amountMinor, p.currency))}</b>${isAda || p.currency !== "USD" ? `<span>≈ ${esc(usd(p.usdMinor))}</span>` : ""}</div>
      <div class="pay-status">${p.signRequest ? `<span class="pill t-warn">${icon("wallet", 12)}Sign in wallet</span>` : statusPill(p.status)}${checkSummary(p)}</div>
      <div class="pay-act">${decisionButtons(p)}<span class="chev">${icon("chevronDown", 16)}</span></div>
    </div>
    <div class="pay-detail"><div class="pay-detail-in">
      <div class="pd-col">
        <div class="pd-h">Policy checks <span class="pill ${DECISION[p.policy.decision][1]}">${DECISION[p.policy.decision][0]}</span></div>
        ${checksList(p)}
        ${p.signRequest ? `<div class="callout info">${icon("wallet", 15)}<span>Waiting for your signature until ${esc(dateTime(p.signRequest.expiresAt))}. Your wallet shows payee, amount and fee before you confirm; nothing is sent without it.</span></div>` : ""}
        ${p.error ? `<div class="callout bad">${icon("alert", 15)}<span>${esc(p.error)}</span></div>` : ""}
      </div>
      <dl class="pd-col kv">
        <dt>Amount</dt><dd>${esc(amount(p.amountMinor, p.currency))}${isAda ? ' <span class="pill t-neutral">testnet</span>' : ""}</dd>
        <dt>Rail</dt><dd>${railChip(p.rail)}</dd>
        <dt>Pays to</dt><dd>${p.payeeId ? "Saved payee account" : destinationText(p)}</dd>
        <dt>Requested by</dt><dd>${p.requestedBy === "agent" ? "AI CFO agent" : "You"}${p.runId ? ` <span class="mono muted">${esc(p.runId)}</span>` : ""}</dd>
        ${p.reference ? `<dt>Reference</dt><dd class="mono">${esc(p.reference)}</dd>` : ""}
        ${p.txHash ? `<dt>Transaction</dt><dd>${p.explorerUrl ? `<a class="mono" href="${esc(p.explorerUrl)}" target="_blank" rel="noopener noreferrer">${esc(shortHash(p.txHash))} ${icon("external", 12)}</a>` : `<span class="mono">${esc(shortHash(p.txHash))}</span>`}</dd>` : ""}
        ${p.documentId ? `<dt>Document</dt><dd><a href="/app/documents/${esc(p.documentId)}">Open source document</a></dd>` : ""}
        <dt>Created</dt><dd>${esc(dateTime(p.createdAt))}</dd>
        ${p.decidedAt ? `<dt>Decided</dt><dd>${esc(dateTime(p.decidedAt))}</dd>` : ""}
        ${p.executedAt ? `<dt>Executed</dt><dd>${esc(dateTime(p.executedAt))}</dd>` : ""}
      </dl>
    </div></div>
  </li>`;
}

/** Wires expand/collapse and approve/reject on a list of payment rows. */
export function wirePaymentList(root: HTMLElement, onChange: (p: Payment) => void): void {
  root.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLButtonElement>("[data-act]");
    if (act && (act.dataset.act === "sign" || act.dataset.act === "decline")) {
      e.stopPropagation();
      const id = act.dataset.pid!;
      const group = act.closest(".decide");
      for (const b of group?.querySelectorAll("button") ?? []) (b as HTMLButtonElement).disabled = true;
      act.classList.add("loading");
      signing.add(id);
      try {
        const body =
          act.dataset.act === "sign"
            ? { txHash: act.dataset.tx!, witnessSet: await signCardano(act.dataset.wallet!, { txCbor: act.dataset.cbor!, address: act.dataset.addr! }) }
            : { declined: true };
        await post(`/api/v1/payments/${encodeURIComponent(id)}/signature`, body);
        toast(act.dataset.act === "sign" ? "Signed. Sending the payment…" : "Payment cancelled: nothing was sent", "ok");
      } catch (error) {
        // API errors are toasted by the API layer; wallet errors are not.
        if (error instanceof Error && !(error instanceof ApiError)) toast(error.message, "error");
      } finally {
        signing.delete(id);
        const fresh = (await get<Payment[]>("/api/v1/payments").catch(() => [] as Payment[])).find(x => x.id === id);
        if (fresh) onChange(fresh);
      }
      return;
    }
    if (act) {
      e.stopPropagation();
      const id = act.dataset.pid!;
      const action = act.dataset.act as "approve" | "reject";
      const group = act.closest(".decide");
      for (const b of group?.querySelectorAll("button") ?? []) (b as HTMLButtonElement).disabled = true;
      act.classList.add("loading");
      try {
        onChange(await decide(id, action));
      } catch {
        for (const b of group?.querySelectorAll("button") ?? []) (b as HTMLButtonElement).disabled = false;
        act.classList.remove("loading");
      }
      return;
    }
    const tog = t.closest<HTMLElement>("[data-toggle]");
    if (tog && !t.closest("a")) {
      const row = tog.closest(".pay-row")!;
      row.classList.toggle("open");
      tog.setAttribute("aria-expanded", String(row.classList.contains("open")));
    }
  });
  root.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if ((e.key === "Enter" || e.key === " ") && t.matches("[data-toggle]")) {
      e.preventDefault();
      t.click();
    }
  });
}

const CURRENCIES: Array<[string, string]> = [
  ["USD", "USD"],
  ["EUR", "EUR"],
  ["GBP", "GBP"],
  ["CHF", "CHF"],
  ["ADA", "tADA (Cardano Preprod)"],
];
export const currencyOptions = (sel = "USD") =>
  CURRENCIES.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");

export function majorFromMinor(minor: number | undefined, currency: string): string {
  if (minor == null) return "";
  const e = currency === "ADA" ? 6 : currency === "JPY" ? 0 : 2;
  return String(minor / 10 ** e);
}

/** "New payment" dialog. Lets the user pick a payee or add one inline. Resolves with the payment. */
export async function newPaymentDialog(prefill: Partial<PaymentCreate> & { counterparty?: string } = {}): Promise<Payment | null> {
  const payees = await get<Payee[]>("/api/v1/payees");
  const match = prefill.counterparty ? payees.find(p => p.name.toLowerCase() === prefill.counterparty!.toLowerCase()) : undefined;
  const selected = prefill.payeeId ?? match?.id ?? "";
  const cur = prefill.currency ?? "USD";
  let created: Payment | null = null;
  await dialog({
    title: "New payment",
    submit: "Create payment",
    body: `
      <div class="field"><label for="np-payee">Payee</label>
        <select id="np-payee" name="payeeId">
          <option value="" disabled${selected ? "" : " selected"}>Choose a payee…</option>
          ${payees.map(p => `<option value="${esc(p.id)}"${p.id === selected ? " selected" : ""}>${esc(p.name)}${p.cardanoAddress ? " · Cardano" : p.iban ? " · IBAN" : p.accountNumber ? " · ACH" : ""}</option>`).join("")}
          <option value="__new">+ Add a new payee…</option>
        </select>
      </div>
      <div class="np-new" hidden>
        <div class="sub-card">
          <div class="field"><label for="np-name">Payee name</label><input id="np-name" name="newName" autocomplete="off" value="${esc(match ? "" : (prefill.counterparty ?? ""))}" placeholder="Acme GmbH"></div>
          <div class="grid2">
            <div class="field"><label for="np-iban">IBAN <span class="opt-l">optional</span></label><input id="np-iban" name="newIban" autocomplete="off" placeholder="DE89 3704 0044 …"></div>
            <div class="field"><label for="np-country">Country <span class="opt-l">optional</span></label><input id="np-country" name="newCountry" maxlength="2" placeholder="DE"></div>
          </div>
          <div class="field"><label for="np-ada">Cardano address <span class="opt-l">optional, Preprod</span></label><input id="np-ada" name="newAda" class="mono" autocomplete="off" placeholder="addr_test1…"></div>
          <p class="fine">Saved to your payee directory. Add full bank details later on the Payees page.</p>
        </div>
      </div>
      <div class="grid2 amt-grid">
        <div class="field"><label for="np-amount">Amount</label><input id="np-amount" name="amount" inputmode="decimal" placeholder="0.00" value="${esc(majorFromMinor(prefill.amountMinor, cur))}"></div>
        <div class="field"><label for="np-cur">Currency</label><select id="np-cur" name="currency">${currencyOptions(cur)}</select></div>
      </div>
      <div class="field"><label for="np-reason">Reason</label><textarea id="np-reason" name="reason" rows="2" placeholder="Invoice INV-1042, October hosting">${esc(prefill.reason ?? "")}</textarea></div>
      <div class="callout">${icon("shield", 15)}<span>Code checks every payment against your policy before anything moves. tADA runs on Cardano Preprod (testnet); fiat runs on the CashXChain sandbox rail.</span></div>`,
    onOpen: form => {
      const sel = form.elements.namedItem("payeeId") as HTMLSelectElement;
      const box = form.querySelector<HTMLElement>(".np-new")!;
      const sync = () => {
        box.hidden = sel.value !== "__new";
        if (!box.hidden) (form.elements.namedItem("newName") as HTMLInputElement).focus();
      };
      sel.addEventListener("change", sync);
      if (!payees.length) {
        sel.value = "__new";
        sync();
      }
    },
    onSubmit: async form => {
      let payeeId = val(form, "payeeId");
      const currency = val(form, "currency");
      const amountMinor = toMinor(val(form, "amount"), currency);
      const reason = val(form, "reason");
      if (!payeeId) return fieldError(form, "payeeId", "Choose who to pay.");
      if (payeeId === "__new" && !val(form, "newName")) return fieldError(form, "newName", "Enter the payee's name.");
      const ada = val(form, "newAda");
      if (payeeId === "__new" && ada && !/^addr_test1[0-9a-z]+$/.test(ada)) return fieldError(form, "newAda", "Use a Cardano Preprod address (addr_test1…).");
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) return fieldError(form, "amount", "Enter an amount above zero.");
      if (!reason) return fieldError(form, "reason", "Add a short reason. It appears in the audit log.");
      if (payeeId === "__new") {
        const input: PayeeInput = { name: val(form, "newName") };
        const iban = val(form, "newIban").replace(/\s+/g, "").toUpperCase();
        if (iban) input.iban = iban;
        const country = val(form, "newCountry").toUpperCase();
        if (country) input.country = country;
        if (ada) input.cardanoAddress = ada;
        payeeId = (await post<Payee>("/api/v1/payees", input)).id;
      }
      const body: PaymentCreate = { payeeId, amountMinor, currency, reason };
      if (prefill.documentId) body.documentId = prefill.documentId;
      created = await post<Payment>("/api/v1/payments", body);
      toast(
        created.status === "pending_approval"
          ? "Payment created. It is waiting for your approval."
          : created.status === "blocked"
            ? "Payment blocked by policy. See the checks for why."
            : "Payment created.",
        created.status === "blocked" ? "error" : "ok",
      );
      void refreshBadges();
      return true;
    },
  });
  return created;
}

export async function renderPayments(view: HTMLElement, ctx: Ctx): Promise<void> {
  let tab: "approvals" | "all" = (ctx.query.get("tab") as "all") === "all" || ctx.query.get("id") ? "all" : "approvals";
  let filter = "any";
  const focus = ctx.query.get("id");
  view.innerHTML = `${pageHead(
    "Payments",
    "Every payment is checked by code against your policy. Payouts run on Cardano Preprod (testnet tADA) and the CashXChain sandbox rail.",
    `<button class="btn primary sm" type="button" id="pay-new">${icon("plus", 16, 2.4)}New payment</button>`,
  )}
  <section class="stat-row" id="pay-stats">${Array.from({ length: 3 }, () => `<div class="stat-card">${skLines(1)}</div>`).join("")}</section>
  <section class="card list-card">
    <div class="list-head">
      <div class="tabs" role="tablist"><button role="tab" data-tab="approvals">Approvals <em id="n-appr"></em></button><button role="tab" data-tab="all">All payments <em id="n-all"></em></button></div>
      <div class="chips" id="pay-filter" hidden>
        <button data-f="any" class="on">All</button><button data-f="done">Paid</button><button data-f="live">In progress</button><button data-f="stopped">Rejected &amp; failed</button>
      </div>
    </div>
    <ul class="pay-list" id="pay-list">${skLines(5)}</ul>
  </section>`;
  let payments: Payment[] = [];
  const list = view.querySelector<HTMLElement>("#pay-list")!;

  const paint = () => {
    for (const b of view.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    view.querySelector<HTMLElement>("#pay-filter")!.hidden = tab !== "all";
    // Waiting for you: an approval, or a tADA payout your wallet still has to sign.
    const pending = payments.filter(needsYou);
    view.querySelector("#n-appr")!.textContent = String(pending.length);
    view.querySelector("#n-all")!.textContent = String(payments.length);
    const groups: Record<string, Payment["status"][]> = {
      done: ["executed"],
      live: ["pending_approval", "approved", "executing"],
      stopped: ["rejected", "failed", "blocked"],
    };
    const rows = tab === "approvals" ? pending : filter === "any" ? payments : payments.filter(p => groups[filter]!.includes(p.status));
    list.innerHTML = rows.length
      ? rows.map(p => paymentRow(p, p.id === focus)).join("")
      : `<li class="list-empty">${
          tab === "approvals"
            ? empty({ icon: "shieldCheck", title: "Nothing waiting for you", text: "When the agent or a teammate drafts a payment that needs a human, it shows up here with its policy checks." })
            : empty({ icon: "pay", title: "No payments yet", text: "Draft one yourself, or ask the AI CFO to prepare payments from your invoices.", action: `<button class="btn primary sm" type="button" data-new>${icon("plus", 15, 2.4)}New payment</button>` })
        }</li>`;
    const sum = (xs: Payment[]) => xs.reduce((a, p) => a + p.usdMinor, 0);
    const month = new Date().toISOString().slice(0, 7);
    const paid = payments.filter(p => p.status === "executed" && (p.executedAt ?? p.createdAt).startsWith(month));
    const blocked = payments.filter(p => p.status === "blocked" || p.status === "failed");
    view.querySelector("#pay-stats")!.innerHTML = `
      <div class="stat-card"><span class="label">Waiting for you</span><b>${esc(usd(sum(pending)))}</b><span class="sub">${pending.length} payment${pending.length === 1 ? "" : "s"}</span></div>
      <div class="stat-card"><span class="label">Paid this month</span><b>${esc(usd(sum(paid)))}</b><span class="sub">${paid.length} payment${paid.length === 1 ? "" : "s"} · testnet &amp; sandbox</span></div>
      <div class="stat-card"><span class="label">Stopped by policy or errors</span><b>${blocked.length}</b><span class="sub">blocked or failed</span></div>`;
    if (focus) document.getElementById(`pay-${focus}`)?.scrollIntoView({ block: "center" });
  };

  const load = async () => {
    payments = await get<Payment[]>("/api/v1/payments");
    if (!ctx.alive()) return;
    payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    paint();
    if (payments.some(p => p.status === "executing" || p.status === "approved")) {
      const t = window.setTimeout(() => void load().catch(() => undefined), 2500);
      ctx.onCleanup(() => window.clearTimeout(t));
    }
  };

  view.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const tb = t.closest<HTMLButtonElement>("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab as typeof tab;
      paint();
    }
    const f = t.closest<HTMLButtonElement>("[data-f]");
    if (f) {
      filter = f.dataset.f!;
      for (const b of view.querySelectorAll("[data-f]")) b.classList.toggle("on", b === f);
      paint();
    }
    if (t.closest("#pay-new, [data-new]")) {
      const p = await newPaymentDialog().catch(() => null);
      if (p && ctx.alive()) {
        payments.unshift(p);
        tab = p.status === "pending_approval" ? "approvals" : "all";
        paint();
      }
    }
  });
  wirePaymentList(list, p => {
    const i = payments.findIndex(x => x.id === p.id);
    if (i >= 0) payments[i] = p;
    const row = list.querySelector(`[data-row="${CSS.escape(p.id)}"]`);
    // An approved tADA payout comes back to this tab once its transaction waits for your signature.
    if (tab === "approvals" && !needsYou(p) && row) {
      row.classList.add("leaving");
      window.setTimeout(paint, 280);
    } else paint();
    if (p.status === "executing" || p.status === "approved") window.setTimeout(() => ctx.alive() && void load().catch(() => undefined), 2000);
  });
  await load();
}
