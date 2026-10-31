import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { BUILD_ID, BUILDS, VENDOR } from "../web/build.js";

const read = (path: string): Buffer | undefined => {
  try {
    return readFileSync(path);
  } catch {
    return undefined; // missing file: reported by the assertion
  }
};

// The container serves public/assets as committed (no build step in the Dockerfile).
describe("committed web bundle", () => {
  it("matches a fresh build of web/src (run npm run build:web)", async () => {
    for (const options of BUILDS) {
      const result = await build({ ...options, write: false, logLevel: "silent" });
      for (const file of result.outputFiles) {
        expect(read(file.path)?.toString("utf8"), `${file.path} is stale`).toBe(file.text);
      }
    }
  });

  it("build.json names the dashboard's build (run npm run build:web)", () => {
    expect(JSON.parse(read("public/assets/build.json")?.toString("utf8") ?? "{}").id).toBe(BUILD_ID);
  });

  it("vendored files match node_modules (run npm run build:web)", () => {
    for (const { from, to } of VENDOR) {
      expect(read(to)?.equals(readFileSync(from)), `${to} differs from ${from}`).toBe(true);
    }
  });
});
