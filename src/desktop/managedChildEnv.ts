import path from "node:path";

export const DESKTOP_TOKEN_ENV = "KITH_SPACE_DESKTOP_TOKEN";
export const WORKER_TOKEN_ENV = "KITH_SPACE_WORKER_TOKEN";

export function removeEnvKey(env: NodeJS.ProcessEnv, target: string): void {
  const normalized = target.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === normalized) delete env[key];
  }
}

export function buildManagedChildEnv(
  parentEnv: Readonly<NodeJS.ProcessEnv>,
  commandEnv: Readonly<NodeJS.ProcessEnv> | undefined,
  home: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv, ...commandEnv };
  for (const key of [
    DESKTOP_TOKEN_ENV,
    WORKER_TOKEN_ENV,
    "KITH_SPACE_DESKTOP_MANAGED",
    "KITH_SPACE_HOME",
    "ENV_FILE",
  ]) removeEnvKey(env, key);
  env.KITH_SPACE_DESKTOP_MANAGED = "1";
  env.KITH_SPACE_HOME = home;
  // Existing entry points still import src/env.ts. The managed marker is authoritative; this absent path also
  // prevents older entry points from loading a project/user .env during the A4 transition.
  env.ENV_FILE = path.join(home, ".kith-space", "desktop-managed.env.disabled");
  return env;
}
