#!/usr/bin/env bash
# Deploy Flux to the shared ICCA EC2 box (flux.foodverse.io).
#
# The box also serves live.iccadubai.ae and other foodverse.io sites —
# this script only touches /var/www/flux and the "flux" pm2 app. It never
# restarts nginx and never edits other vhosts.
#
# Server env lives in /var/www/flux/.env (never synced from here; edit it
# on the box if credentials change).
set -euo pipefail

PEM="${FLUX_DEPLOY_PEM:-$HOME/Downloads/fv-emailer-dashboard/test.pem}"
HOST="ec2-user@ec2-13-214-253-169.ap-southeast-1.compute.amazonaws.com"
REMOTE_DIR="/var/www/flux"
SSH="ssh -i $PEM -o StrictHostKeyChecking=no"

if [[ ! -f "$PEM" ]]; then
  echo "SSH key not found: $PEM (set FLUX_DEPLOY_PEM)" >&2
  exit 1
fi

echo "=== syncing source ==="
rsync -az --delete \
  -e "$SSH" \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude ".env*" \
  --exclude e2e/.auth \
  --exclude test-results \
  --exclude playwright-report \
  --exclude .prisma \
  --exclude "*.tsbuildinfo" \
  "$(dirname "$0")/" \
  "$HOST:$REMOTE_DIR/"

echo "=== installing, migrating & building ==="
# npm install (not ci): the lockfile drifts on linux-only optional deps.
$SSH "$HOST" "set -e && cd $REMOTE_DIR \
  && npm install --no-audit --no-fund \
  && npx prisma migrate deploy \
  && npm run build"

echo "=== assembling standalone & restarting ==="
# Next standalone doesn't include static assets, public/, or dotenv files —
# copy them in, then restart only the flux pm2 app.
$SSH "$HOST" "set -e && cd $REMOTE_DIR \
  && rm -rf .next/standalone/.next/static .next/standalone/public \
  && cp -r .next/static .next/standalone/.next/static \
  && cp -r public .next/standalone/public \
  && cp .env .next/standalone/.env \
  && (pm2 restart flux --update-env \
      || (cd .next/standalone && PORT=3200 HOSTNAME=127.0.0.1 pm2 start server.js --name flux)) \
  && pm2 save"

echo "=== health check ==="
sleep 3
code=$($SSH "$HOST" "curl -s -o /dev/null -w '%{http_code}' https://flux.foodverse.io/login")
echo "https://flux.foodverse.io/login -> $code"
[[ "$code" == "200" ]] || { echo "health check FAILED" >&2; exit 1; }

echo "=== deployed ==="
