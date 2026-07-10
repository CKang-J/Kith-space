import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // Scratch DB for drizzle-kit push/studio only. A file at repo root (no missing parent dir —
  // better-sqlite3 won't mkdir). NOTE: the app itself does NOT use this — each workspace DB
  // auto-migrates on connect (src/db/index.ts migrate()), and `pnpm run seed` creates them.
  // db:push is optional/legacy here; seed is the real schema path.
  dbCredentials: {
    url: process.env.KITH_SPACE_DB ?? "./.kith-space-dev.db",
  },
});
