import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(repoRoot, "web");
const requireFromWeb = createRequire(path.join(webRoot, "package.json"));
const viteEntry = requireFromWeb.resolve("vite");
const viteModule = await import(pathToFileURL(viteEntry).href);
const build = viteModule.build ?? viteModule.default?.build;
if (typeof build !== "function") throw new Error("Unable to resolve the Vite build API");
const outDir = mkdtempSync(path.join(os.tmpdir(), "kith-canvas-stage1-"));

try {
  await build({
    root: webRoot,
    mode: "canvas-stage1",
    build: { outDir, emptyOutDir: true },
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
