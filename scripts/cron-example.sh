#!/usr/bin/env bash
# Ilmainen ajastus omalla koneella tai VPS:llä. Ei erillistä SaaS-maksua.
# crontab -e
# 0 9 * * 1-5 /polku/repo/outreach/scripts/cron-example.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env && set +a
CSV="${CSV_PATH:-$ROOT/yritykset.csv}"
OUT="${OUT_DIR:-$ROOT/out}"
node src/cli.mjs --csv "$CSV" --out "$OUT" --delay-ms "${DELAY_MS:-2000}" ${SEND:+--send}
