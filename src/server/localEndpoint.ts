import { BrowserAccessPolicy } from "../browser-access/index.js";

type ListenerPortPolicy = {
  getListenerPolicy(): { port: number };
};

export function resolveCorePort(
  env: NodeJS.ProcessEnv = process.env,
  policy: ListenerPortPolicy = new BrowserAccessPolicy(),
): number {
  if (env.PORT === undefined) return policy.getListenerPolicy().port;
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function coreLoopbackUrl(
  env: NodeJS.ProcessEnv = process.env,
  policy?: ListenerPortPolicy,
): string {
  return `http://127.0.0.1:${resolveCorePort(env, policy)}`;
}
