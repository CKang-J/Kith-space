// Internal source-checkout helper: manual split-process development may load an optional local .env.
// Packaged Desktop is authoritative and never loads it; tests may point ENV_FILE at an isolated fixture.
// Imported first so a developer override is visible before modules read process.env.
const desktopManaged = process.env.KITH_SPACE_DESKTOP_MANAGED === "1";
if (!desktopManaged) {
  const envFile = process.env.ENV_FILE || ".env";
  try {
    (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(envFile);
  } catch {
    /* file missing or old Node: fall back to in-code defaults */
  }
}
