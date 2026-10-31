// Bundles the browser TypeScript in web/src into public/assets. The output is committed, so the
// container serves it as static files with no build step; tests/web-bundle.test.ts fails if it is stale.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build, type BuildOptions } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir)
    .flatMap(name => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
    .sort();
}

/**
 * Content id of the dashboard's sources. The dashboard is built with it and sends it with every API
 * call; the server reads it from public/assets/build.json. A page loaded before a deploy then learns
 * it is out of date (and money actions from it are refused), instead of failing in odd ways.
 */
export const BUILD_ID = (() => {
  const hash = createHash("sha256");
  for (const file of [...files(join(root, "web/src/dashboard")), ...files(join(root, "web/src/shared"))]) {
    hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
})();

const common: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  target: "es2022",
  legalComments: "none",
  outdir: "public/assets",
  logLevel: "warning",
  define: { __PAYLORYA_BUILD__: JSON.stringify(BUILD_ID) },
};

export const BUILDS: BuildOptions[] = [
  // Pages, loaded as <script type="module">.
  {
    ...common,
    format: "esm",
    entryPoints: {
      app: "web/src/app/main.ts",
      home: "web/src/home/main.ts",
      about: "web/src/about/main.ts",
      marketing: "web/src/marketing/main.ts",
      auth: "web/src/auth/main.ts",
      dashboard: "web/src/dashboard/main.ts",
    },
  },
  // Runs before first paint (blocking script in <head>), so the theme never flashes.
  { ...common, format: "iife", entryPoints: { "theme-init": "web/src/theme-init.ts" } },
];

// Prebuilt third-party files served as-is and loaded on demand (pdf.js only when a PDF is dropped).
export const VENDOR: Array<{ from: string; to: string }> = [
  { from: "node_modules/pdfjs-dist/build/pdf.min.mjs", to: "public/assets/vendor/pdf.min.mjs" },
  { from: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs", to: "public/assets/vendor/pdf.worker.min.mjs" },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const options of BUILDS) await build(options);
  mkdirSync(`${root}public/assets/vendor`, { recursive: true });
  for (const { from, to } of VENDOR) copyFileSync(`${root}${from}`, `${root}${to}`);
  writeFileSync(`${root}public/assets/build.json`, `${JSON.stringify({ id: BUILD_ID })}\n`);
}
