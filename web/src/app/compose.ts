import { $, esc } from "../shared/dom.js";
import { reducedMotion } from "../shared/nav.js";
import { createRun, getSamples } from "./api.js";
import { dropTarget } from "./assistant/drop.js";
import { select } from "./detail.js";
import { INVOICE_ACCEPT, readInvoiceFile } from "./files.js";
import { sendBlock } from "./settings/policy.js";
import { getSettings } from "./settings/store.js";
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
  const blocked = sendBlock(getSettings());
  if (blocked) {
    toast(`${blocked}.`);
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

/** Reads a dropped, picked or pasted file into the textarea, so the user sees what will be sent. */
async function attach(file: File | undefined): Promise<void> {
  if (!file) return;
  const button = $<HTMLButtonElement>("attach");
  button.classList.add("loading");
  try {
    const { text } = await readInvoiceFile(file);
    for (const o of document.querySelectorAll(".opt")) o.classList.remove("on");
    const input = $<HTMLTextAreaElement>("input");
    input.value = text;
    input.classList.remove("flash");
    void input.offsetWidth;
    input.classList.add("flash");
    toast(`Read ${file.name}: check the text, then send`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not read the file");
  } finally {
    button.classList.remove("loading");
  }
}

export function initCompose(): void {
  $("send").addEventListener("click", () => void send());
  const picker = $<HTMLInputElement>("file");
  picker.accept = INVOICE_ACCEPT;
  $("attach").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    void attach(picker.files?.[0]);
    picker.value = "";
  });
  $("input").addEventListener("paste", e => {
    const file = e.clipboardData?.files[0];
    if (!file) return;
    e.preventDefault();
    void attach(file);
  });

  // The whole card is a drop target.
  const card = document.querySelector<HTMLElement>(".compose");
  if (card) dropTarget(card, card, files => void attach(files[0]));
}
