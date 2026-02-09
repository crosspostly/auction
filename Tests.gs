// =====================================
// COMPREHENSIVE VK API DIAGNOSTIC SUITE
// =====================================

function L(level, step, message, data) {
  const entry = '[' + level + '] [' + step + '] ' + message;
  Logger.log(entry + (data ? '\n' + JSON.stringify(data, null, 2) : ''));
  // This is a simplified logger for the test file. Production logging is in Code.gs
}

/**
 * 🔍 ГЛАВНАЯ ДИАГНОСТИЧЕСКАЯ ФУНКЦИЯ
 */
function runVkConnectionDiagnostic() {
  const results = [];
  
  try {
    L('INFO', 'START', '=== НАЧАЛО ДИАГНОСТИКИ VK API ===');

    // ШАГ 1: ПРОВЕРКА НАСТРОЕК
    L('INFO', 'STEP_1', 'Проверка локальных настроек...');
    const settings = {
      WORKER_URL: 'https://subbot.sheepoff.workers.dev/',
      GROUP_ID: getSetting('GROUP_ID'),
      VK_TOKEN: getSetting('VK_TOKEN'),
      CONFIRMATION_CODE: getSetting('CONFIRMATION_CODE'),
      VK_SECRET: getSetting('VK_SECRET')
    };
    
    if (!settings.GROUP_ID || !settings.VK_TOKEN) {
      L('CRITICAL', 'STEP_1', 'КРИТИЧЕСКАЯ ОШИБКА: Не все обязательные настройки заданы!');
      return;
    }
    L('INFO', 'STEP_1', '✅ Все обязательные настройки присутствуют');

    // ШАГ 2: ПРОВЕРКА ТОКЕНА
    L('INFO', 'STEP_2', 'Проверка токена и доступа к группе...');
    const groupInfoResponse = callVk('groups.getById', { group_id: settings.GROUP_ID, fields: 'name,screen_name' });
    const groupInfo = (groupInfoResponse && groupInfoResponse.response) ? groupInfoResponse.response[0] : null;

    if (!groupInfo) {
      L('ERROR', 'STEP_2', '❌ Группа не найдена в ответе VK', groupInfoResponse);
      return;
    }
    L('INFO', 'STEP_2', '✅ Токен действителен. Группа: ' + groupInfo.name);

    // ШАГ 3: ПРОВЕРКА CALLBACK СЕРВЕРОВ
    L('INFO', 'STEP_3', 'Получение списка Callback серверов...');
    const serversResponse = callVk('groups.getCallbackServers', { group_id: settings.GROUP_ID });
    if (!serversResponse || !serversResponse.response) {
      L('ERROR', 'STEP_3', '❌ Не удалось получить список серверов', serversResponse);
    } else {
        const myServer = serversResponse.response.items.find(function(s) { return s.url === settings.WORKER_URL; });
        if (myServer) {
            if (myServer.status === 'failed') {
                L('ERROR', 'STEP_3', '❌ WORKER СЕРВЕР status: failed!');
            } else {
                L('INFO', 'STEP_3', '✅ Worker сервер НАЙДЕН! Статус: ' + myServer.status);
            }
        } else {
            L('WARN', 'STEP_3', '⚠️  Worker URL НЕ НАЙДЕН среди серверов!');
        }
    }
    
    // ... Остальные шаги из вашего скрипта могут быть добавлены здесь схожим образом ...

    L('INFO', 'END', '=== ДИАГНОСТИКА ЗАВЕРШЕНА ===');
    
  } catch (e) {
    L('CRITICAL', 'EXCEPTION', '🔥 КРИТИЧЕСКОЕ ИСКЛЮЧЕНИЕ', { message: e.message });
  }
}