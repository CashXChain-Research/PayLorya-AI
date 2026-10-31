import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// wrangler.jsonc: Cloudflare's edge serves files from public/ before the Worker runs. These checks keep
// server-side routes from being shadowed by a static file of the same path.
const config = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1"),
) as { assets?: { directory?: string; html_handling?: string; run_worker_first?: string[] } };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [`/${relative("public", path).split("\\").join("/")}`];
  });
}

describe("static assets on Cloudflare's edge", () => {
  const assets = config.assets!;
  const first = assets.run_worker_first ?? [];

  it("serves public/ and sends the server routes to the Worker first", () => {
    expect(assets.directory).toBe("./public");
    expect(assets.html_handling).toBe("auto-trailing-slash");
    // /app checks the session and redirects to /login, although public/app.html exists.
    for (const route of ["/app", "/app/*", "/api/*", "/health", "/v1/*", "/facilitator/*"]) expect(first).toContain(route);
  });

  it("no file in public/ sits under a path the server owns", () => {
    const owned = ["/api/", "/v1/", "/facilitator/", "/app/"];
    expect(files("public").filter(f => owned.some(p => f.startsWith(p)))).toEqual([]);
  });
});
