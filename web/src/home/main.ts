import { initChrome, initScrollReveal, reducedMotion } from "../shared/nav.js";

initChrome();
initScrollReveal();

type Stage = "idle" | "read" | "verify" | "route" | "approve" | "paid" | "fade";

// Product shot script: each stage and how long it holds, in ms. "fade" hides the window
// contents so the reset to "idle" happens out of sight.
const SCRIPT: ReadonlyArray<readonly [Stage, number]> = [
  ["idle", 1100],
  ["read", 2300],
  ["verify", 1900],
  ["route", 1500],
  ["approve", 2000],
  ["paid", 3600],
  ["fade", 480],
];
const STEPS: readonly Stage[] = ["read", "verify", "route", "approve", "paid"];

/** Plays the product shot on a loop while it is on screen and the tab is visible. */
function playShot(shot: HTMLElement): void {
  const steps = [...shot.querySelectorAll<HTMLElement>("[data-step]")];
  let index = -1;
  let timer: number | undefined;
  let endsAt = 0;
  let left = 0;
  let onScreen = false;

  const show = (stage: Stage) => {
    shot.dataset.stage = stage;
    // Steps before the current one are done; "paid" completes all five.
    const at = stage === "paid" ? STEPS.length : STEPS.indexOf(stage);
    steps.forEach((step, i) => {
      step.classList.toggle("done", i < at);
      step.classList.toggle("active", i === at);
    });
  };

  // Reset without transitions while the contents are faded out, then fade back in.
  const reset = () => {
    shot.classList.add("snap");
    show("idle");
    void shot.offsetWidth;
    shot.classList.remove("snap", "rewind");
  };

  const wait = (ms: number) => {
    endsAt = performance.now() + ms;
    timer = window.setTimeout(advance, ms);
  };

  function advance(): void {
    index = (index + 1) % SCRIPT.length;
    const [stage, hold] = SCRIPT[index]!;
    if (stage === "idle") reset();
    else if (stage === "fade") shot.classList.add("rewind");
    else show(stage);
    wait(hold);
  }

  const sync = () => {
    const run = onScreen && !document.hidden;
    if (run && timer === undefined) {
      shot.classList.remove("paused");
      if (index < 0) advance();
      else wait(left);
    } else if (!run && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      left = Math.max(0, endsAt - performance.now());
      shot.classList.add("paused");
    }
  };

  reset();
  new IntersectionObserver(
    entries => {
      onScreen = entries.some(entry => entry.isIntersecting);
      sync();
    },
    { threshold: 0.2 },
  ).observe(shot);
  document.addEventListener("visibilitychange", sync);
}

// Reduced motion or no IntersectionObserver: keep the finished state from the HTML.
const shot = document.querySelector<HTMLElement>("[data-shot]");
if (shot && !reducedMotion() && "IntersectionObserver" in window) playShot(shot);

// Count-up for proof figures, e.g. data-count="32.4".
for (const el of document.querySelectorAll<HTMLElement>("[data-count]")) {
  if (reducedMotion() || !("IntersectionObserver" in window)) break;
  const raw = el.dataset.count ?? "";
  const target = Number(raw);
  if (!Number.isFinite(target)) continue;
  const decimals = raw.split(".")[1]?.length ?? 0;
  const draw = (n: number) => (el.textContent = n.toFixed(decimals));
  draw(0);
  const io = new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1400);
        draw(target * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { threshold: 0.6 },
  );
  io.observe(el);
}
