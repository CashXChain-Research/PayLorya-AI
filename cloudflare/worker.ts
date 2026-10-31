// Cloudflare Worker that fronts the Node app running in a Cloudflare Container.
// Single named instance: run state is in memory, so all traffic must hit the same container.
import { Container, ContainerProxy } from "@cloudflare/containers";
import { CFO_DATA_HOST, handleCfoData } from "./cfo-proxy.js";
import { authOptions, containerEnv, type ForwardedKey } from "./env.js";

// Outbound interception of the container's traffic runs through this entrypoint.
export { ContainerProxy };

type Env = {
  AGENTPAY: DurableObjectNamespace<AgentPayContainer>;
  // AI CFO data: accounts and records in D1, uploaded documents in R2. Both outlive deploys.
  CFO_DB: D1Database;
  CFO_FILES: R2Bucket;
} & Partial<Record<ForwardedKey, string>>;

export class AgentPayContainer extends Container<Env> {
  defaultPort = 8787;
  sleepAfter = "24h";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    // Read at container start, so secrets and vars set via wrangler reach the Node process.
    this.envVars = containerEnv(env);
  }
}

// http://cfo-data.internal from inside the container is answered here, with the bindings.
AgentPayContainer.outboundByHost = {
  [CFO_DATA_HOST]: (request: Request, env: Env) => handleCfoData(request, env.CFO_DB, env.CFO_FILES),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/auth-options") {
      return Response.json(authOptions(env), { headers: { "cache-control": "no-store" } });
    }
    // A Durable Object stays where it was first created; the hint places it in Western Europe,
    // next to the container (constraints in wrangler.jsonc) and D1. New name: the old "main"
    // object may live elsewhere. It holds no data (accounts and records are in D1/R2).
    const id = env.AGENTPAY.idFromName("main-weur");
    return env.AGENTPAY.get(id, { locationHint: "weur" }).fetch(request);
  },
};
