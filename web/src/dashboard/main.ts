// PayLorya AI dashboard (/app): app shell, sidebar, client-side routing over /app/*.
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
const logo = `<a class="logo" href="/app"><span class="mark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span>PayLorya<span class="tag">AI</span></a>`;

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
    document.title = "Not found · PayLorya AI";
    view.innerHTML = `<div class="notfound"><h1>Page not found</h1><p class="muted">This page does not exist in your dashboard.</p><a class="btn primary sm" href="/app">Go to overview</a></div>`;
    return;
  }
  document.title = `${r.title} · PayLorya AI`;
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
