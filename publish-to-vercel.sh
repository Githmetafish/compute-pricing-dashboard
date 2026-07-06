#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm first."
  exit 1
fi

npm run validate:data

if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  npx vercel@latest --prod --token "$VERCEL_TOKEN"
else
  npx vercel@latest --prod
fi
