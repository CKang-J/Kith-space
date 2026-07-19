import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "desktop/dist");
const production = process.argv.includes("--production");

const desktopBuilds = [
  build({
    entryPoints: [path.join(root, "src/desktop/main.ts")],
    outfile: path.join(distDir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [path.join(root, "src/desktop/preload.ts")],
    outfile: path.join(distDir, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
];

if (production) {
  const runtimeDir = path.join(distDir, "runtime");
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  const requireShim = "import { createRequire as __ctr } from 'node:module'; const require = __ctr(import.meta.url);";
  const runtimeCommon = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: requireShim },
    logLevel: "info",
  };
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  desktopBuilds.push(
    build({
      entryPoints: [path.join(root, "src/server/index.ts")],
      outfile: path.join(runtimeDir, "core.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      logLevel: "info",
      external: ["better-sqlite3", "bufferutil", "utf-8-validate"],
      define: { "import.meta.url": JSON.stringify("file:///__kith_space_bundle__/src/server/index.js") },
    }),
    build({
      ...runtimeCommon,
      entryPoints: [path.join(root, "src/daemon/index.ts")],
      outfile: path.join(runtimeDir, "worker.mjs"),
      external: ["bufferutil", "utf-8-validate"],
      define: { "process.env.DAEMON_VERSION": JSON.stringify(version) },
    }),
    build({
      ...runtimeCommon,
      entryPoints: [path.join(root, "src/cli/index.ts")],
      outfile: path.join(runtimeDir, "agent-cli.mjs"),
    }),
    build({
      ...runtimeCommon,
      entryPoints: [path.join(root, "src/server/mcp/stdio.ts")],
      outfile: path.join(runtimeDir, "kith-core-mcp.mjs"),
    }),
  );
}

await Promise.all(desktopBuilds);
