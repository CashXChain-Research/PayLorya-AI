export type Theme = "light" | "dark";

const KEY = "cxc-theme";
const media = matchMedia("(prefers-color-scheme: dark)");

export function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return media.matches ? "dark" : "light";
}

/** Switches theme with a short cross-fade; the choice is remembered per browser. */
export function setTheme(theme: Theme): void {
  const html = document.documentElement;
  html.classList.add("theme-anim");
  html.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts for this page view
  }
  window.setTimeout(() => html.classList.remove("theme-anim"), 450);
  syncToggles();
}

function syncToggles(): void {
  const dark = currentTheme() === "dark";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }
}

/** Wires every [data-theme-toggle] button and follows system changes until the user picks one. */
export function initTheme(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    button.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
  }
  media.addEventListener("change", syncToggles);
  syncToggles();
}
