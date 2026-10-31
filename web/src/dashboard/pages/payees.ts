// Payees: the directory the agent may pay (guarded mode, known payees only).
import { esc, short } from "../../shared/dom.js";
import { del, get, patch, post } from "../api.js";
import { type Ctx, state } from "../state.js";
import type { Payee, PayeeInput } from "../types.js";
import { avatar, confirmDialog, copyText, date, dialog, empty, fieldError, icon, pageHead, skLines, toast, val } from "../ui.js";

function rails(p: Payee): string {
  const r: string[] = [];
  if (p.cardanoAddress) r.push(`<span class="rail-tag ada">Cardano</span>`);
  if (p.iban) r.push(`<span class="rail-tag">IBAN</span>`);
  if (p.accountNumber) r.push(`<span class="rail-tag">US account</span>`);
  return r.join("") || `<span class="muted small">No payout details</span>`;
}

async function payeeDialog(existing: Payee | null): Promise<Payee | null> {
  let saved: Payee | null = null;
  const e = existing;
  await dialog({
    title: e ? `Edit ${e.name}` : "Add payee",
    submit: e ? "Save payee" : "Add payee",
    wide: true,
    body: `<div class="grid2">
        <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${esc(e?.name ?? "")}" placeholder="Acme GmbH" autocomplete="off"></div>
        <div class="field"><label for="p-country">Country <span class="opt-l">ISO code</span></label><input id="p-country" name="country" maxlength="2" value="${esc(e?.country ?? "")}" placeholder="DE"></div>
      </div>
      <fieldset class="fs"><legend>SEPA / international</legend>
        <div class="grid2 r21">
          <div class="field"><label for="p-iban">IBAN</label><input id="p-iban" name="iban" class="mono" value="${esc(e?.iban ?? "")}" placeholder="DE89 3704 0044 0532 0130 00" autocomplete="off"></div>
          <div class="field"><label for="p-bic">BIC</label><input id="p-bic" name="bic" class="mono" value="${esc(e?.bic ?? "")}" placeholder="COBADEFFXXX" autocomplete="off"></div>
        </div>
      </fieldset>
      <fieldset class="fs"><legend>US bank account</legend>
        <div class="grid3">
          <div class="field"><label for="p-routing">Routing number</label><input id="p-routing" name="routingNumber" class="mono" inputmode="numeric" value="${esc(e?.routingNumber ?? "")}" placeholder="021000021"></div>
          <div class="field"><label for="p-acct">Account number</label><input id="p-acct" name="accountNumber" class="mono" inputmode="numeric" value="${esc(e?.accountNumber ?? "")}" placeholder="000123456789"></div>
          <div class="field"><label for="p-type">Type</label><select id="p-type" name="accountType"><option value="">—</option><option value="checking"${e?.accountType === "checking" ? " selected" : ""}>Checking</option><option value="savings"${e?.accountType === "savings" ? " selected" : ""}>Savings</option></select></div>
        </div>
      </fieldset>
      <fieldset class="fs"><legend>Cardano Preprod (testnet)</legend>
        <div class="field"><label for="p-ada">Address</label><input id="p-ada" name="cardanoAddress" class="mono" value="${esc(e?.cardanoAddress ?? "")}" placeholder="addr_test1…" autocomplete="off"></div>
      </fieldset>`,
    onSubmit: async form => {
      const name = val(form, "name");
      if (!name) return fieldError(form, "name", "Enter the payee's name.");
      const country = val(form, "country").toUpperCase();
      if (country && !/^[A-Z]{2}$/.test(country)) return fieldError(form, "country", "Use a two-letter country code, e.g. DE or US.");
      const iban = val(form, "iban").replace(/\s+/g, "").toUpperCase();
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return fieldError(form, "iban", "This does not look like an IBAN.");
      const bic = val(form, "bic").toUpperCase();
      if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) return fieldError(form, "bic", "BIC has 8 or 11 characters.");
      const routingNumber = val(form, "routingNumber");
      if (routingNumber && !/^\d{9}$/.test(routingNumber)) return fieldError(form, "routingNumber", "Routing numbers have 9 digits.");
      const accountNumber = val(form, "accountNumber");
      if (accountNumber && !/^\d{4,17}$/.test(accountNumber)) return fieldError(form, "accountNumber", "Use 4 to 17 digits.");
      const cardanoAddress = val(form, "cardanoAddress");
      if (cardanoAddress && !/^addr_test1[0-9a-z]{20,}$/.test(cardanoAddress)) return fieldError(form, "cardanoAddress", "Use a Cardano Preprod address (addr_test1…).");
      const accountType = val(form, "accountType") as PayeeInput["accountType"] | "";
      const body: PayeeInput = { name };
      // On edit, send empty strings for cleared fields so the server can unset them.
      const set = <K extends keyof PayeeInput>(k: K, v: PayeeInput[K] | "") => {
        if (v) body[k] = v as PayeeInput[K];
        else if (e && e[k]) (body as Record<string, unknown>)[k] = "";
      };
      set("country", country);
      set("iban", iban);
      set("bic", bic);
      set("routingNumber", routingNumber);
      set("accountNumber", accountNumber);
      set("accountType", accountType);
      set("cardanoAddress", cardanoAddress);
      saved = e ? await patch<Payee>(`/api/v1/payees/${encodeURIComponent(e.id)}`, body) : await post<Payee>("/api/v1/payees", body);
      toast(e ? "Payee saved" : `${name} added to your payees`, "ok");
      return true;
    },
  });
  return saved;
}

export async function renderPayees(view: HTMLElement, ctx: Ctx): Promise<void> {
  let payees: Payee[] = [];
  let q = "";
  const known = state.me?.workspace.limits.knownPayeesOnly ?? true;
  view.innerHTML = `${pageHead("Payees", "Who your business pays, and where.", `<button class="btn primary sm" type="button" id="p-new">${icon("plus", 16, 2.4)}Add payee</button>`)}
    <div class="callout info">${icon("shieldCheck", 16)}<span><b>The agent only pays payees in this directory.</b> In guarded mode${known ? "" : " (when “known payees only” is on)"}, any payment to someone not listed here is stopped and waits for your approval. Adding a payee is always a human decision. <a href="/app/agent">Agent access settings</a></span></div>
    <section class="card list-card">
      <div class="list-head"><span class="count" id="p-count"></span><label class="search">${icon("search", 16)}<input id="p-q" placeholder="Search payees" aria-label="Search payees"></label></div>
      <div id="p-list"><div class="pad">${skLines(5)}</div></div>
    </section>`;
  const listEl = view.querySelector<HTMLElement>("#p-list")!;

  const paint = () => {
    view.querySelector("#p-count")!.textContent = `${payees.length} payee${payees.length === 1 ? "" : "s"}`;
    const n = q.toLowerCase();
    const rows = payees.filter(p => !n || [p.name, p.iban, p.cardanoAddress, p.country].some(x => x?.toLowerCase().includes(n)));
    if (!payees.length) {
      listEl.innerHTML = empty({ icon: "payees", title: "No payees yet", text: "Add the suppliers, contractors and employees you pay. In guarded mode the agent can only pay people listed here.", action: `<button class="btn primary sm" type="button" data-new>${icon("plus", 15, 2.4)}Add your first payee</button>` });
      return;
    }
    if (!rows.length) {
      listEl.innerHTML = empty({ icon: "search", title: "No matches", text: "Try another name, IBAN or address." });
      return;
    }
    listEl.innerHTML = `<ul class="payee-list">${rows
      .map(
        p => `<li>
        ${avatar(p.name)}
        <div class="pe-who"><b>${esc(p.name)}</b><span>${p.country ? `${esc(p.country)} · ` : ""}added ${esc(date(p.createdAt))}</span></div>
        <div class="pe-details">
          ${p.iban ? `<span class="mono">${esc(p.iban.replace(/(.{4})/g, "$1 ").trim())}${p.bic ? ` · ${esc(p.bic)}` : ""}</span>` : ""}
          ${p.accountNumber ? `<span class="mono">ACH ${esc(p.routingNumber ?? "")} · ••${esc(p.accountNumber.slice(-4))}${p.accountType ? ` · ${esc(p.accountType)}` : ""}</span>` : ""}
          ${p.cardanoAddress ? `<span class="mono addr">${esc(short(p.cardanoAddress))}<button type="button" class="icon-btn xs" data-copy="${esc(p.cardanoAddress)}" aria-label="Copy address">${icon("copy", 13)}</button></span>` : ""}
          ${!p.iban && !p.accountNumber && !p.cardanoAddress ? `<span class="muted small">No payout details yet</span>` : ""}
        </div>
        <div class="pe-rails">${rails(p)}</div>
        <div class="pe-act"><button class="icon-btn" type="button" data-edit="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${icon("edit", 16)}</button><button class="icon-btn danger-h" type="button" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">${icon("trash", 16)}</button></div>
      </li>`,
      )
      .join("")}</ul>`;
  };

  view.querySelector<HTMLInputElement>("#p-q")!.addEventListener("input", e => {
    q = (e.target as HTMLInputElement).value.trim();
    paint();
  });
  view.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const cp = t.closest<HTMLElement>("[data-copy]");
    if (cp) return void copyText(cp.dataset.copy!);
    if (t.closest("#p-new, [data-new]")) {
      const p = await payeeDialog(null);
      if (p && ctx.alive()) {
        payees.unshift(p);
        paint();
      }
      return;
    }
    const ed = t.closest<HTMLElement>("[data-edit]");
    if (ed) {
      const cur = payees.find(p => p.id === ed.dataset.edit);
      const p = cur && (await payeeDialog(cur));
      if (p && ctx.alive()) {
        payees = payees.map(x => (x.id === p.id ? p : x));
        paint();
      }
      return;
    }
    const dl = t.closest<HTMLElement>("[data-del]");
    if (dl) {
      const cur = payees.find(p => p.id === dl.dataset.del);
      if (!cur || !(await confirmDialog(`Remove ${cur.name}?`, "The agent will no longer be able to pay this payee without your approval. Past payments stay in the audit log.", "Remove payee", true))) return;
      try {
        await del(`/api/v1/payees/${encodeURIComponent(cur.id)}`);
        payees = payees.filter(p => p.id !== cur.id);
        paint();
        toast("Payee removed", "ok");
      } catch {
        // toast shown
      }
    }
  });

  payees = await get<Payee[]>("/api/v1/payees");
  if (!ctx.alive()) return;
  payees.sort((a, b) => a.name.localeCompare(b.name));
  paint();
}
