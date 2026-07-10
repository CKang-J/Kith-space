// Load the project-root .env at startup (Node 20.6+ native loadEnvFile), so `cp .env.example .env` works out of the box.
// Imported as the first side-effect import in each entry point, ensuring it runs before any module reads process.env (e.g. db/index.ts).
// Silently skipped when the file is missing or the Node version is too old; falls back to in-code defaults (aligned with docker-compose).
// Set ENV_FILE to load a different env file (default: .env); use ENV_FILE=.env.prod to switch to a separate port/database in production.
const envFile = process.env.ENV_FILE || ".env";
try {
  (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(envFile);
} catch {
  /* file missing or old Node: fall back to in-code defaults */
}
