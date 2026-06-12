#!/usr/bin/env bash
# Cloud-routine setup script — runs once before each scheduled session.
# The factory scripts use Node built-ins + global fetch; generated actors install
# their own deps via new-actor.mjs. So setup only needs the Apify CLI logged in.
set -euo pipefail

if [ -z "${APIFY_TOKEN:-}" ]; then
  echo "FATAL: APIFY_TOKEN env var is not set — configure it in the routine's environment." >&2
  exit 1
fi

# Pre-warm + log in the Apify CLI from the token (writes ~/.apify/auth.json, which the
# factory's API scripts also read). npx fetches apify-cli on first use.
npx -y apify-cli login -t "$APIFY_TOKEN"
npx -y apify-cli info | grep -i "logged in" || { echo "FATAL: apify login failed" >&2; exit 1; }

echo "Cloud factory setup complete: Apify CLI logged in. Factory ready."
