// Activity: the audit log as a timeline, filterable by actor and searchable.
import { esc } from "../../shared/dom.js";
import { get } from "../api.js";
import type { Ctx } from "../state.js";
import type { Activity } from "../types.js";
import { date, empty, icon, pageHead, skLines } from "../ui.js";

const ACTOR: Record<Activity["actor"], [string, string]> = { user: ["user", "You"], agent: ["bot", "AI CFO agent"], system: ["cog", "System"] };

function refHref(a: Activity): string | null {
  const r = a.ref;
  if (!r) return null;
  const id = encodeURIComponent(r.id);
  switch (r.type) {
    case "document":
      return `/app/documents/${id}`;
    case "payment":
      return `/app/payments?id=${id}`;
    case "chat":
      return `/app/chat/${id}`;
    case "budget":
      return "/app/budgets";
    case "connection":
      return "/app/connections";
    case "payee":
      return "/app/payees";
    case "workspace":
      return "/app/agent";
  }
  return null;
}

export async function renderActivity(view: HTMLElement, ctx: Ctx): Promise<void> {
  let items: Activity[] = [];
  let actor = "all";
  let q = "";
  view.innerHTML = `${pageHead("Activity", "Audit log of everything you, the agent and the system did. Nothing is hidden.")}
    <section class="card list-card">
      <div class="list-head"><div class="chips" id="a-filter"></div><label class="search">${icon("search", 16)}<input id="a-q" placeholder="Search activity" aria-label="Search activity"></label></div>
      <div id="a-list"><div class="pad">${skLines(7)}</div></div>
    </section>`;
  const listEl = view.querySelector<HTMLElement>("#a-list")!;
  const paint = () => {
    const counts = { all: items.length, user: 0, agent: 0, system: 0 } as Record<string, number>;
    for (const a of items) counts[a.actor] = (counts[a.actor] ?? 0) + 1;
    view.querySelector("#a-filter")!.innerHTML = (["all", "user", "agent", "system"] as const)
      .map(k => `<button data-a="${k}" class="${actor === k ? "on" : ""}">${k === "all" ? "All" : k === "user" ? "You" : k === "agent" ? "Agent" : "System"} <em>${counts[k] ?? 0}</em></button>`)
      .join("");
    const n = q.toLowerCase();
    const rows = items.filter(a => (actor === "all" || a.actor === actor) && (!n || `${a.action} ${a.detail}`.toLowerCase().includes(n)));
    if (!rows.length) {
      listEl.innerHTML = empty({ icon: "activity", title: items.length ? "No matching activity" : "No activity yet", text: items.length ? "Try another filter." : "Uploads, payments, approvals and setting changes are recorded here." });
      return;
    }
    let html = "";
    let day = "";
    for (const a of rows) {
      const d = a.at.slice(0, 10);
      if (d !== day) {
        if (day) html += "</ol>";
        const today = new Date().toISOString().slice(0, 10);
        const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        html += `<h3 class="tl-day">${d === today ? "Today" : d === yest ? "Yesterday" : esc(date(d, true))}</h3><ol class="timeline">`;
        day = d;
      }
      const [ic, who] = ACTOR[a.actor] ?? ["info", a.actor];
      const href = refHref(a);
      html += `<li class="tl tl-${a.actor}"><span class="tl-ic" title="${esc(who)}">${icon(ic, 15)}</span><div class="tl-body"><p><b>${esc(who)}</b> ${esc(a.action)}</p>${a.detail ? `<span class="tl-detail">${esc(a.detail)}</span>` : ""}</div><div class="tl-r"><time datetime="${esc(a.at)}">${esc(new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}</time>${href ? `<a class="link-sm" href="${href}">View${icon("chevron", 13)}</a>` : ""}</div></li>`;
    }
    listEl.innerHTML = html + "</ol>";
  };
  view.querySelector("#a-filter")!.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-a]");
    if (!b) return;
    actor = b.dataset.a!;
    paint();
  });
  view.querySelector<HTMLInputElement>("#a-q")!.addEventListener("input", e => {
    q = (e.target as HTMLInputElement).value.trim();
    paint();
  });
  items = await get<Activity[]>("/api/v1/activity?limit=100");
  if (!ctx.alive()) return;
  items.sort((a, b) => b.at.localeCompare(a.at));
  paint();
}
