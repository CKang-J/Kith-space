#!/bin/sh
# Control-plane container entrypoint: bootstrap data idempotently, then hand off to the server.
# Each workspace DB applies checked-in Drizzle migrations when its connection opens.
set -e

echo "[entrypoint] seeding bootstrap data (idempotent — skips if the workspace already exists)..."
npx tsx src/db/seed.ts

echo "[entrypoint] starting control plane on :${PORT:-7788} ..."
exec npx tsx src/server/index.ts
