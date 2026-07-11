import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await Promise.all([
  build({
    entryPoints: [path.join(root, "src/desktop/main.ts")],
    outfile: path.join(root, "desktop/dist/main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [path.join(root, "src/desktop/preload.ts")],
    outfile: path.join(root, "desktop/dist/preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
]);
