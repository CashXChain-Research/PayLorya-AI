import { $, ada, short, tada } from "../shared/dom.js";
import { getHealth, type Health } from "./api.js";
import { countTo } from "./ui.js";

/** Last /api/health response; empty while the agent is unreachable. */
export let health: Partial<Health> = {};
const listeners = new Set<() => void>();

/** Called after every /api/health load (e.g. chatReady changed). */
export function onHealth(listener: () => void): void {
  listeners.add(listener);
}

/** Nav status and wallet chip, the price hint and the spend/payout stats. */
export async function loadHealth(): Promise<void> {
  try {
    health = await getHealth();
  } catch {
    health = {};
  }
  const ready = health.x402Ready && health.aiReady;
  const status = $("p-status");
  status.className = `status${ready ? "" : " off"}`;
  status.querySelector("span")!.textContent = ready
    ? "Preprod · online"
    : health.status ? (health.x402Ready ? "AI offline" : "Wallet not set") : "Offline";
  $("p-wallet").textContent = health.buyerAddress ? `agent ${short(health.buyerAddress)}` : "agent wallet not set";
  $("price").textContent = tada(health.priceLovelace || 2e6);

  const spent = Number(health.spentLovelace || 0);
  const budget = Number(health.sessionBudgetLovelace || 0);
  countTo($("k-spend"), spent, v => tada(v));
  $("k-budget").textContent = budget ? `of ${ada(budget)} session budget` : "session budget";
  $("k-meter").style.width = budget ? `${Math.min(100, (spent / budget) * 100)}%` : "0";
  $("k-paid-sub").textContent = `${ada(health.paidOutLovelace)} of ${ada(health.payoutBudgetLovelace)} on Cardano`;
  for (const listener of listeners) listener();
}
