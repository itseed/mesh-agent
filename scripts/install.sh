#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "→ $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 \
  || die "docker not found. Install from https://docs.docker.com/get-docker/"

docker compose version >/dev/null 2>&1 \
  || die "'docker compose' plugin not found. Update Docker Desktop or install the compose plugin."

command -v openssl >/dev/null 2>&1 \
  || die "openssl not found. Install via your package manager (e.g. brew install openssl)."

ok "Prerequisites satisfied."
echo

# ── 2. Detect mode ───────────────────────────────────────────────────────────
PROD_MODE=false
for arg in "$@"; do
  [[ "$arg" == "--prod" || "$arg" == "-p" ]] && PROD_MODE=true
done

if $PROD_MODE; then
  COMPOSE_FILE="docker-compose.prod.yml"
  warn "Running in PRODUCTION mode (${COMPOSE_FILE})"
else
  COMPOSE_FILE="docker-compose.yml"
  info "Running in development mode (${COMPOSE_FILE})"
fi
echo

# ── 3. CLI Provider Setup ─────────────────────────────────────────────────────
echo "Which CLI providers do you want to use? (space-separated numbers)"
echo "  1) Claude Code  (claude)"
echo "  2) Gemini CLI   (gemini)"
echo "  3) Cursor       (agent)"
echo
read -r -p "Enter numbers [default: 1]: " CLI_CHOICES
CLI_CHOICES="${CLI_CHOICES:-1}"

SELECTED_CLIS=()
DEFAULT_CLI_PROVIDER=""

for choice in $CLI_CHOICES; do
  case "$choice" in
    1) SELECTED_CLIS+=("claude") ;;
    2) SELECTED_CLIS+=("gemini") ;;
    3) SELECTED_CLIS+=("cursor") ;;
    *) warn "Unknown choice: $choice — skipping" ;;
  esac
done

[[ ${#SELECTED_CLIS[@]} -eq 0 ]] && SELECTED_CLIS=("claude")
DEFAULT_CLI_PROVIDER="${SELECTED_CLIS[0]}"

for cli in "${SELECTED_CLIS[@]}"; do
  echo
  info "Setting up: $cli"

  case "$cli" in
    claude)
      if ! command -v claude >/dev/null 2>&1; then
        warn "claude not found. Install: https://claude.ai/code"
        read -r -p "Press Enter once installed, or Ctrl+C to abort..."
        command -v claude >/dev/null 2>&1 || die "claude still not found. Aborting."
      fi
      if claude whoami >/dev/null 2>&1; then
        ok "Claude: already authenticated ($(claude whoami 2>/dev/null | head -1))"
      else
        info "Claude: not logged in — starting login..."
        claude login || die "Claude login failed."
        ok "Claude: authenticated"
      fi
      ;;

    gemini)
      if ! command -v gemini >/dev/null 2>&1; then
        warn "gemini not found. Install: https://github.com/google-gemini/gemini-cli"
        read -r -p "Press Enter once installed, or Ctrl+C to abort..."
        command -v gemini >/dev/null 2>&1 || die "gemini still not found. Aborting."
      fi
      if gemini --version >/dev/null 2>&1 && gemini -p "" 2>&1 | grep -qiE "auth|login|credential|sign.in"; then
        info "Gemini: not authenticated — starting login..."
        gemini auth login || die "Gemini login failed."
        ok "Gemini: authenticated"
      else
        ok "Gemini: ready"
      fi
      ;;

    cursor)
      if ! command -v agent >/dev/null 2>&1; then
        warn "Cursor background agent ('agent' binary) not found."
        warn "Open Cursor IDE → Settings → Install 'agent' CLI tool, then press Enter."
        read -r -p "Press Enter once installed, or Ctrl+C to abort..."
        command -v agent >/dev/null 2>&1 || { warn "agent binary still not found — skipping Cursor (you can set up later)"; continue; }
      fi
      warn "Cursor auth is managed through the Cursor IDE — ensure you are signed in."
      ok "Cursor: binary found"
      ;;
  esac
done

echo
ok "CLI setup complete. Default provider: ${DEFAULT_CLI_PROVIDER}"
echo

# ── 4. Interactive prompts ────────────────────────────────────────────────────
read -r -p "Admin email [admin@example.com]: " AUTH_EMAIL
AUTH_EMAIL="${AUTH_EMAIL:-admin@example.com}"

while true; do
  read -r -s -p "Admin password (required): " AUTH_PASSWORD
  echo
  [[ -n "$AUTH_PASSWORD" ]] && break
  warn "Password cannot be empty. Try again."
done

read -r -s -p "Confirm password: " AUTH_PASSWORD_CONFIRM
echo
[[ "$AUTH_PASSWORD" == "$AUTH_PASSWORD_CONFIRM" ]] \
  || die "Passwords do not match."

DOMAIN=""
if $PROD_MODE; then
  while true; do
    read -r -p "Domain (e.g. mesh.example.com): " DOMAIN
    [[ -n "$DOMAIN" ]] && break
    warn "Domain is required for production mode."
  done
fi
echo

# ── 5. Generate secrets ───────────────────────────────────────────────────────
info "Generating secrets..."
JWT_SECRET="$(openssl rand -base64 48)"
TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"

DB_PASSWORD=""
MINIO_SECRET_KEY=""
if $PROD_MODE; then
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/')"
  MINIO_SECRET_KEY="$(openssl rand -base64 24 | tr -d '/')"
fi
ok "Secrets generated."
echo

# ── 6. Write .env ─────────────────────────────────────────────────────────────
ENV_FILE="$(pwd)/.env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists."
  read -r -p "Overwrite? [y/N]: " OVERWRITE
  [[ "${OVERWRITE,,}" == "y" ]] || die "Aborted. Existing .env kept."
fi

info "Writing ${ENV_FILE}..."

if $PROD_MODE; then
  cat > "$ENV_FILE" <<EOF
DB_USER=meshagent
DB_NAME=meshagent
DB_PASSWORD=${DB_PASSWORD}
AUTH_EMAIL=${AUTH_EMAIL}
AUTH_PASSWORD=${AUTH_PASSWORD}
JWT_SECRET=${JWT_SECRET}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
DOMAIN=${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN}
WEB_BASE_URL=https://${DOMAIN}
GITHUB_OAUTH_REDIRECT_URI=https://${DOMAIN}/api/settings/github/oauth/callback
MINIO_ACCESS_KEY=meshagent
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
MINIO_BUCKET=mesh-agent
LOG_LEVEL=info
MAX_CONCURRENT_SESSIONS=16
SESSION_IDLE_TIMEOUT_MS=3600000
CLAUDE_CMD=claude
DEFAULT_CLI_PROVIDER=${DEFAULT_CLI_PROVIDER}
GITHUB_TOKEN=
GITHUB_WEBHOOK_SECRET=
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
COOKIE_DOMAIN=
EOF
else
  cat > "$ENV_FILE" <<EOF
AUTH_EMAIL=${AUTH_EMAIL}
AUTH_PASSWORD=${AUTH_PASSWORD}
JWT_SECRET=${JWT_SECRET}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
DEFAULT_CLI_PROVIDER=${DEFAULT_CLI_PROVIDER}
EOF
fi

chmod 600 "$ENV_FILE"
ok ".env written."
echo

# ── 7. Start Docker services ──────────────────────────────────────────────────
info "Starting Docker services..."
docker compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" up -d --build
ok "Services started."
echo

# ── 8. Wait for DB ────────────────────────────────────────────────────────────
info "Waiting for database to be healthy..."
DB_USER_CHECK="meshagent"
$PROD_MODE && DB_USER_CHECK="${DB_USER:-meshagent}"

READY=false
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "$DB_USER_CHECK" -q 2>/dev/null; then
    READY=true
    break
  fi
  sleep 2
done

$READY || die "Database did not become healthy within 60 seconds. Check: docker compose -f ${COMPOSE_FILE} logs db"
ok "Database is ready."
echo

# ── 9. Run migrations ─────────────────────────────────────────────────────────
info "Running DB migrations..."
docker compose -f "$COMPOSE_FILE" exec -T api sh -c "cd /app/packages/shared && pnpm run db:migrate"
ok "Migrations complete."
echo

# ── 10. Success ───────────────────────────────────────────────────────────────
if $PROD_MODE; then
  APP_URL="https://${DOMAIN}"
else
  APP_URL="http://localhost:4800"
fi

echo -e "${GREEN}"
echo "✓ MeshAgent is ready!"
echo -e "${NC}"
echo "  URL:      ${APP_URL}"
echo "  Email:    ${AUTH_EMAIL}"
echo "  Password: ${AUTH_PASSWORD}"
echo
echo "Run 'docker compose -f ${COMPOSE_FILE} logs -f' to follow logs."
