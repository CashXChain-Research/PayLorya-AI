// Cloudflare Worker that fronts the Node app running in a Cloudflare Container.
// Single named instance: run state is in memory, so all traffic must hit the same container.
import { Container, getContainer } from "@cloudflare/containers";

const FORWARDED = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_MODEL",
  "BLOCKFROST_PROJECT_ID",
  "SELLER_ADDRESS",
  "BUYER_MNEMONIC",
  "FACILITATOR_URL",
  "LOCAL_FACILITATOR",
  "PUBLIC_BASE_URL",
  "PRICE_LOVELACE",
  "MAX_PRICE_LOVELACE",
  "SESSION_BUDGET_LOVELACE",
] as const;

type Env = { AGENTPAY: DurableObjectNamespace<AgentPayContainer> } & Partial<Record<(typeof FORWARDED)[number], string>>;

export class AgentPayContainer extends Container<Env> {
  defaultPort = 8787;
  sleepAfter = "2h";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = { PORT: "8787" };
    for (const key of FORWARDED) {
      const value = env[key];
      if (value) vars[key] = value;
    }
    this.envVars = vars;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.AGENTPAY, "main").fetch(request);
  },
};
