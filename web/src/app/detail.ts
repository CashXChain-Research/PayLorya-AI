import { $, esc, money } from "../shared/dom.js";
import { decide, getRun, type Decision, type PostResult, type Run } from "./api.js";
import { health, loadHealth } from "./health.js";
import { loadList } from "./list.js";
import { TERMINAL, stageHtml, stagesFor } from "./stages.js";
import { clock, initials, pill, toast, tone } from "./ui.js";

let selected: string | null = null;
let renderedRun: string | null = null;
let pollTimer: number | undefined;
/** Open "Details" folds as `${runId}:${stageKey}`, kept across re-renders and run switches. */
const openSet = new Set<string>();

export const selectedId = (): string | null => selected;

/** Shows a run and polls it until it reaches a terminal state. */
export async function select(id: string): Promise<void> {
  selected = id;
  clearTimeout(pollTimer);
  const tick = async (): Promise<void> => {
    if (selected !== id) return;
    let run: Run | undefined;
    try {
      run = await getRun(id);
    } catch {
      pollTimer = window.setTimeout(tick, 2000);
      return;
    }
    if (!run || selected !== id) return;
    renderDetail(run);
    if (!TERMINAL.includes(run.state)) pollTimer = window.setTimeout(tick, 1200);
    else {
      void loadHealth();
      void loadList();
    }
  };
  await tick();
  void loadList();
}

function headHtml(run: Run): string {
  const inv = run.invoice;
  const time = clock(run.createdAt);
  if (!inv) {
    return `<span class="av v2">…</span><div class="d-title"><span class="sk" style="width:220px;height:20px"></span><span>${pill(run.state)} received ${esc(time)}</span></div>`;
  }
  return `<span class="av ${tone(inv.supplier)}">${esc(initials(inv.supplier))}</span>
    <div class="d-title"><b>${esc(inv.supplier)}</b><span>${pill(run.state, run.payout?.status)} ${esc(inv.id)} · received ${esc(time)}</span></div>
    <div class="d-amt">${esc(money(inv.amountMinor, inv.currency))}</div>`;
}

/**
 * Diff render: each stage keeps its markup in data-sig and is rewritten only when that changes,
 * so polling never replays animations. A newly shown run gets the staggered entrance; a stage
 * whose class changed pops its node.
 */
function renderDetail(run: Run): void {
  const detail = $("detail");
  const fresh = renderedRun !== run.id;
  if (fresh) {
    renderedRun = run.id;
    detail.innerHTML = `<div class="d-head" id="d-head"></div><ol class="journey" id="journey"></ol>`;
    detail.classList.remove("swap");
    void detail.offsetWidth;
    detail.classList.add("swap");
  }
  const head = $("d-head");
  const headSig = headHtml(run);
  if (head.dataset.sig !== headSig) {
    head.innerHTML = headSig;
    head.dataset.sig = headSig;
  }

  const journey = $("journey");
  stagesFor(run, health).forEach((st, i) => {
    const html = stageHtml(st, i + 1);
    let el = journey.children[i] as HTMLElement | undefined;
    if (!el) {
      el = document.createElement("li");
      journey.appendChild(el);
    }
    if (el.dataset.sig === html) return;
    const was = el.dataset.cls;
    const open = openSet.has(`${run.id}:${st.key}`);
    el.dataset.sig = html;
    el.dataset.cls = st.cls;
    el.dataset.key = st.key;
    el.innerHTML = html;
    el.className = `stage ${st.cls}${open ? " open" : ""}`;
    el.querySelector("[data-more]")?.setAttribute("aria-expanded", String(open));
    if (fresh) {
      el.style.setProperty("--d", `${i * 80}ms`);
      el.classList.add("enter");
    } else if (was !== st.cls) {
      void el.offsetWidth;
      el.classList.add("changed");
    }
  });
}

// The approval token (server: APPROVE_TOKEN) lives in this tab only (sessionStorage), never in the
// page or the URL. It is asked for only when the server answers 401.
const TOKEN_KEY = "cxc-approve-token";

function storedToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined; // storage blocked: ask every time
  }
}

function rememberToken(token: string | undefined): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // not remembered
  }
}

/** A 401 is answered before anything happens, so retrying with an entered token is safe. */
async function decideWithToken(id: string, decision: Decision): Promise<PostResult> {
  const stored = storedToken();
  const first = await decide(id, decision, stored);
  if (first.ok || first.status !== 401) return first;
  rememberToken(undefined);
  const entered = window.prompt(stored ? "Wrong approval token. Enter it again:" : "Approval token (required to approve or reject):")?.trim();
  if (!entered) return { ok: false, status: 401, error: "Approval needs the operator's token. Nothing was approved." };
  const second = await decide(id, decision, entered);
  if (second.ok) rememberToken(entered);
  else if (second.status === 401) return { ok: false, status: 401, error: "Wrong approval token. Nothing was approved." };
  return second;
}

async function act(button: HTMLButtonElement): Promise<void> {
  const id = selected;
  if (!id) return;
  const buttons = [...$("detail").querySelectorAll<HTMLButtonElement>("[data-act]")];
  for (const b of buttons) b.disabled = true;
  button.classList.add("loading");
  try {
    const res = await decideWithToken(id, button.dataset.act as Decision);
    if (!res.ok) toast(res.error);
  } catch {
    toast("Could not reach the agent.");
  }
  await select(id);
  // Still attached only when the card did not re-render (refused, or the agent was unreachable).
  for (const b of buttons) b.disabled = false;
  button.classList.remove("loading");
}

/** Details folds and approve/reject, delegated on the detail card. */
export function initDetail(): void {
  $("detail").addEventListener("click", e => {
    const target = e.target as Element;
    const more = target.closest<HTMLElement>("[data-more]");
    const stage = more?.closest<HTMLElement>(".stage");
    if (more && stage) {
      const key = `${selected}:${stage.dataset.key}`;
      const open = stage.classList.toggle("open");
      more.setAttribute("aria-expanded", String(open));
      if (open) openSet.add(key);
      else openSet.delete(key);
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-act]");
    if (button && !button.disabled) void act(button);
  });
}
