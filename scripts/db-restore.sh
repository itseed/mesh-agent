#!/usr/bin/env bash
# Restore a meshagent backup. Usage:
#   ./scripts/db-restore.sh <path/to/backup.sql.gz>

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP="${1:?Usage: $0 <path/to/backup.sql.gz>}"
COMPOSE_FILE="${ROOT}/docker-compose.prod.yml"
SERVICE="${BACKUP_DB_SERVICE:-postgres}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

DB_USER="${DB_USER:-meshagent}"
DB_NAME="${DB_NAME:-meshagent}"

[[ -f "${BACKUP}" ]] || { echo "Backup not found: ${BACKUP}" >&2; exit 1; }

echo "Restoring ${BACKUP} → database ${DB_NAME}"
read -r -p "This will overwrite the current database. Continue? [yes/NO] " confirm
[[ "${confirm}" == "yes" ]] || { echo "Aborted."; exit 1; }

if command -v docker >/dev/null 2>&1 && [[ -f "${COMPOSE_FILE}" ]]; then
  gunzip -c "${BACKUP}" | docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE}" \
    psql -U "${DB_USER}" -d "${DB_NAME}"
else
  gunzip -c "${BACKUP}" | psql -U "${DB_USER}" -d "${DB_NAME}"
fi

echo "Restore complete."
