import { reducedMotion } from "../shared/nav.js";

export type View = "inbox" | "assistant" | "settings";
export interface Route {
  view: View;
  /** Inbox only: run to open (`#/inbox?run=<id>`). */
  run?: string;
}

const VIEWS: readonly View[] = ["inbox", "assistant", "settings"];
const listeners = new Set<(route: Route) => void>();

export function currentRoute(): Route {
  const [path = "", query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const view = (VIEWS as readonly string[]).includes(path) ? (path as View) : "inbox";
  const run = new URLSearchParams(query).get("run") ?? undefined;
  return run ? { view, run } : { view };
}

/** Navigates inside the app, e.g. go("inbox", runId) from the assistant. */
export function go(view: View, run?: string): void {
  location.hash = `#/${view}${run ? `?run=${encodeURIComponent(run)}` : ""}`;
}

export function onRoute(listener: (route: Route) => void): void {
  listeners.add(listener);
}

function show(route: Route): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-view]")) {
    const active = section.dataset.view === route.view;
    if (active && section.hidden) {
      section.hidden = false;
      if (!reducedMotion()) {
        section.classList.remove("view-in");
        void section.offsetWidth;
        section.classList.add("view-in");
      }
    } else if (!active) {
      section.hidden = true;
    }
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-nav]")) {
    if (link.dataset.nav === route.view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  for (const listener of listeners) listener(route);
}

export function initRouter(): void {
  window.addEventListener("hashchange", () => {
    show(currentRoute());
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  });
  show(currentRoute());
}
