#!/usr/bin/env bash
# Safely remove a worktree: stop its dev stack, git worktree remove, then clean its isolated SQLite data dir.
# Usage: npm run wt:rm -- <name>
set -euo pipefail
NAME="${1:-}"
[ -z "$NAME" ] && { echo "Usage: npm run wt:rm -- <name>"; exit 1; }
WT="../kith-space-$NAME"
SAFE="${NAME//[^a-zA-Z0-9]/_}"
[ -d "$WT" ] || { echo "✗ $WT does not exist"; exit 1; }

# 1) Stop this worktree's dev E2E stack (server + daemon), then any server/vite still bound to its ports.
if [ -f "$WT/.env" ]; then
  ( cd "$WT" && npm run dev:e2e:down >/dev/null 2>&1 ) || true
  for k in PORT VITE_PORT; do
    v=$(grep -E "^$k=" "$WT/.env" | cut -d= -f2 || true)
    [ -n "${v:-}" ] && lsof -ti "tcp:$v" 2>/dev/null | xargs kill 2>/dev/null || true
  done
fi

# 2) Remove the worktree (--force: it has untracked .env/node_modules).
git worktree remove "$WT" --force

# 3) Clean this worktree's isolated data dir (registry + workspace SQLite files; derived from NAME, not the now-gone .env).
rm -rf "$HOME/.kith-space-$SAFE" && echo "  removed data dir ~/.kith-space-$SAFE"

echo "✅ worktree '$NAME' removed (SQLite data dir cleaned)."
echo "   Branch feature/$NAME kept — remove with: git branch -D feature/$NAME"
