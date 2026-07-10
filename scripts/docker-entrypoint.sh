#!/bin/sh
# Control-plane container entrypoint: bootstrap data idempotently, then hand off to the server.
# Each workspace DB applies checked-in Drizzle migrations when its connection opens.
set -e

echo "[entrypoint] seeding bootstrap data (idempotent — skips if the workspace already exists)..."
./node_modules/.bin/tsx src/db/seed.ts

echo "[entrypoint] starting control plane on :${PORT:-7788} ..."
exec ./node_modules/.bin/tsx src/server/index.ts
