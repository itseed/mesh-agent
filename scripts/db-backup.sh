#!/usr/bin/env bash
# Run a daily PostgreSQL backup of the meshagent database.
#
# Usage:
#   ./scripts/db-backup.sh [destination-dir]
#
# Defaults destination to /var/backups/meshagent, keeps the last 14 backups,
# and reads connection info from .env / .env.production. Designed to be
# scheduled via cron, e.g.:
#
#   0 3 * * * /opt/mesh-agent/scripts/db-backup.sh >>/var/log/meshagent-backup.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/var/backups/meshagent}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE_FILE="${ROOT}/docker-compose.prod.yml"
SERVICE="${BACKUP_DB_SERVICE:-db}"

mkdir -p "${DEST}"

# Pull DB user/name from environment if available
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

DB_USER="${DB_USER:-meshagent}"
DB_NAME="${DB_NAME:-meshagent}"

OUT="${DEST}/meshagent-${TIMESTAMP}.sql.gz"

echo "[$(date -u +%FT%TZ)] Starting backup → ${OUT}"
if command -v docker >/dev/null 2>&1 && [[ -f "${COMPOSE_FILE}" ]]; then
  docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE}" \
    pg_dump --clean --if-exists --no-owner -U "${DB_USER}" -d "${DB_NAME}" \
    | gzip -9 > "${OUT}"
else
  pg_dump --clean --if-exists --no-owner -U "${DB_USER}" -d "${DB_NAME}" \
    | gzip -9 > "${OUT}"
fi

# Permissions: owner-readable only (contains user data, password hashes, encrypted tokens)
chmod 600 "${OUT}"

# Prune old backups
find "${DEST}" -name 'meshagent-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

SIZE=$(du -h "${OUT}" | cut -f1)
COUNT=$(find "${DEST}" -name 'meshagent-*.sql.gz' | wc -l | tr -d ' ')
echo "[$(date -u +%FT%TZ)] Backup complete (${SIZE}). Retained: ${COUNT} files."
