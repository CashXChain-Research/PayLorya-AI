// Cloudflare Worker that fronts the Node app running in a Cloudflare Container.
// Single named instance: run state is in memory, so all traffic must hit the same container.
import { Container, getContainer } from "@cloudflare/containers";
import { containerEnv, type ForwardedKey } from "./env.js";

type Env = { AGENTPAY: DurableObjectNamespace<AgentPayContainer> } & Partial<Record<ForwardedKey, string>>;

export class AgentPayContainer extends Container<Env> {
  defaultPort = 8787;
  sleepAfter = "2h";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    // Read at container start, so secrets and vars set via wrangler reach the Node process.
    this.envVars = containerEnv(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.AGENTPAY, "main").fetch(request);
  },
};
