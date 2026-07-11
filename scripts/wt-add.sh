#!/usr/bin/env bash
# Create an isolated dev worktree: own branch + ports + local SQLite home + .env, with deps installed and DB seeded.
# Lets you develop several features in parallel without port/database collisions.
# Usage: pnpm run wt:add -- <name>     (e.g. pnpm run wt:add -- msg-edit)
set -euo pipefail
NAME="${1:-}"
[ -z "$NAME" ] && { echo "Usage: pnpm run wt:add -- <name>  (e.g. msg-edit)"; exit 1; }
SAFE="${NAME//[^a-zA-Z0-9]/_}"
WT="../kith-space-$NAME"
[ -e "$WT" ] && { echo "✗ $WT already exists"; exit 1; }

# Scan for free ports (server from 7801, vite from 5301; avoids dev 7777/5273 and prod 7788).
free_port() { local p=$1; while lsof -i ":$p" >/dev/null 2>&1; do p=$((p+1)); done; echo "$p"; }
SPORT=$(free_port 7801)
VPORT=$(free_port 5301)

# Branch from the canonical main, NOT the current HEAD — otherwise a PR made from this
# worktree would inherit whatever branch you happened to be on. WT_BASE=HEAD to opt out (stacking).
BASE="${WT_BASE:-origin/main}"
echo "→ worktree=$WT  server=$SPORT  vite=$VPORT  data=~/.kith-space-$SAFE  base=$BASE"
git fetch origin main --quiet 2>/dev/null || true
git worktree add "$WT" -b "feature/$NAME" "$BASE"

# Generate random secrets for each worktree — never reuse the weak defaults
# (the server now fails fast on startup if these are missing or empty).
WT_DESKTOP_TOKEN=$(openssl rand -hex 32)
WT_WORKER_TOKEN=$(openssl rand -hex 32)

cat > "$WT/.env" <<EOF
PORT=$SPORT
VITE_PORT=$VPORT
KITH_SPACE_DESKTOP_TOKEN=$WT_DESKTOP_TOKEN
KITH_SPACE_WORKER_TOKEN=$WT_WORKER_TOKEN
KITH_SPACE_HOME=$HOME/.kith-space-$SAFE
EOF

echo "→ Installing deps + seeding the workspace DB (please wait)…"
( cd "$WT" && pnpm install --silent && pnpm run seed )

cat <<EOF

✅ worktree '$NAME' ready (branch feature/$NAME)
   cd $WT
   pnpm run server            # backend on $SPORT (reads this .env)
   pnpm run daemon            # daemon auto-connects to $SPORT
   pnpm --dir web run dev     # frontend on $VPORT, proxies → $SPORT
   open http://localhost:$VPORT
⚠️ To remove, run from the main repo: pnpm run wt:rm -- $NAME
EOF
