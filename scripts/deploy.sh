#!/usr/bin/env bash
# Deploy MeshAgent ไปยัง DigitalOcean Droplet
# Usage:
#   LOCAL: DROPLET_HOST=1.2.3.4 DROPLET_USER=root bash scripts/deploy.sh
#   ON SERVER: bash scripts/deploy.sh  (ถ้ารันบน Droplet ตรงๆ)

set -euo pipefail

DEPLOY_DIR="/opt/meshagent"
COMPOSE_FILE="docker-compose.prod.yml"

# ถ้ามี DROPLET_HOST = deploy จาก local ผ่าน SSH
if [[ -n "${DROPLET_HOST:-}" ]]; then
  USER="${DROPLET_USER:-root}"
  echo "→ Syncing files to ${USER}@${DROPLET_HOST}:${DEPLOY_DIR}..."
  rsync -az --exclude='.git' --exclude='node_modules' --exclude='.next' \
    . "${USER}@${DROPLET_HOST}:${DEPLOY_DIR}/"
  echo "→ Running deploy on server..."
  ssh "${USER}@${DROPLET_HOST}" "cd ${DEPLOY_DIR} && bash scripts/deploy.sh"
  exit 0
fi

# รันบน server
echo "→ Building and starting services..."
cd "$DEPLOY_DIR"

[[ -f .env ]] || { echo "Error: .env not found at ${DEPLOY_DIR}/.env"; exit 1; }

source .env

# Substitute DOMAIN in nginx config
envsubst '${DOMAIN}' < nginx/meshagent.conf > /tmp/meshagent.conf.rendered
cp /tmp/meshagent.conf.rendered nginx/meshagent.conf.rendered

docker compose -f "$COMPOSE_FILE" build --parallel
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "✓ MeshAgent deployed. Running services:"
docker compose -f "$COMPOSE_FILE" ps
