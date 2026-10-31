// Cloudflare Worker that fronts the Node app running in a Cloudflare Container.
// Single named instance: run state is in memory, so all traffic must hit the same container.
import { Container, ContainerProxy } from "@cloudflare/containers";
import { CFO_DATA_HOST, handleCfoData } from "./cfo-proxy.js";
import { authOptions, containerEnv, envFingerprint, type ForwardedKey } from "./env.js";

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

  // The Node process reads its env once, at start. Variables or secrets changed in the dashboard
  // (or with `wrangler secret put`) reach this object at once but not the running process, so
  // a container started with other values is restarted on the next request.
  override async onStart(): Promise<void> {
    await this.ctx.storage.put(ENV_KEY, envFingerprint(this.envVars ?? {}));
  }

  override async fetch(request: Request): Promise<Response> {
    if (this.ctx.container?.running) {
      const wanted = envFingerprint(this.envVars ?? {});
      if ((await this.ctx.storage.get<string>(ENV_KEY)) !== wanted) {
        // Recorded before the restart, so a missed onStart can never cause a restart loop.
        await this.ctx.storage.put(ENV_KEY, wanted);
        await this.stop();
        for (let i = 0; i < 100 && this.ctx.container?.running; i++) await new Promise(r => setTimeout(r, 100));
      }
    }
    return super.fetch(request);
  }
}

const ENV_KEY = "env-fingerprint";

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
