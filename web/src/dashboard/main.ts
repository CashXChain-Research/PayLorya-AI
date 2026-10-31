// PayFlow AI dashboard (/app): app shell, sidebar, client-side routing over /app/*.
import { esc } from "../shared/dom.js";
import { initTheme } from "../shared/theme.js";
import { get } from "./api.js";
import { renderActivity } from "./pages/activity.js";
import { renderAgent } from "./pages/agent.js";
import { renderBudgets } from "./pages/budgets.js";
import { renderChat } from "./pages/chat.js";
import { renderConnections } from "./pages/connections.js";
import { renderDocument, renderDocuments } from "./pages/documents.js";
import { renderOverview } from "./pages/overview.js";
import { renderPayees } from "./pages/payees.js";
import { renderPayments } from "./pages/payments.js";
import { renderSettings } from "./pages/settings.js";
import { type Ctx, emitState, onStateChange, refreshBadges, setNavigate, signOut, state } from "./state.js";
import type { Me } from "./types.js";
import { AUTONOMY, avatar, icon } from "./ui.js";

type Render = (view: HTMLElement, ctx: Ctx) => void | Promise<void>;
interface Route {
  re: RegExp;
  title: string;
  nav: string;
  render: Render;
  full?: boolean;
}

const ROUTES: Route[] = [
  { re: /^\/app\/?$/, title: "Overview", nav: "overview", render: renderOverview },
  { re: /^\/app\/chat(?:\/([^/]+))?\/?$/, title: "Chat", nav: "chat", render: renderChat, full: true },
  { re: /^\/app\/documents\/([^/]+)\/?$/, title: "Document", nav: "documents", render: renderDocument },
  { re: /^\/app\/documents\/?$/, title: "Documents", nav: "documents", render: renderDocuments },
  { re: /^\/app\/payments\/?$/, title: "Payments", nav: "payments", render: renderPayments },
  { re: /^\/app\/budgets\/?$/, title: "Budgets & planning", nav: "budgets", render: renderBudgets },
  { re: /^\/app\/payees\/?$/, title: "Payees", nav: "payees", render: renderPayees },
  { re: /^\/app\/connections\/?$/, title: "Connections", nav: "connections", render: renderConnections },
  { re: /^\/app\/agent\/?$/, title: "Agent access", nav: "agent", render: renderAgent },
  { re: /^\/app\/activity\/?$/, title: "Activity", nav: "activity", render: renderActivity },
  { re: /^\/app\/settings\/?$/, title: "Settings", nav: "settings", render: renderSettings },
];

const NAV: Array<{ group?: string; items: Array<[string, string, string, string]> }> = [
  {
    items: [
      ["overview", "/app", "home", "Overview"],
      ["chat", "/app/chat", "sparkle", "AI CFO chat"],
    ],
  },
  {
    group: "Finance",
    items: [
      ["documents", "/app/documents", "doc", "Documents"],
      ["payments", "/app/payments", "pay", "Payments"],
      ["budgets", "/app/budgets", "budget", "Budgets & planning"],
      ["payees", "/app/payees", "payees", "Payees"],
    ],
  },
  {
    group: "Control",
    items: [
      ["connections", "/app/connections", "link", "Connections"],
      ["agent", "/app/agent", "shield", "Agent access"],
      ["activity", "/app/activity", "activity", "Activity"],
    ],
  },
];

const themeBtn = (extra = "") =>
  `<button class="theme-toggle ${extra}" type="button" data-theme-toggle aria-label="Toggle dark mode" aria-pressed="false">
    <svg class="sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    <svg class="moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
  </button>`;
const logo = `<a class="logo" href="/app"><span class="mark">P</span>PayFlow<span class="tag">AI</span></a>`;

function shell(): string {
  return `<div class="shell">
  <aside class="side" id="side" aria-label="Main navigation">
    <div class="side-top">${logo}<button class="icon-btn side-close" type="button" id="side-close" aria-label="Close menu">${icon("x")}</button></div>
    <a class="ws" href="/app/agent" id="ws"><span class="ws-mark" id="ws-mark"></span><span class="ws-text"><b id="ws-name"><span class="sk" style="width:110px;height:12px"></span></b><span id="ws-auto" class="ws-auto"></span></span>${icon("chevron", 15)}</a>
    <nav class="side-nav">${NAV.map(
      g =>
        `${g.group ? `<div class="side-group">${g.group}</div>` : ""}${g.items
          .map(([key, href, ic, label]) => `<a href="${href}" data-nav="${key}">${icon(ic, 18)}<span>${label}</span>${key === "payments" ? '<em class="badge" id="badge-approvals" hidden></em>' : ""}</a>`)
          .join("")}`,
    ).join("")}</nav>
    <div class="side-trust">
      <div class="trust-row">${icon("eye", 14, 2)}<span><b>Claude reads.</b></span></div>
      <div class="trust-row">${icon("shield", 14, 2)}<span><b>Code decides.</b></span></div>
      <div class="trust-row">${icon("check", 14, 2.4)}<span><b>You approve.</b></span></div>
    </div>
    <div class="side-foot">
      <a href="/app/settings" data-nav="settings" class="side-settings">${icon("settings", 18)}<span>Settings</span></a>
      <div class="user-row">
        <button class="user-btn" type="button" id="user-btn" aria-haspopup="menu" aria-expanded="false"><span id="user-av">${avatar("…")}</span><span class="user-text"><b id="user-name">&nbsp;</b><span id="user-email">&nbsp;</span></span></button>
        ${themeBtn()}
        <div class="menu" id="user-menu" role="menu" hidden>
          <a href="/app/settings" role="menuitem">${icon("settings", 16)}Settings</a>
          <a href="/app/agent" role="menuitem">${icon("shield", 16)}Agent access</a>
          <button type="button" role="menuitem" data-signout>${icon("logout", 16)}Sign out</button>
        </div>
      </div>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main-wrap">
    <header class="topbar"><button class="icon-btn" type="button" id="menu-btn" aria-label="Open menu" aria-controls="side">${icon("menu", 20)}</button>${logo}<span class="topbar-right"><a class="icon-btn" href="/app/chat" aria-label="AI CFO chat">${icon("sparkle", 19)}</a>${themeBtn()}</span></header>
    <main class="main" id="view" tabindex="-1"></main>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}

function paintIdentity(me: Me): void {
  const ws = me.workspace;
  document.getElementById("ws-name")!.textContent = ws.name;
  document.getElementById("ws-mark")!.textContent = (ws.name.trim()[0] ?? "W").toUpperCase();
  const a = AUTONOMY[ws.autonomy];
  const auto = document.getElementById("ws-auto")!;
  auto.className = `ws-auto a-${ws.autonomy}`;
  auto.innerHTML = `<i></i>Agent: ${a.name}`;
  document.getElementById("user-name")!.textContent = me.user.name || me.user.email;
  document.getElementById("user-email")!.textContent = me.user.email;
  document.getElementById("user-av")!.innerHTML = avatar(me.user.name || me.user.email);
}

function paintBadges(): void {
  const b = document.getElementById("badge-approvals");
  if (!b) return;
  b.hidden = state.approvals === 0;
  b.textContent = String(state.approvals);
  b.title = `${state.approvals} payment${state.approvals === 1 ? "" : "s"} waiting for approval`;
}

let token = 0;
let cleanups: Array<() => void> = [];

function route(): void {
  const path = location.pathname.replace(/\/+$/, "") || "/app";
  const view = document.getElementById("view")!;
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  const my = ++token;
  let match: RegExpExecArray | null = null;
  const r = ROUTES.find(x => (match = x.re.exec(path === "/app" ? "/app" : path)));
  document.body.classList.toggle("full", !!r?.full);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-nav]")) {
    if (r && a.dataset.nav === r.nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  closeDrawer();
  view.classList.remove("enter");
  void view.offsetWidth;
  view.classList.add("enter");
  if (!r) {
    document.title = "Not found · PayFlow AI";
    view.innerHTML = `<div class="notfound"><h1>Page not found</h1><p class="muted">This page does not exist in your dashboard.</p><a class="btn primary sm" href="/app">Go to overview</a></div>`;
    return;
  }
  document.title = `${r.title} · PayFlow AI`;
  const ctx: Ctx = {
    params: (match as RegExpExecArray | null)?.slice(1).map(p => (p ? decodeURIComponent(p) : "")) ?? [],
    query: new URLSearchParams(location.search),
    alive: () => my === token,
    onCleanup: fn => {
      if (my === token) cleanups.push(fn);
      else fn();
    },
    reload: () => {
      if (my === token) route();
    },
  };
  try {
    const p = r.render(view, ctx);
    if (p) p.catch(err => console.warn("[dashboard] page error", err));
  } catch (err) {
    console.warn("[dashboard] page error", err);
  }
}

function navigateTo(path: string, opts: { replace?: boolean; silent?: boolean } = {}): void {
  if (path === location.pathname + location.search && !opts.silent) {
    route();
    return;
  }
  if (opts.replace || opts.silent) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  if (opts.silent) {
    return;
  }
  window.scrollTo({ top: 0 });
  route();
}

function openDrawer(): void {
  document.body.classList.add("drawer");
  document.getElementById("menu-btn")?.setAttribute("aria-expanded", "true");
}
function closeDrawer(): void {
  document.body.classList.remove("drawer");
  document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
}

function wire(): void {
  document.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    const a = target.closest<HTMLAnchorElement>("a[href]");
    const menu = document.getElementById("user-menu")!;
    if (!target.closest("#user-btn") && !target.closest("#user-menu")) {
      menu.hidden = true;
      document.getElementById("user-btn")?.setAttribute("aria-expanded", "false");
    }
    if (target.closest("[data-signout]")) {
      e.preventDefault();
      void signOut();
      return;
    }
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/^\/app(\/|$)/.test(url.pathname)) return;
    e.preventDefault();
    menu.hidden = true;
    navigateTo(url.pathname + url.search);
  });
  window.addEventListener("popstate", route);
  document.getElementById("menu-btn")!.addEventListener("click", openDrawer);
  document.getElementById("side-close")!.addEventListener("click", closeDrawer);
  document.getElementById("scrim")!.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeDrawer();
      document.getElementById("user-menu")!.hidden = true;
    }
  });
  document.getElementById("user-btn")!.addEventListener("click", () => {
    const m = document.getElementById("user-menu")!;
    m.hidden = !m.hidden;
    document.getElementById("user-btn")!.setAttribute("aria-expanded", String(!m.hidden));
  });
}

async function boot(): Promise<void> {
  const root = document.getElementById("root") ?? document.body;
  root.innerHTML = shell();
  initTheme();
  wire();
  setNavigate(navigateTo);
  onStateChange(() => {
    if (state.me) paintIdentity(state.me);
    paintBadges();
  });
  route();
  void refreshBadges();
  try {
    state.me = await get<Me>("/api/v1/me");
    emitState();
  } catch {
    // 401 redirects; other errors were toasted, pages still load their own data
  }
}

void boot();
