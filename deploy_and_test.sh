#!/bin/bash
set -euo pipefail

# ================================
#  CONFIG
# ================================
# Можно переопределить через переменные окружения.
WEB_APP_URL="${WEB_APP_URL:-https://script.google.com/macros/s/AKfycbz5QY9W2VUdF_xdafv_DH6yDpdPEN1zsEUF6wSEqOQvwueBgMWWAsze4fmNRFEJkryY/exec}"
SECRET="${VK_SECRET:-5f574d3f-2f39-4f}"

# Максимальное число попыток в одном запуске скрипта
MAX_ITERATIONS="${MAX_ITERATIONS:-1}"

# Директория для артефактов (логи, ответы тестов)
ARTIFACTS_DIR="${ARTIFACTS_DIR:-./artifacts}"
mkdir -p "$ARTIFACTS_DIR"

echo "🚀 Starting Deployment & Test Cycle..."
echo "WEB_APP_URL: $WEB_APP_URL"
echo "SECRET: [hidden]"
echo "MAX_ITERATIONS: $MAX_ITERATIONS"
echo "ARTIFACTS_DIR: $ARTIFACTS_DIR"
echo "----------------------------------------"

# ================================
#  HELPERS
# ================================

# Безопасный выход с сообщением
fail() {
  echo "❌ $1"
  exit 1
}

# Извлечение DEPLOYMENT_ID из WEB_APP_URL
# Ожидаемый формат: https://script.google.com/macros/s/DEPLOYMENT_ID/exec
extract_deployment_id() {
  local url="$1"
  # sed вытащит всё между `/s/` и `/exec`
  local id
  id=$(echo "$url" | sed -n 's|.*/s/\([^/]*\)/exec|\1|p' || true)
  echo "$id"
}

# Обновление деплоя (если есть DEPLOYMENT_ID)
update_deployment() {
  local deployment_id="$1"

  if [[ -z "$deployment_id" ]]; then
    echo "⚠️  Could not extract Deployment ID from WEB_APP_URL. Skipping deployment update."
    echo "   The test will run against the EXISTING deployed version."
    return 0
  fi

  echo "1.5. Updating Deployment ($deployment_id) to latest version..."

  # Вариант 1: классический clasp deploy -i
  # npx @google/clasp deploy -i "$deployment_id" --description "Auto-deploy via CI/CD"

  # Вариант 2: более явная команда (если используете свежий clasp)
  npx @google/clasp deploy -i "$deployment_id" --description "Auto-deploy via CI/CD"

  if [[ $? -ne 0 ]]; then
    echo "⚠️  Deployment update failed. Proceeding with existing version..."
  else
    echo "✅ Deployment updated to latest version."
  fi
}

# Сбор логов Google Apps Script через clasp
collect_gas_logs() {
  local out_file="$1"
  echo "📝 Collecting GAS logs into: $out_file"

  # --json выдаёт структурированный лог; --max 50 – последние 50 записей
  # Если logs упадут, не ломаем основной сценарий
  if npx @google/clasp logs --json --max 50 > "$out_file" 2>/dev/null; then
    echo "✅ GAS logs collected."
  else
    echo "⚠️  Failed to collect GAS logs via clasp."
  fi
}

# ================================
#  MAIN LOOP
# ================================

DEPLOYMENT_ID="$(extract_deployment_id "$WEB_APP_URL")"

for ((ITER=1; ITER<=MAX_ITERATIONS; ITER++)); do
  echo ""
  echo "========================================"
  echo "🔁 ITERATION $ITER / $MAX_ITERATIONS"
  echo "========================================"

  # 1. Пушим код в GAS
  echo "1. Pushing code to Google Apps Script..."
  if ! npx @google/clasp push -f; then
    fail "Push failed! Stopping tests."
  fi
  echo "✅ Code pushed."

  # 1.5 Обновляем деплой (если получилось вытащить ID)
  update_deployment "$DEPLOYMENT_ID"

  # 2. Запуск интеграционных тестов
  echo "2. Running Full Cycle Simulation on the deployed script..."
  echo "   URL: $WEB_APP_URL"
  echo "   Action: run_tests"

  # Вытаскиваем ответ
  TEST_RESPONSE_FILE="$ARTIFACTS_DIR/test-response-iter-${ITER}.json"
  RAW_RESPONSE=$(curl -s -L "${WEB_APP_URL}?action=run_tests&secret=${SECRET}" || true)

  echo "---------------------------------------------------"
  # Сохраняем “как есть” для дальнейшего анализа Gemini
  echo "$RAW_RESPONSE" > "$TEST_RESPONSE_FILE"
  echo "Raw response saved to: $TEST_RESPONSE_FILE"

  # Проверка на HTML (скорее всего, проблема с доступом)
  if [[ "$RAW_RESPONSE" == *"<html"* ]] || [[ "$RAW_RESPONSE" == *"<!DOCTYPE html"* ]]; then
    echo "❌ ERROR: Received HTML response. Web App is likely not accessible anonymously."
    echo "   Check 'DEPLOYMENT.md' section '⚠️ Важно: Доступ \"Все\" (Anyone)'."
    echo "   Response snippet:"
    echo "---------------------------------------------------"
    echo "${RAW_RESPONSE:0:500}"
    echo "---------------------------------------------------"
    # Собираем логи и выходим с ошибкой для внешнего агента
    collect_gas_logs "$ARTIFACTS_DIR/gas-logs-iter-${ITER}.json"
    fail "HTML response from Web App."
  fi

  echo "Response:"
  echo "$RAW_RESPONSE"
  echo "---------------------------------------------------"

  # 3. Попытка разобрать ответ как JSON со статусом
  # Предполагаемый формат:
  # { "status": "ok" | "fail", "summary": "...", "errors": [ ... ] }
  STATUS="unknown"
  if command -v jq >/dev/null 2>&1; then
    # Пытаемся прочитать поле status
    STATUS=$(echo "$RAW_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
  fi

  # Если нет jq или статус неизвестен — оставляем старую текстовую проверку
  if [[ "$STATUS" == "ok" ]]; then
    echo "🎉 SUCCESS: All tests passed! (status=ok)"
    exit 0
  fi

  if [[ "$STATUS" == "fail" ]]; then
    echo "❌ FAILURE: Tests failed. (status=fail)"
  else
    echo "ℹ️ Could not determine status from JSON; falling back to text check."
    if [[ "$RAW_RESPONSE" == *"✅ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО"* ]]; then
      echo "🎉 SUCCESS: All tests passed! (text marker)"
      exit 0
    else
      echo "❌ FAILURE: Tests did not include success marker."
    fi
  fi

  # 4. Сбор логов для анализа ИИ
  LOG_FILE="$ARTIFACTS_DIR/gas-logs-iter-${ITER}.json"
  collect_gas_logs "$LOG_FILE"

  echo "❌ Tests failed on iteration $ITER."
  echo "   - Test response: $TEST_RESPONSE_FILE"
  echo "   - GAS logs:      $LOG_FILE"
  echo "🧠 Next step (outside this script): Gemini should read these artifacts,"
  echo "   modify the GAS project code, commit/push changes, and rerun this script."

  # Если хотим несколько попыток внутри одного запуска — продолжаем цикл.
  # Но по умолчанию (MAX_ITERATIONS=1) выходим с ошибкой.
  if (( ITER == MAX_ITERATIONS )); then
    fail "Reached MAX_ITERATIONS ($MAX_ITERATIONS) without passing tests."
  fi

done