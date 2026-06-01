#!/usr/bin/env bash
# Враппер для cron: пушит аналитику бота на дашборд.
# Сам определяет корень репозитория, подхватывает env и PATH (в cron он урезан).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if [[ ! -f "$REPO/.dashboard-push.env" ]]; then
  echo "[$(date -u +%FT%TZ)] нет .dashboard-push.env — запусти scripts/setup-dashboard-push.sh" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$REPO/.dashboard-push.env"
set +a

# В cron PATH урезан — добавляем каталог node.
export PATH="${NODE_BIN_DIR:-}:$PATH"

mkdir -p "$REPO/logs"
echo "[$(date -u +%FT%TZ)] push start"
npm run push-raw
echo "[$(date -u +%FT%TZ)] push done"
