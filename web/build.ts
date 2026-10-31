// Bundles the browser TypeScript in web/src into public/assets. The output is committed, so the
// container serves it as static files with no build step; tests/web-bundle.test.ts fails if it is stale.
import { copyFileSync, mkdirSync } from "node:fs";
import { build, type BuildOptions } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const common: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  target: "es2022",
  legalComments: "none",
  outdir: "public/assets",
  logLevel: "warning",
};

export const BUILDS: BuildOptions[] = [
  // Pages, loaded as <script type="module">.
  {
    ...common,
    format: "esm",
    entryPoints: { app: "web/src/app/main.ts", home: "web/src/home/main.ts", about: "web/src/about/main.ts" },
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
}
