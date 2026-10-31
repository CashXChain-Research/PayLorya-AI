import { $, esc, money } from "../shared/dom.js";
import { getRun, type Decision, type Run } from "./api.js";
import { decideRun } from "./approval.js";
import { health, loadHealth } from "./health.js";
import { loadList } from "./list.js";
import { markAttempted, onAutoChange } from "./settings/auto-state.js";
import { approvalBlock } from "./settings/policy.js";
import { getSettings, onSettings } from "./settings/store.js";
import { TERMINAL, stageHtml, stagesFor } from "./stages.js";
import { clock, initials, pill, toast, tone } from "./ui.js";

let selected: string | null = null;
let renderedRun: string | null = null;
/** Last run drawn, re-rendered when Agent settings or auto-approve change. */
let shown: Run | undefined;
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
  shown = run;
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

async function act(button: HTMLButtonElement): Promise<void> {
  const id = selected;
  if (!id) return;
  const decision = button.dataset.act as Decision;
  // Agent settings may have changed since the card was drawn.
  const block = decision === "approve" && shown?.id === id ? approvalBlock(shown, getSettings()) : undefined;
  if (block) {
    toast(`${block}.`);
    renderDetail(shown!);
    return;
  }
  const buttons = [...$("detail").querySelectorAll<HTMLButtonElement>("[data-act]")];
  const was = buttons.map(b => b.disabled);
  for (const b of buttons) b.disabled = true;
  button.classList.add("loading");
  // A click takes over from auto-approve for this draft.
  if (decision === "approve") markAttempted(id);
  try {
    const res = await decideRun(id, decision);
    if (!res.ok) {
      if (decision === "approve" && (res.status === 0 || res.status === 401)) markAttempted(id, false);
      if (res.status !== 401) toast(res.error); // decideRun already said why
    }
  } catch {
    toast("Could not reach the agent.");
  }
  await select(id);
  // Still attached only when the card did not re-render (refused, or the agent was unreachable).
  buttons.forEach((b, i) => (b.disabled = was[i]!));
  button.classList.remove("loading");
}

/** Details folds and approve/reject, delegated on the detail card. */
export function initDetail(): void {
  onSettings(() => {
    if (shown && shown.id === selected) renderDetail(shown);
  });
  // Auto-approve acted on the open run: poll it again; otherwise redraw for the token hint.
  onAutoChange(id => {
    if (id && id === selected) void select(id);
    else if (shown && shown.id === selected) renderDetail(shown);
  });
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
