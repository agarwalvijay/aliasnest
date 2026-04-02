#!/usr/bin/env bash
set -euo pipefail

cd /home/vagarwal/aliasnest

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec /home/vagarwal/aliasnest/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
