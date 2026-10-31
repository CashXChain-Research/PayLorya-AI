import { $, esc } from "../shared/dom.js";
import { reducedMotion } from "../shared/nav.js";
import { createRun, getSamples } from "./api.js";
import { select } from "./detail.js";
import { I, toast } from "./ui.js";

// Keys of /api/samples (src/fixtures.ts). "repeat" re-sends the last input to show the duplicate stop.
const SCENARIOS: Array<{ key: string; label: string; safety?: boolean }> = [
  { key: "sepa_ok", label: "Supplier invoice · EUR" },
  { key: "us_ok", label: "US vendor · USD" },
  { key: "crypto_ok", label: "Crypto invoice · tADA" },
  { key: "bad_iban", label: "Typo in IBAN", safety: true },
  { key: "no_bank_details", label: "No bank details", safety: true },
  { key: "prompt_injection", label: "Prompt injection", safety: true },
  { key: "wallet_swap", label: "Wallet swapped", safety: true },
  { key: "repeat", label: "Same invoice again", safety: true },
];

let samples: Record<string, string> = {};
let lastInput = "";

function fill(chip: HTMLButtonElement, key: string): void {
  for (const o of document.querySelectorAll(".opt")) o.classList.remove("on");
  chip.classList.add("on");
  const input = $<HTMLTextAreaElement>("input");
  input.value = (key === "repeat" ? lastInput || samples.sepa_ok : samples[key]) ?? "";
  input.classList.remove("flash");
  void input.offsetWidth;
  input.classList.add("flash");
}

/** Example and safety-test chips; a chip only shows when the server has that sample. */
export async function loadSamples(): Promise<void> {
  try {
    samples = await getSamples();
  } catch {
    samples = {};
  }
  const examples = $("chips");
  const safety = $("chips-safety");
  examples.replaceChildren();
  safety.replaceChildren();
  for (const s of SCENARIOS) {
    if (s.key !== "repeat" && !samples[s.key]) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "opt";
    chip.innerHTML = `${s.safety ? I.shieldSm : ""}${esc(s.label)}`;
    chip.addEventListener("click", () => fill(chip, s.key));
    (s.safety ? safety : examples).appendChild(chip);
  }
  $("g-safe").hidden = !safety.children.length;
}

async function send(): Promise<void> {
  const textarea = $<HTMLTextAreaElement>("input");
  const input = textarea.value.trim();
  if (!input) {
    textarea.focus();
    return;
  }
  const button = $<HTMLButtonElement>("send");
  button.disabled = true;
  button.classList.add("loading");
  try {
    const res = await createRun(input);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    lastInput = input;
    await select(res.data.id);
    if (window.innerWidth < 980) $("detail").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  } catch {
    toast("Could not reach the agent.");
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

export function initCompose(): void {
  $("send").addEventListener("click", () => void send());
}
