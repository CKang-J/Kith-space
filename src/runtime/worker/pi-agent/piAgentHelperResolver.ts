import path from "node:path";
import { fileURLToPath } from "node:url";

export const PI_AGENT_HELPER_NAME = "pi-agent-helper.mjs";

/**
 * Resolve the bundled built-in Pi Agent helper. In the bundled Worker the
 * helper is a sibling of the worker entry; in the source tree the dev build
 * output under desktop/dist/runtime is used instead (same contract as
 * resolvePiAdvisorHelper in src/runtime/worker/maintenance/piSdkAdvisorProvider.ts).
 */
export function resolvePiAgentHelper(): string {
  const explicit = process.env.KITH_SPACE_PI_AGENT_HELPER;
  if (explicit) return path.resolve(explicit);
  const sibling = fileURLToPath(new URL(`./${PI_AGENT_HELPER_NAME}`, import.meta.url));
  if (!sibling.includes(`${path.sep}src${path.sep}`)) return sibling;
  return path.resolve(process.cwd(), "desktop", "dist", "runtime", PI_AGENT_HELPER_NAME);
}
