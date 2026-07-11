#!/usr/bin/env bash
# Bring up an isolated, on-demand dev E2E stack for this worktree: server + local runtime worker + dev-bot.
# The server serves web/dist on PORT, so browser E2E needs no separate Vite process.
set -euo pipefail
[ -f .env ] || { echo "no .env in $(pwd); run from a configured worktree"; exit 1; }

val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
PORT=$(val PORT)
KEY=$(val DAEMON_BOOTSTRAP_KEY)
HOME_DIR=$(val KITH_SPACE_HOME | sed "s|^\$HOME|$HOME|; s|^~|$HOME|")
: "${PORT:?PORT missing in .env}" "${KEY:?DAEMON_BOOTSTRAP_KEY missing in .env}"
RUN="${HOME_DIR:-$HOME/.kith-space}"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH; install and authenticate it before dev:e2e"; exit 1; }

if [ -f "$RUN/dev-e2e-server.pid" ] && kill -0 "$(cat "$RUN/dev-e2e-server.pid")" 2>/dev/null; then
  echo "dev E2E already running for this worktree (server pid $(cat "$RUN/dev-e2e-server.pid")); run pnpm run dev:e2e:down first"
  exit 1
fi
mkdir -p "$RUN/logs"

echo "schema + bootstrap seed (idempotent)"
pnpm run db:push >/dev/null 2>&1 || true
pnpm run seed >/dev/null 2>&1 || true

echo "building web"
pnpm run web:build >/dev/null

echo "starting server on 127.0.0.1:$PORT"
nohup pnpm exec tsx src/server/index.ts > "$RUN/logs/dev-e2e-server.log" 2>&1 & echo $! > "$RUN/dev-e2e-server.pid"
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || { echo "server did not become healthy; see $RUN/logs/dev-e2e-server.log"; exit 1; }

echo "starting local runtime worker"
nohup pnpm exec tsx src/daemon/index.ts --api-key "$KEY" > "$RUN/logs/dev-e2e-daemon.log" 2>&1 & echo $! > "$RUN/dev-e2e-daemon.pid"
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"workerConnected":true' && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"workerConnected":true' || { echo "local runtime worker did not connect; see $RUN/logs/dev-e2e-daemon.log"; exit 1; }

echo "seeding dev-bot"
pnpm run seed:dev || true

cat <<EOF

dev E2E up (worktree-isolated)
  data dir : $RUN
  login    : http://127.0.0.1:$PORT/?as=you
  agent    : @dev-bot (claude/sonnet) in #all
  logs     : $RUN/logs/dev-e2e-{server,daemon}.log
  stop     : pnpm run dev:e2e:down
EOF
