// Bundles the browser TypeScript in web/src into public/assets. The output is committed, so the
// container serves it as static files with no build step; tests/web-bundle.test.ts fails if it is stale.
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
    // esbuild emits a shared chunk only with splitting; each page stays one file instead.
    entryPoints: {
      app: "web/src/app/main.ts",
      about: "web/src/about/main.ts",
      marketing: "web/src/marketing/main.ts",
      auth: "web/src/auth/main.ts",
      dashboard: "web/src/dashboard/main.ts",
    },
  },
  // Runs before first paint (blocking script in <head>), so the theme never flashes.
  { ...common, format: "iife", entryPoints: { "theme-init": "web/src/theme-init.ts" } },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const options of BUILDS) await build(options);
}
