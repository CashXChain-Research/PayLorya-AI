import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { BUILDS } from "../web/build.js";

// The container serves public/assets as committed (no build step in the Dockerfile).
describe("committed web bundle", () => {
  it("matches a fresh build of web/src (run npm run build:web)", async () => {
    for (const options of BUILDS) {
      const result = await build({ ...options, write: false, logLevel: "silent" });
      for (const file of result.outputFiles) {
        let committed = "";
        try {
          committed = readFileSync(file.path, "utf8");
        } catch {
          // missing file: reported by the assertion below
        }
        expect(committed, `${file.path} is stale`).toBe(file.text);
      }
    }
  });
});
