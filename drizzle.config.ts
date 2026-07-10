import { defineConfig } from "drizzle-kit";
// DATABASE_URL comes from the environment. drizzle-kit loads .env in development;
// production scripts export .env.prod first because dotenv does not override shell variables.

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://opentag:opentag@localhost:5433/opentag",
  },
});
