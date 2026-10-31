// Agent access: autonomy level (Full access needs a typed confirmation), limits, per-connection summary.
import { esc } from "../../shared/dom.js";
import { get, patch } from "../api.js";
import { type Ctx, emitState, state } from "../state.js";
import type { AgentLimits, Autonomy, Connection, Me, Overview, Workspace, WorkspacePatch } from "../types.js";
import { AUTONOMY, dialog, empty, fieldError, icon, pageHead, sk, toast, toMinor, usd, val } from "../ui.js";

const LEVELS: Array<{ id: Autonomy; icon: string; title: string; lead: string; can: string[]; cannot: string[] }> = [
  {
    id: "read_only",
    icon: "eye",
    title: "Read-only",
    lead: "Analyses, plans and drafts. Never moves money.",
    can: ["Read documents, balances and history", "Summarise, forecast and plan budgets", "Draft payments for you to approve"],
    cannot: ["Execute any payment"],
  },
  {
    id: "guarded",
    icon: "shieldCheck",
    title: "Guarded",
    lead: "Pays routine bills alone, inside the limits you set.",
    can: ["Everything in read-only", "Execute payments within the per-payment limit and monthly budget", "Pay only payees in your directory"],
    cannot: ["Go over a limit or pay a new payee without your approval"],
  },
  {
    id: "full",
    icon: "alert",
    title: "Full access",
    lead: "Pays without asking you. Use with care.",
    can: ["Execute any payment from read & write connections", "No per-payment or monthly caps"],
    cannot: ["Bypass hard policy blocks (invalid details, blocked payees)"],
  },
];

function canDo(c: Connection, ws: Workspace): { tone: string; text: string } {
  if (c.status !== "active") return { tone: "muted", text: "Not active. The agent cannot use it." };
  if (!c.supports.write) return { tone: "read", text: "Reads balances and history. Watch-only, cannot pay from it." };
  if (c.access === "read") return { tone: "read", text: "Reads balances and history. Cannot pay from it (read-only access)." };
  const l = ws.limits;
  const who = l.knownPayeesOnly ? " to payees in your directory" : "";
  if (ws.autonomy === "read_only") return { tone: "draft", text: "Reads and drafts payments. Every payment waits for your approval." };
  if (ws.autonomy === "guarded")
    return { tone: "guard", text: `Pays on its own${who} up to ${usd(l.perPaymentUsdMinor, { cents: false })} per payment and ${usd(l.monthlyUsdMinor, { cents: false })} per month. Everything else waits for your approval.` };
  return { tone: "full", text: `Pays without approval${who}. Only hard policy blocks stop it.` };
}

export async function renderAgent(view: HTMLElement, ctx: Ctx): Promise<void> {
  view.innerHTML = `${pageHead("Agent access", "Decide what your AI CFO may do on its own.")}
    <div class="trust">
      <div>${icon("eye", 18)}<span><b>Claude reads.</b> It sees documents and balances, never keys.</span></div>
      <div>${icon("shield", 18)}<span><b>Code decides.</b> Limits and payee checks run outside the model.</span></div>
      <div>${icon("check", 18, 2.4)}<span><b>You approve.</b> Anything outside your rules waits for you.</span></div>
    </div>
    <div id="ag-body"><div class="levels">${LEVELS.map(() => `<div class="card">${sk("40%", 20)}<div style="height:14px"></div>${sk("90%", 12)}<div style="height:8px"></div>${sk("70%", 12)}</div>`).join("")}</div></div>`;

  const [me, conns, ov] = await Promise.all([
    get<Me>("/api/v1/me"),
    get<Connection[]>("/api/v1/connections", true).catch(() => [] as Connection[]),
    get<Overview>("/api/v1/overview", true).catch(() => null),
  ]);
  if (!ctx.alive()) return;
  let ws = me.workspace;
  state.me = me;
  emitState();
  const body = view.querySelector<HTMLElement>("#ag-body")!;

  const paint = () => {
    const l = ws.limits;
    const used = ov?.agent.executedThisMonthUsdMinor ?? 0;
    const pct = l.monthlyUsdMinor ? Math.min(100, (used / l.monthlyUsdMinor) * 100) : 0;
    body.innerHTML = `
    <div class="levels" role="radiogroup" aria-label="Autonomy level">${LEVELS.map(
      lv => `<button type="button" class="card level lv-${lv.id}${ws.autonomy === lv.id ? " on" : ""}" role="radio" aria-checked="${ws.autonomy === lv.id}" data-level="${lv.id}">
        <span class="lv-top"><span class="lv-ic">${icon(lv.icon, 20)}</span><span class="lv-radio"></span></span>
        <b class="lv-t">${lv.title}${lv.id === "full" ? '<span class="pill t-bad">Dangerous</span>' : lv.id === "guarded" ? '<span class="pill t-neutral">Recommended</span>' : ""}</b>
        <span class="lv-lead">${lv.lead}</span>
        <ul>${lv.can.map(x => `<li class="yes">${icon("check", 13, 2.6)}${esc(x)}</li>`).join("")}${lv.cannot.map(x => `<li class="no">${icon("x", 13, 2.6)}${esc(x)}</li>`).join("")}</ul>
      </button>`,
    ).join("")}</div>

    <div class="ag-grid">
      <form class="card" id="limits" novalidate>
        <div class="card-head"><div><h2>Limits</h2><p class="muted small">${ws.autonomy === "guarded" ? "Active now. The agent executes alone only within these." : ws.autonomy === "full" ? "Caps are not applied in full access. Known payees still applies." : "Used when you switch to guarded mode."}</p></div></div>
        <div class="grid2">
          <div class="field"><label for="l-per">Per-payment limit</label><div class="affix"><span>$</span><input id="l-per" name="per" inputmode="decimal" value="${l.perPaymentUsdMinor / 100}"></div><span class="hint">Largest single payment it may execute alone</span></div>
          <div class="field"><label for="l-mon">Monthly limit</label><div class="affix"><span>$</span><input id="l-mon" name="mon" inputmode="decimal" value="${l.monthlyUsdMinor / 100}"></div><span class="hint">Total it may execute alone per calendar month</span></div>
        </div>
        <label class="switch-row"><span><b>Known payees only</b><span>Only pay payees saved in your <a href="/app/payees">payee directory</a>.</span></span><input type="checkbox" name="known" class="switch" ${l.knownPayeesOnly ? "checked" : ""}></label>
        <div class="form-foot"><span class="muted small" id="l-dirty"></span><button class="btn primary sm" type="submit" id="l-save" disabled>Save limits</button></div>
      </form>
      <section class="card">
        <div class="card-head"><h2>This month</h2><span class="pill ${AUTONOMY[ws.autonomy].tone}">${AUTONOMY[ws.autonomy].name}</span></div>
        <div class="usage"><b>${esc(usd(used, { cents: false }))}</b><span>executed by the agent on its own</span></div>
        <div class="meter lg ${pct >= 90 ? "hot" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="usage-foot"><span>${Math.round(pct)}% of ${esc(usd(l.monthlyUsdMinor, { cents: false }))}</span><span>${esc(usd(Math.max(0, l.monthlyUsdMinor - used), { cents: false }))} left</span></div>
        <p class="fine">Payments you approve yourself don't count toward this limit.</p>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><div><h2>What the agent can do, per connection</h2><p class="muted small">From each connection's access and the autonomy level above.</p></div><a class="link-sm" href="/app/connections">Connections${icon("chevron", 14)}</a></div>
      ${conns.length ? `<ul class="perms">${conns
        .map(c => {
          const d = canDo(c, ws);
          return `<li><span class="perm-ic p-${d.tone}">${icon(d.tone === "read" || d.tone === "muted" ? "eye" : d.tone === "draft" ? "edit" : d.tone === "full" ? "zap" : "shieldCheck", 16)}</span><div><b>${esc(c.label)}</b><span class="perm-meta">${c.access === "read_write" && c.supports.write ? "Read &amp; write" : "Read-only"} · ${esc(c.network)}</span></div><p>${esc(d.text)}</p></li>`;
        })
        .join("")}</ul>` : empty({ icon: "link", title: "No connections", text: "Connect a wallet or account to see what the agent may do with it." })}
    </section>`;
    wireLimits();
  };

  const setAutonomy = async (level: Autonomy) => {
    if (level === ws.autonomy) return;
    if (level === "full") {
      await dialog({
        title: "Turn on full access?",
        submit: "Enable full access",
        danger: true,
        body: `<div class="callout bad">${icon("alert", 16)}<span><b>The agent will pay without asking you.</b> No per-payment or monthly caps. Only hard policy blocks stop a payment. Testnet and sandbox rails only in this environment.</span></div>
          <div class="field"><label for="fa">Type <b class="mono">FULL ACCESS</b> to confirm</label><input id="fa" name="confirm" autocomplete="off" spellcheck="false" placeholder="FULL ACCESS"></div>`,
        onOpen: form => {
          const input = form.elements.namedItem("confirm") as HTMLInputElement;
          const btn = form.querySelector<HTMLButtonElement>("[data-submit]")!;
          btn.disabled = true;
          input.addEventListener("input", () => (btn.disabled = input.value.trim() !== "FULL ACCESS"));
        },
        onSubmit: async form => {
          const confirm = val(form, "confirm");
          if (confirm !== "FULL ACCESS") return fieldError(form, "confirm", "Type FULL ACCESS exactly.");
          ws = await patch<Workspace>("/api/v1/workspace", { autonomy: "full", confirm } satisfies WorkspacePatch);
          return true;
        },
      });
    } else {
      try {
        ws = await patch<Workspace>("/api/v1/workspace", { autonomy: level } satisfies WorkspacePatch);
      } catch {
        return;
      }
    }
    if (ws.autonomy === level) toast(`Agent autonomy: ${AUTONOMY[level].name}`, level === "full" ? "info" : "ok");
    if (state.me) state.me = { ...state.me, workspace: ws };
    emitState();
    paint();
  };

  const wireLimits = () => {
    const form = body.querySelector<HTMLFormElement>("#limits")!;
    const save = form.querySelector<HTMLButtonElement>("#l-save")!;
    const read = (): AgentLimits => ({
      perPaymentUsdMinor: toMinor(val(form, "per"), "USD"),
      monthlyUsdMinor: toMinor(val(form, "mon"), "USD"),
      knownPayeesOnly: (form.elements.namedItem("known") as HTMLInputElement).checked,
    });
    const dirty = () => {
      const n = read();
      const d = n.perPaymentUsdMinor !== ws.limits.perPaymentUsdMinor || n.monthlyUsdMinor !== ws.limits.monthlyUsdMinor || n.knownPayeesOnly !== ws.limits.knownPayeesOnly;
      save.disabled = !d;
      form.querySelector("#l-dirty")!.textContent = d ? "Unsaved changes" : "";
    };
    form.addEventListener("input", dirty);
    form.addEventListener("change", dirty);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const n = read();
      if (!Number.isFinite(n.perPaymentUsdMinor) || n.perPaymentUsdMinor < 0) return void fieldError(form, "per", "Enter an amount.");
      if (!Number.isFinite(n.monthlyUsdMinor) || n.monthlyUsdMinor < 0) return void fieldError(form, "mon", "Enter an amount.");
      if (n.perPaymentUsdMinor > n.monthlyUsdMinor) return void fieldError(form, "per", "Can't be higher than the monthly limit.");
      save.disabled = true;
      save.classList.add("loading");
      try {
        ws = await patch<Workspace>("/api/v1/workspace", { limits: n } satisfies WorkspacePatch);
        if (state.me) state.me = { ...state.me, workspace: ws };
        emitState();
        toast("Limits saved", "ok");
        paint();
      } catch {
        save.disabled = false;
        save.classList.remove("loading");
      }
    });
  };

  body.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-level]");
    if (b) void setAutonomy(b.dataset.level as Autonomy);
  });
  paint();
}
