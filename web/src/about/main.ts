import { initChrome, initScrollReveal, reducedMotion } from "../shared/nav.js";

initChrome();
initScrollReveal();

/** Calls `run` once when `el` is mostly on screen; at once without IntersectionObserver. */
function onView(el: Element, run: () => void, threshold = 0.45): void {
  if (!("IntersectionObserver" in window)) return run();
  const io = new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      io.disconnect();
      run();
    },
    { threshold },
  );
  io.observe(el);
}

// Flow and x402 sequence: start dimmed (data-armed), then play step by step once in view.
// Unarmed (reduced motion, no JS) they render in their final state.
const plays = [...document.querySelectorAll<HTMLElement>("[data-play]")];
for (const el of plays) {
  if (reducedMotion()) continue;
  el.dataset.armed = "";
  onView(el, () => el.classList.add("play"));
}

// Replay: drop the played state without transitions, then play again.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-replay]")) {
  const target = button.closest<HTMLElement>("[data-play]");
  if (!target) continue;
  button.addEventListener("click", () => {
    target.classList.add("reset");
    target.classList.remove("play");
    void target.offsetWidth;
    target.classList.remove("reset");
    target.classList.add("play");
  });
}

// Count-up for proof figures, e.g. data-count="32.4".
for (const el of document.querySelectorAll<HTMLElement>("[data-count]")) {
  if (reducedMotion()) continue;
  const raw = el.dataset.count ?? "";
  const target = Number(raw);
  if (!Number.isFinite(target)) continue;
  const decimals = raw.split(".")[1]?.length ?? 0;
  const show = (n: number) => (el.textContent = n.toFixed(decimals));
  show(0);
  onView(el, () => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1400);
      show(target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, 0.6);
}
