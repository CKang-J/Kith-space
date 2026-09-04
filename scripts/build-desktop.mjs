import { build } from "esbuild";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "desktop/dist");
const production = process.argv.includes("--production");
const requireShim = "import { createRequire as __ctr } from 'node:module'; const require = __ctr(import.meta.url);";

function verifyHelperStartup(helperPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath], {
      env: { FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrBytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Pi Advisor helper startup smoke test timed out")); }, 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        if (code !== 1 || result?.ok !== false || result?.errorCode !== "provider_request_invalid" || stderrBytes !== 0) {
          throw new Error("unexpected helper startup result");
        }
        resolve();
      } catch (error) {
        reject(new Error(`Pi Advisor helper startup smoke test failed: ${error instanceof Error ? error.message : "invalid output"}`));
      }
    });
    child.stdin.end("{}");
  });
}

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

const runtimeDir = path.join(distDir, "runtime");
if (production) await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
const helperBuild = build({
  entryPoints: [path.join(root, "src/runtime/worker/maintenance/pi-advisor-helper.ts")],
  outfile: path.join(runtimeDir, "pi-advisor-helper.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: requireShim },
  metafile: true,
  logLevel: "info",
});
desktopBuilds.push(helperBuild.then(async (result) => {
  const output = Object.values(result.metafile.outputs).find((item) => item.entryPoint?.endsWith("pi-advisor-helper.ts"));
  if (!output) throw new Error("Pi Advisor helper build metadata is missing its entry output");
  const inputs = Object.entries(output.inputs).filter(([, detail]) => detail.bytesInOutput > 0).map(([input]) => input);
  const forbidden = inputs.filter((input) => /pi-(?:agent-core|coding-agent)|pi-ai[\\/]dist[\\/]compat(?:[\\/]|\.)/.test(input));
  if (forbidden.length) throw new Error(`Pi Advisor helper contains forbidden dependencies: ${forbidden.join(", ")}`);
  const helperBytes = await readFile(path.join(runtimeDir, "pi-advisor-helper.mjs"));
  await verifyHelperStartup(path.join(runtimeDir, "pi-advisor-helper.mjs"));
  const licenseBytes = await readFile(path.join(root, "THIRD_PARTY_LICENSES.md"));
  await writeFile(path.join(runtimeDir, "pi-advisor-build-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    piAiVersion: "0.81.1",
    license: "MIT",
    node: ">=22.19.0",
    packageIntegrity: "sha512-hzHE7Z8l5mgJk+ke67Lge0rwS2+wbKJrFKl9o5M1R1rh33+cCT7D1AHz1OAtX5wFs90E1/BTGhyJRTUHaMxGvQ==",
    helperSha256: createHash("sha256").update(helperBytes).digest("hex"),
    thirdPartyLicensesSha256: createHash("sha256").update(licenseBytes).digest("hex"),
    inputs: inputs.sort(),
    forbiddenDependencies: [],
  }, null, 2));
}));

async function verifyPiAgentHelperStartup(helperPath, assetsDir) {
  const piAgentRoot = await mkdtemp(path.join(os.tmpdir(), "kith-pi-agent-smoke-"));
  try {
    await mkdir(path.join(piAgentRoot, "agent"), { recursive: true });
    await mkdir(path.join(piAgentRoot, "sessions"), { recursive: true });
    await writeFile(path.join(piAgentRoot, "agent", "models.json"), JSON.stringify({
      providers: { kith: { baseUrl: "https://api.deepseek.com", apiKey: "$KITH_PI_API_KEY", api: "openai-completions",
        models: [{ id: "smoke-model", name: "smoke-model" }] } },
    }));
    await writeFile(path.join(piAgentRoot, "agent", "settings.json"), JSON.stringify({ defaultProjectTrust: "never" }));
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [helperPath,
        "--mode", "rpc", "--provider", "kith", "--model", "smoke-model",
        "--no-approve", "--no-context-files", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-themes", "--session-dir", path.join(piAgentRoot, "sessions"),
      ], {
        cwd: piAgentRoot,
        env: {
          PI_PACKAGE_DIR: assetsDir,
          PI_CODING_AGENT_DIR: path.join(piAgentRoot, "agent"),
          PI_CODING_AGENT_SESSION_DIR: path.join(piAgentRoot, "sessions"),
          KITH_PI_API_KEY: "smoke-key", PI_OFFLINE: "1", PI_TELEMETRY: "0", DO_NOT_TRACK: "1",
          FORCE_COLOR: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderrBytes = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error("Pi Agent helper startup smoke test timed out")); }, 30_000);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => {
        clearTimeout(timer);
        try {
          const response = JSON.parse(stdout);
          if (code !== 0 || response?.type !== "response" || response.command !== "get_state"
            || response.success !== true || typeof response.data?.sessionId !== "string" || stderrBytes !== 0) {
            throw new Error(`unexpected helper startup result: code=${code} stderr=${stderrBytes} stdout=${stdout.slice(0, 300)}`);
          }
          resolve();
        } catch (error) {
          reject(new Error(`Pi Agent helper startup smoke test failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.end('{"id":"1","type":"get_state"}\n');
    });
  } finally {
    await rm(piAgentRoot, { recursive: true, force: true });
  }
}

const piAgentHelperBuild = build({
  entryPoints: [path.join(root, "src/runtime/worker/pi-agent/piAgentHelperEntry.ts")],
  outfile: path.join(runtimeDir, "pi-agent-helper.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: requireShim },
  metafile: true,
  logLevel: "info",
});
desktopBuilds.push(piAgentHelperBuild.then(async (result) => {
  const output = Object.values(result.metafile.outputs).find((item) => item.entryPoint?.endsWith("piAgentHelperEntry.ts"));
  if (!output) throw new Error("Pi Agent helper build metadata is missing its entry output");
  const inputs = Object.entries(output.inputs).filter(([, detail]) => detail.bytesInOutput > 0).map(([input]) => input);
  const missing = ["pi-agent-core", "pi-coding-agent"].filter((name) =>
    !inputs.some((input) => input.includes(`${path.sep}@earendil-works${path.sep}${name}${path.sep}`)));
  if (missing.length) throw new Error(`Pi Agent helper is missing required dependencies: ${missing.join(", ")}`);
  // The bundled CLI reads its built-in theme JSONs from disk at startup.
  // Ship them next to the helper and point PI_PACKAGE_DIR at the assets root.
  const assetsDir = path.join(runtimeDir, "pi-agent-assets");
  const themeSource = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme");
  const themeTarget = path.join(assetsDir, "dist", "modes", "interactive", "theme");
  await mkdir(themeTarget, { recursive: true });
  for (const name of ["dark.json", "light.json"]) {
    await copyFile(path.join(themeSource, name), path.join(themeTarget, name));
  }
  await verifyPiAgentHelperStartup(path.join(runtimeDir, "pi-agent-helper.mjs"), assetsDir);
  const helperBytes = await readFile(path.join(runtimeDir, "pi-agent-helper.mjs"));
  const licenseBytes = await readFile(path.join(root, "THIRD_PARTY_LICENSES.md"));
  await writeFile(path.join(runtimeDir, "pi-agent-build-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    piAgentCoreVersion: "0.84.2",
    piCodingAgentVersion: "0.84.2",
    license: "MIT",
    node: ">=22.19.0",
    helperSha256: createHash("sha256").update(helperBytes).digest("hex"),
    themeAssetsSha256: {
      dark: createHash("sha256").update(await readFile(path.join(themeTarget, "dark.json"))).digest("hex"),
      light: createHash("sha256").update(await readFile(path.join(themeTarget, "light.json"))).digest("hex"),
    },
    thirdPartyLicensesSha256: createHash("sha256").update(licenseBytes).digest("hex"),
    inputs: inputs.sort(),
  }, null, 2));
}));

if (production) {
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
