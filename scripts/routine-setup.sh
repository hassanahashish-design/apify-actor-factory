#!/usr/bin/env bash
# Cloud-routine setup script — runs once before each scheduled session.
# Installs factory deps and logs in the Apify CLI from the APIFY_TOKEN env var.
set -euo pipefail

if [ -z "${APIFY_TOKEN:-}" ]; then
  echo "FATAL: APIFY_TOKEN env var is not set — configure it in the routine's environment." >&2
  exit 1
fi

cd "$(dirname "$0")/.."          # actor-factory/
npm install --no-audit --no-fund --silent

# apify CLI reads ~/.apify/auth.json; log in from the token so push + API scripts work.
npx -y apify-cli login -t "$APIFY_TOKEN" >/dev/null 2>&1
npx -y apify-cli info | grep -i "logged in" || { echo "FATAL: apify login failed" >&2; exit 1; }

echo "Cloud factory setup complete: deps installed, apify logged in."
