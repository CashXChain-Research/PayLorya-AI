// Settings: workspace name, account, optional password, appearance, sign out.
import { esc } from "../../shared/dom.js";
import { currentTheme, setTheme } from "../../shared/theme.js";
import { get, patch, post } from "../api.js";
import { type Ctx, emitState, signOut, state } from "../state.js";
import type { Me, Workspace } from "../types.js";
import { AUTONOMY, avatar, date, fieldError, icon, pageHead, sk, toast, val } from "../ui.js";

export async function renderSettings(view: HTMLElement, ctx: Ctx): Promise<void> {
  view.innerHTML = `${pageHead("Settings", "Workspace and account.")}<div class="settings">${[1, 2].map(() => `<div class="card">${sk("30%", 18)}<div style="height:18px"></div>${sk("100%", 44, 12)}</div>`).join("")}</div>`;
  const me = await get<Me>("/api/v1/me");
  if (!ctx.alive()) return;
  state.me = me;
  const ws = me.workspace;
  view.innerHTML = `${pageHead("Settings", "Workspace and account.")}
  <div class="settings">
    <form class="card" id="ws-form" novalidate>
      <div class="card-head"><h2>Workspace</h2></div>
      <div class="field"><label for="s-name">Workspace name</label><input id="s-name" name="name" value="${esc(ws.name)}" autocomplete="organization"></div>
      <dl class="kv">
        <dt>Base currency</dt><dd>${esc(ws.baseCurrency)}</dd>
        <dt>Agent autonomy</dt><dd><span class="pill ${AUTONOMY[ws.autonomy].tone}">${AUTONOMY[ws.autonomy].name}</span> <a class="link-sm" href="/app/agent">Change${icon("chevron", 13)}</a></dd>
        <dt>Created</dt><dd>${esc(date(ws.createdAt, true))}</dd>
        <dt>Workspace ID</dt><dd class="mono">${esc(ws.id)}</dd>
      </dl>
      <div class="form-foot"><span></span><button class="btn primary sm" type="submit" id="s-save" disabled>Save</button></div>
    </form>
    <section class="card">
      <div class="card-head"><h2>Account</h2></div>
      <div class="acct">${avatar(me.user.name || me.user.email, "lg")}<div class="acct-text"><b>${esc(me.user.name || "—")}</b><span>${esc(me.user.email)}</span></div></div>
      <dl class="kv acct-kv"><dt>User ID</dt><dd class="mono">${esc(me.user.id)}</dd></dl>
      <div class="form-foot"><span></span><button class="btn ghost sm" type="button" id="s-out">${icon("logout", 16)}Sign out</button></div>
    </section>
    ${passwordCard(me)}
    <section class="card">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="seg wide" role="radiogroup" aria-label="Theme" id="s-theme">
        <button type="button" role="radio" data-t="light" aria-checked="${currentTheme() === "light"}">${icon("sun", 15)}Light</button>
        <button type="button" role="radio" data-t="dark" aria-checked="${currentTheme() === "dark"}">${icon("moon", 15)}Dark</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Environment</h2></div>
      <p class="muted small">Payments in this workspace run on <b>Cardano Preprod</b> (testnet, tADA with no real value) and the <b>CashXChain sandbox</b> fiat rail (a test ledger). USD totals use indicative FX rates.</p>
    </section>
  </div>`;
  const form = view.querySelector<HTMLFormElement>("#ws-form")!;
  const save = view.querySelector<HTMLButtonElement>("#s-save")!;
  form.addEventListener("input", () => (save.disabled = val(form, "name") === (state.me?.workspace.name ?? ws.name)));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const name = val(form, "name");
    if (!name) return void fieldError(form, "name", "Enter a workspace name.");
    save.disabled = true;
    save.classList.add("loading");
    try {
      const w = await patch<Workspace>("/api/v1/workspace", { name });
      if (state.me) state.me = { ...state.me, workspace: w };
      emitState();
      toast("Workspace renamed", "ok");
    } catch {
      save.disabled = false;
    } finally {
      save.classList.remove("loading");
    }
  });
  view.querySelector("#s-out")!.addEventListener("click", () => void signOut());
  wirePassword(view, ctx);
  view.querySelector("#s-theme")!.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-t]");
    if (!b) return;
    setTheme(b.dataset.t as "light" | "dark");
    for (const x of view.querySelectorAll("[data-t]")) x.setAttribute("aria-checked", String(x === b));
  });
}

/** Optional password: sign-in works with an email code; a password is only there if the customer adds one. */
function passwordCard(me: Me): string {
  const has = me.signIn?.password ?? false;
  const intro = has
    ? me.signIn?.codes
      ? "You can sign in with your password or with a code sent to your email."
      : "You sign in with your password."
    : "You sign in with a code sent to your email. Add a password only if you also want to sign in with one.";
  return `<form class="card" id="pw-form" novalidate data-has="${has}">
      <div class="card-head"><h2>Password</h2></div>
      <p class="muted small">${esc(intro)}</p>
      ${has ? `<div class="field"><label for="s-pw-cur">Current password</label><input id="s-pw-cur" name="currentPassword" type="password" autocomplete="current-password"></div>` : ""}
      <div class="field"><label for="s-pw-new">${has ? "New password" : "Password"}</label><input id="s-pw-new" name="password" type="password" autocomplete="new-password" minlength="8"></div>
      <div class="form-foot"><span class="muted small">At least 8 characters.</span><button class="btn primary sm" type="submit" id="s-pw-save">${has ? "Change password" : "Add password"}</button></div>
    </form>`;
}

function wirePassword(view: HTMLElement, ctx: Ctx): void {
  const form = view.querySelector<HTMLFormElement>("#pw-form");
  if (!form) return;
  const has = form.dataset.has === "true";
  const save = form.querySelector<HTMLButtonElement>("#s-pw-save")!;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const currentPassword = has ? (form.elements.namedItem("currentPassword") as HTMLInputElement).value : "";
    if (has && !currentPassword) return void fieldError(form, "currentPassword", "Enter your current password.");
    if (password.length < 8) return void fieldError(form, "password", "Use at least 8 characters.");
    save.disabled = true;
    save.classList.add("loading");
    try {
      await post("/api/v1/me/password", has ? { password, currentPassword } : { password });
      toast(has ? "Password changed" : "Password added. You can now also sign in with it.", "ok");
      if (ctx.alive()) await renderSettings(view, ctx);
    } catch {
      save.disabled = false; // the API layer already showed the reason
    } finally {
      save.classList.remove("loading");
    }
  });
}
