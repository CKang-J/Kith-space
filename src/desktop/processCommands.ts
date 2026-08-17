import path from "node:path";
import type { DesktopProcessCommands } from "./processSupervisorContract.js";

type PackagedProcessCommandOptions = Readonly<{
  mode: "packaged";
  appRoot: string;
  resourcesPath: string;
  executable: string;
  uiPort: number;
}>;

type DevelopmentProcessCommandOptions = Readonly<{
  mode: "development";
  appRoot: string;
  resourcesPath: string;
  executable: string;
  uiPort: number;
  tsxCli: string;
  viteCli: string;
}>;

export type DesktopProcessCommandOptions = PackagedProcessCommandOptions | DevelopmentProcessCommandOptions;

/** Resolve the supervised process topology without coupling it to Electron globals. */
export function buildDesktopProcessCommands(options: DesktopProcessCommandOptions): DesktopProcessCommands {
  if (options.mode === "development") {
    const advisorHelper = path.join(options.appRoot, "desktop", "dist", "runtime", "pi-advisor-helper.mjs");
    return {
      core: {
        command: options.executable,
        args: [options.tsxCli, "src/server/index.ts"],
        cwd: options.appRoot,
        env: {
          KITH_SPACE_WEB_DIST: path.join(options.appRoot, "web", "dist"),
          KITH_SPACE_VITE_DEV_URL: `http://127.0.0.1:${options.uiPort}`,
          KITH_SPACE_PI_ADVISOR_HELPER: advisorHelper,
        },
      },
      worker: { command: options.executable, args: [options.tsxCli, "src/daemon/index.ts"], cwd: options.appRoot,
        env: { KITH_SPACE_PI_ADVISOR_HELPER: advisorHelper } },
      vite: {
        command: options.executable,
        args: [options.viteCli, "--host", "127.0.0.1"],
        cwd: path.join(options.appRoot, "web"),
        env: { VITE_PORT: String(options.uiPort) },
      },
    };
  }

  const electronNodeEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
  const advisorHelper = path.join(options.resourcesPath, "runtime", "pi-advisor-helper.mjs");
  return {
    core: {
      command: options.executable,
      args: [path.join(options.resourcesPath, "runtime", "core.cjs")],
      cwd: options.resourcesPath,
      env: {
        ...electronNodeEnv,
        NODE_PATH: path.join(options.appRoot, "node_modules"),
        KITH_SPACE_WEB_DIST: path.join(options.resourcesPath, "web", "dist"),
        KITH_SPACE_MIGRATIONS_DIR: path.join(options.resourcesPath, "drizzle"),
        KITH_SPACE_PI_ADVISOR_HELPER: advisorHelper,
      },
    },
    worker: {
      command: options.executable,
      args: [path.join(options.resourcesPath, "runtime", "worker.mjs")],
      cwd: options.resourcesPath,
      env: { ...electronNodeEnv, KITH_SPACE_PI_ADVISOR_HELPER: advisorHelper },
    },
  };
}
