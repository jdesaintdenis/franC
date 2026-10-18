#!/usr/bin/env bash
# Idempotent environment setup: DB up, install, migrate, seed.
# Safe to run repeatedly. Never requires interactive input.
set -uo pipefail

cd "$(dirname "$0")/.."

log() { printf '\n==> %s\n' "$1"; }

log "Checking prerequisites"
command -v node >/dev/null || { echo "node is required (see .nvmrc)"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required (see package.json#packageManager)"; exit 1; }

if [ ! -f .env.local ]; then
  log "Creating .env.local from .env.example"
  cp .env.example .env.local
else
  log ".env.local already exists, leaving it as-is"
fi

# Idempotent: only append/generate BETTER_AUTH_SECRET if it's missing or empty.
if ! grep -qE '^BETTER_AUTH_SECRET=.+' .env.local; then
  log "Generating BETTER_AUTH_SECRET"
  sed -i.bak '/^BETTER_AUTH_SECRET=/d' .env.local && rm -f .env.local.bak
  if command -v openssl >/dev/null; then
    SECRET=$(openssl rand -base64 32)
  else
    SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  fi
  printf 'BETTER_AUTH_SECRET=%s\n' "$SECRET" >> .env.local
fi

# Idempotent: local VAPID keys (import-reminder push) and the cron secret, only when missing.
# Uses node's crypto so no dependency has to be installed yet.
if ! grep -qE '^VAPID_PUBLIC_KEY=.+' .env.local || ! grep -qE '^VAPID_PRIVATE_KEY=.+' .env.local; then
  log "Generating local VAPID keys"
  sed -i.bak -e '/^VAPID_PUBLIC_KEY=/d' -e '/^VAPID_PRIVATE_KEY=/d' .env.local && rm -f .env.local.bak
  node -e "
    const { generateKeyPairSync } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pub = publicKey.export({ format: 'jwk' });
    const priv = privateKey.export({ format: 'jwk' });
    const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
    console.log('VAPID_PUBLIC_KEY=' + publicRaw.toString('base64url'));
    console.log('VAPID_PRIVATE_KEY=' + priv.d);
  " >> .env.local
fi
if ! grep -qE '^VAPID_SUBJECT=.+' .env.local; then
  sed -i.bak '/^VAPID_SUBJECT=/d' .env.local && rm -f .env.local.bak
  printf 'VAPID_SUBJECT=mailto:owner@example.com\n' >> .env.local
fi
if ! grep -qE '^CRON_SECRET=.+' .env.local; then
  log "Generating CRON_SECRET"
  sed -i.bak '/^CRON_SECRET=/d' .env.local && rm -f .env.local.bak
  printf 'CRON_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" >> .env.local
fi

# shellcheck disable=SC1091
set -a
source .env.local
set +a

log "Installing dependencies"
pnpm install --frozen-lockfile || pnpm install

DOCKER_OK=0
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  DOCKER_OK=1
fi

if [ "$DOCKER_OK" = "1" ]; then
  log "Starting Postgres via Docker Compose"
  if docker compose up -d db; then
    log "Waiting for Postgres to become healthy"
    tries=0
    until [ "$(docker compose ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ]; do
      tries=$((tries + 1))
      if [ "$tries" -gt 60 ]; then
        echo "Postgres did not become healthy in time; continuing anyway."
        break
      fi
      sleep 1
    done
  else
    echo "docker compose up failed; falling back to DATABASE_URL as-is."
    DOCKER_OK=0
  fi
else
  log "Docker not available or not running — falling back to DATABASE_URL"
  echo "Make sure DATABASE_URL in .env.local points to a reachable Postgres instance."
fi

log "Running migrations"
if ! pnpm db:migrate; then
  echo "Migrations failed. If Postgres isn't reachable yet, fix DATABASE_URL and re-run: pnpm setup"
  exit 1
fi
if ! pnpm db:migrate:test; then
  echo "Test database migrations failed. Fix DATABASE_URL_TEST and re-run: pnpm setup"
  exit 1
fi

log "Seeding defaults"
echo "No global seed needed — each user's default account and categories are provisioned automatically when they sign up."

log "Setup complete"
cat <<'EOF'

Next steps:
  pnpm dev        # start the app on http://localhost:3000
  pnpm db:studio  # browse the database
  pnpm test       # run unit tests

EOF
