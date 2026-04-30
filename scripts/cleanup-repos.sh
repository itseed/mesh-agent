#!/usr/bin/env bash
# Cleanup repos older than DAYS_UNUSED days (default 30)
# Usage: ./cleanup-repos.sh [days]
set -euo pipefail

REPOS_DIR="${REPOS_BASE_DIR:-/repos}"
DAYS="${1:-30}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"

echo "[cleanup-repos] Scanning $REPOS_DIR (unused > ${DAYS} days)..."

if [ ! -d "$REPOS_DIR" ]; then
  echo "[cleanup-repos] Directory not found: $REPOS_DIR — skipping"
  exit 0
fi

freed=0
count=0

for repo in "$REPOS_DIR"/*/; do
  [ -d "$repo" ] || continue
  # Check last access time (atime) of HEAD file as proxy for last use
  head_file="$repo/HEAD"
  [ -f "$head_file" ] || head_file="$repo/.git/HEAD"
  [ -f "$head_file" ] || continue

  days_old=$(( ( $(date +%s) - $(stat -c %Y "$head_file" 2>/dev/null || stat -f %m "$head_file") ) / 86400 ))
  if [ "$days_old" -ge "$DAYS" ]; then
    size=$(du -sm "$repo" 2>/dev/null | cut -f1 || echo 0)
    echo "[cleanup-repos] Removing $repo (unused ${days_old}d, ${size}MB)"
    rm -rf "$repo"
    freed=$((freed + size))
    count=$((count + 1))
  fi
done

echo "[cleanup-repos] Done — removed $count repos, freed ~${freed}MB"
