// Blocking <head> script: apply a saved theme before first paint. Without one, CSS follows the system.
try {
  const saved = localStorage.getItem("cxc-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // storage blocked: follow the system theme
}
