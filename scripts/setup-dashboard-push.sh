#!/usr/bin/env bash
# Установщик: настраивает ежедневный push аналитики бота на дашборд.
# Запускается ОДИН раз на сервере бота. Делает всё сам: пишет env, ставит cron.
#
# Использование:
#   ./scripts/setup-dashboard-push.sh <DASHBOARD_URL> <INGEST_TOKEN>
# либо через переменные окружения:
#   DASHBOARD_URL=... DASHBOARD_INGEST_TOKEN=... ./scripts/setup-dashboard-push.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/.dashboard-push.env"

URL="${1:-${DASHBOARD_URL:-}}"
TOKEN="${2:-${DASHBOARD_INGEST_TOKEN:-}}"

# Повторный запуск: если url/токен не переданы — берём ранее сохранённые из
# .dashboard-push.env. Так апгрейд (напр. на сырьё-модель) накатывается просто
# `./scripts/setup-dashboard-push.sh` без аргументов.
if [[ -f "$ENV_FILE" ]]; then
  [[ -z "$URL" ]]   && URL="$(grep -E '^DASHBOARD_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  [[ -z "$TOKEN" ]] && TOKEN="$(grep -E '^DASHBOARD_INGEST_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi

if [[ -z "$URL" || -z "$TOKEN" ]]; then
  echo "Usage: $0 <DASHBOARD_URL> <INGEST_TOKEN>"
  echo "  напр: $0 https://dashboard.fargenia.online <token>"
  echo "  (при повторе url/токен подхватятся из .dashboard-push.env — можно без аргументов)"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node не найден в PATH" >&2
  exit 1
fi
NODE_BIN_DIR="$(dirname "$(command -v node)")"

# Соль для хеширования uid — СТАБИЛЬНАЯ: генерим один раз и переиспользуем при
# повторных запусках (иначе хеши поменяются → дедуп/история на дашборде ломаются).
SALT=""
if [[ -f "$ENV_FILE" ]]; then
  SALT="$(grep -E '^DASHBOARD_HASH_SALT=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [[ -z "$SALT" ]]; then
  SALT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

umask 077
cat > "$ENV_FILE" <<EOF
DASHBOARD_URL=$URL
DASHBOARD_INGEST_TOKEN=$TOKEN
DASHBOARD_HASH_SALT=$SALT
NODE_BIN_DIR=$NODE_BIN_DIR
EOF
chmod 600 "$ENV_FILE"

WRAPPER="$REPO/scripts/dashboard-push-cron.sh"
chmod +x "$WRAPPER"

# Cron: ежедневно 00:10 UTC (сразу после ежедневного снапшота в 00:05).
# Идемпотентно — старую строку с тем же враппером убираем.
CRON_LINE="10 0 * * * $WRAPPER >> $REPO/logs/dashboard-push.log 2>&1"
( crontab -l 2>/dev/null | grep -vF 'dashboard-push-cron.sh' ; echo "$CRON_LINE" ) | crontab -

echo "✅ Готово."
echo "   env:  $ENV_FILE (chmod 600)"
echo "   cron: ежедневно 00:10 UTC → $WRAPPER"
echo
echo "Проверить прямо сейчас:"
echo "   $WRAPPER && tail -n 5 $REPO/logs/dashboard-push.log"
