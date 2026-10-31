import { reducedMotion } from "../../shared/nav.js";
import { MARK } from "./icons.js";

/** One message: a text bubble, a card (no bubble) or a bare block. html is escaped by the caller. */
export interface Msg {
  /** A promise is awaited behind the typing dots (answers that fetch data). */
  html: string | Promise<string>;
  kind?: "bubble" | "card";
  /** Called once the element is in the thread (cards keep a handle to re-render). */
  mount?: (el: HTMLElement) => void;
}

interface Group {
  key: string;
  el: HTMLElement;
  stack: HTMLElement;
  foot?: HTMLElement;
}

export interface PostOpts {
  /** Typing indicator first; 0 posts at once. Reduced motion always posts at once. */
  delay?: number;
  /** Context line of a new group ("Brenner Maschinenbau GmbH · INV-…"). */
  ctx?: () => string | undefined;
  /** Footer HTML of the group, added once. */
  foot?: () => string;
}

let scroller: HTMLElement;
let list: HTMLElement;
let jump: HTMLElement;
let last: Group | undefined;
let queue: Promise<unknown> = Promise.resolve();
let autoUntil = 0;
const working = new Set<string>();

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const node = (cls: string, html = ""): HTMLElement => {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  return el;
};
const typingHtml = `<i></i><i></i><i></i>`;

export function initThread(scrollEl: HTMLElement, listEl: HTMLElement, jumpEl: HTMLElement): void {
  scroller = scrollEl;
  list = listEl;
  jump = jumpEl;
  scroller.addEventListener("scroll", () => {
    if (nearBottom()) jump.classList.remove("show");
  }, { passive: true });
  jump.addEventListener("click", () => toBottom());
}

// A programmatic smooth scroll still counts as "at the bottom" while it runs.
const nearBottom = (): boolean =>
  performance.now() < autoUntil || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;

export function toBottom(smooth = !reducedMotion()): void {
  autoUntil = performance.now() + 650;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  jump.classList.remove("show");
}

/** Changes the thread; follows the newest message only when the reader is already at the bottom. */
export function mutate(change: () => void, force = false): void {
  const follow = force || nearBottom();
  change();
  if (follow) toBottom();
  else jump.classList.add("show");
}

/** Messages appear one at a time, in order. */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function group(key: string, opts: PostOpts): Group {
  if (last && last.key === key && last.el === list.lastElementChild) return last;
  const ctx = opts.ctx?.();
  const el = node("m agent", `<span class="m-av mark">${MARK}</span><div class="m-stack">${ctx ? `<div class="m-ctx">${ctx}</div>` : ""}</div>`);
  el.dataset.key = key;
  list.append(el);
  last = { key, el, stack: el.querySelector<HTMLElement>(".m-stack")! };
  return last;
}

function place(g: Group, el: HTMLElement): void {
  if (g.foot) g.stack.insertBefore(el, g.foot);
  else g.stack.append(el);
}

function setTyping(g: Group, on: boolean): HTMLElement | undefined {
  const dots = g.stack.querySelector<HTMLElement>(":scope > .typing") ?? undefined;
  if (!on) {
    dots?.remove();
    return undefined;
  }
  if (dots) return dots;
  const fresh = node("b typing", typingHtml);
  fresh.setAttribute("aria-label", "AI CFO is working");
  place(g, fresh);
  return fresh;
}

/** Removes the key's typing dots from every group (a newer group may have taken over). */
function clearTyping(key: string): void {
  for (const dots of list.querySelectorAll(`.m[data-key="${CSS.escape(key)}"] .typing`)) dots.remove();
}

/** Posts now (call inside an enqueued task). Resolves with the message element. */
export async function post(key: string, msg: Msg, opts: PostOpts = {}): Promise<HTMLElement> {
  const delay = reducedMotion() ? 0 : opts.delay ?? 520;
  let dots: HTMLElement | undefined;
  if (delay > 0) {
    mutate(() => {
      const g = group(key, opts);
      for (const old of list.querySelectorAll(`.m[data-key="${CSS.escape(key)}"] .typing`)) if (!g.el.contains(old)) old.remove();
      dots = setTyping(g, true);
    });
    await wait(delay);
  }
  const html = await msg.html;
  const g = group(key, opts); // a user message may have arrived meanwhile: then a new group
  const el = node(msg.kind === "card" ? "m-card" : "b", html);
  mutate(() => {
    const holder = dots?.closest<HTMLElement>(".m");
    dots?.remove();
    if (holder && holder !== g.el && !holder.querySelector(".m-stack > .b:not(.typing), .m-stack > .m-card")) holder.remove();
    clearTyping(key);
    place(g, el);
    const foot = opts.foot?.();
    if (foot && !g.foot) {
      g.foot = node("m-foot", foot);
      g.stack.append(g.foot);
    }
    if (working.has(key)) setTyping(g, true);
  });
  msg.mount?.(el);
  return el;
}

/** Queued post. */
export const say = (key: string, msg: Msg, opts?: PostOpts): Promise<HTMLElement> => enqueue(() => post(key, msg, opts));

/** Shows the typing dots at the end of the key's group while the agent works on its own. */
export function setWorking(key: string, on: boolean): void {
  if (on === working.has(key)) return;
  if (on) working.add(key);
  else working.delete(key);
  if (last?.key === key && last.el === list.lastElementChild) mutate(() => setTyping(last!, on));
  else if (!on) clearTyping(key);
}

/** Moves the latest group of oldKey to newKey (a run id once the agent accepted the invoice). */
export function rekey(oldKey: string, newKey: string): void {
  if (last?.key === oldKey) {
    last.key = newKey;
    last.el.dataset.key = newKey;
  }
}

/** The user's message, right-aligned. Always scrolls to it. */
export function user(html: string, cls = ""): HTMLElement {
  const el = node(`m user${cls ? ` ${cls}` : ""}`, `<div class="m-stack"><div class="b">${html}</div></div>`);
  mutate(() => list.append(el), true);
  return el;
}
