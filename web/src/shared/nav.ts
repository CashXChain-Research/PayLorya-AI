import { initTheme } from "./theme.js";

/** Shared page chrome: theme toggle, hairline under the sticky nav once the page scrolls. */
export function initChrome(): void {
  initTheme();
  const nav = document.querySelector<HTMLElement>(".nav");
  if (!nav) return;
  const update = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", update, { passive: true });
  update();
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Adds .in to [data-reveal] elements as they scroll into view (once). */
export function initScrollReveal(root: ParentNode = document): void {
  const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    for (const el of items) el.classList.add("in");
    return;
  }
  const io = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
  );
  for (const el of items) io.observe(el);
}
