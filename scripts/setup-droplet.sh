#!/usr/bin/env bash
# ติดตั้ง Docker, pnpm, และ Claude Code CLI บน Ubuntu 22.04 Droplet ใหม่
# รันบน Droplet: bash <(curl -fsSL https://raw.githubusercontent.com/your-repo/meshagent/main/scripts/setup-droplet.sh)

set -euo pipefail

echo "→ Updating system..."
apt-get update -q && apt-get upgrade -yq

echo "→ Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "→ Installing Docker Compose plugin..."
apt-get install -yq docker-compose-plugin

echo "→ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -yq nodejs

echo "→ Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

echo "→ Creating deploy directory..."
mkdir -p /opt/meshagent
chown "$USER":"$USER" /opt/meshagent

echo ""
echo "✓ Setup complete. Next steps:"
echo "  1. Copy project files to /opt/meshagent"
echo "  2. Copy .env.production.example → /opt/meshagent/.env and fill in values"
echo "  3. Run: cd /opt/meshagent && bash scripts/deploy.sh"
