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
    for (const route of ["/app", "/app/*", "/api/*", "/health", "/v1/*", "/facilitator/*", "/mcp"]) expect(first).toContain(route);
  });

  it("no file in public/ sits under a path the server owns", () => {
    const owned = ["/api/", "/v1/", "/facilitator/", "/app/", "/mcp"];
    expect(files("public").filter(f => owned.some(p => f.startsWith(p)))).toEqual([]);
  });
});

describe("self-hosted Manrope", () => {
  const html = files("public").filter(f => f.endsWith(".html"));
  const css = readFileSync("public/styles/base.css", "utf8");

  it("no page loads fonts from Google; every page preloads the local Latin file", () => {
    for (const page of html) {
      const text = readFileSync(join("public", page), "utf8");
      expect(text, page).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      expect(text, page).toContain('<link rel="preload" href="/fonts/manrope-latin-v23.woff2" as="font" type="font/woff2" crossorigin>');
    }
  });

  it("each @font-face file exists, with its license, and /fonts/* is cached for a year", () => {
    const urls = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map(m => m[1]!);
    expect(urls).toEqual(["/fonts/manrope-latin-ext-v23.woff2", "/fonts/manrope-latin-v23.woff2"]);
    for (const url of urls) expect(statSync(join("public", url)).size).toBeGreaterThan(10_000);
    expect(readFileSync("public/fonts/OFL.txt", "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(readFileSync("public/_headers", "utf8")).toMatch(/^\/fonts\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m);
  });
});
