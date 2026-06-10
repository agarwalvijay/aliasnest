#!/usr/bin/env bash
# Redeploy AliasNest from GitHub. Run this ON THE SERVER.
#
#   ./deploy/redeploy.sh            # deploy origin/main
#   ./deploy/redeploy.sh some-branch
#
# Pulls the latest code, reinstalls deps, rebuilds the web bundle, and
# restarts the API under pm2. .env, the SQLite DB, and stored messages live
# in gitignored paths, so they are left untouched.
set -euo pipefail

APP_DIR="/home/vagarwal/aliasnest"
BRANCH="${1:-main}"

cd "$APP_DIR"

echo "==> Syncing to origin/$BRANCH"
git fetch origin "$BRANCH"
# Hard reset so the deploy box always matches GitHub exactly (no merge surprises).
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing Python dependencies"
.venv/bin/pip install -q -r requirements.txt

echo "==> Building web frontend"
( cd web && npm ci && npm run build )

echo "==> Restarting API (pm2)"
pm2 restart aliasnest-api --update-env

echo "==> Deploy complete:"
pm2 status aliasnest-api
