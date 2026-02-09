const API_VERSION = '5.199';
const CACHE_TTL_SECONDS = 21600;
const OUTBID_MESSAGE = 'Ваша ставка перебита';
const LOT_NOT_SOLD_MESSAGE = 'Лот не продан';

function onOpen() {
  createMenu();
}

function createMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('VK Auction')
    .addItem('Настройка авторизации (VK)', 'setupAuthorization')
    .addItem('Создать/Обновить листы', 'createOrUpdateSheets')
    .addItem('Проверить соединение', 'checkConnection')
    .addItem('Очистить кэш', 'refreshCache')
    .addSeparator()
    .addItem('Запустить очередь', 'runQueue')
    .addItem('Завершить активные лоты', 'finalizeNow')
    .addItem('Статус', 'showStatus')
    .addSeparator()
    .addItem('Настроить триггеры', 'setupTriggers')
    .addItem('Запустить тесты', 'runAllTests')
    .addItem('🔬 Тест VK API', 'testVkApiConnection')
    .addToUi();
}

function setupAuthorization() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'ИНСТРУКЦИЯ:\n' +
      '1. Перейдите на https://vkhost.github.io\n' +
      '2. Выберите "VK Admin"\n' +
      '3. Разрешите доступ к messages, wall, groups\n' +
      '4. Скопируйте access_token из адресной строки.'
  );
  
  // Чувствительные настройки (оплаты/доставки/админов) сохраняются в PropertiesService.
  const settings = {
    VK_TOKEN: promptSetting(ui, 'VK_TOKEN', 'Введите VK_TOKEN'),
    GROUP_ID: promptSetting(ui, 'GROUP_ID', 'Введите GROUP_ID (число без минуса)'),
    CONFIRMATION_STRING: promptSetting(ui, 'CONFIRMATION_STRING', 'Введите CONFIRMATION_STRING для Callback API'),
    VK_SECRET: promptSetting(ui, 'VK_SECRET', 'Введите VK_SECRET (secret key из Callback API)'),
    PAYMENT_PHONE: promptSetting(ui, 'PAYMENT_PHONE', 'Телефон для оплаты (СБП)'),
    PAYMENT_BANK: promptSetting(ui, 'PAYMENT_BANK', 'Банк для оплаты'),
    DELIVERY_RULES: promptSetting(ui, 'DELIVERY_RULES', 'Стоимость доставки (например, 1-3:300, 4-6:500, 7+:0)'),
    ADMIN_IDS: promptSetting(ui, 'ADMIN_IDS', 'ID администраторов через запятую (для отчетов)')
  };
  
  setSettings(settings);
  ui.alert('Настройки сохранены в PropertiesService.');
}

function promptSetting(ui, key, message) {
  const current = getSetting(key);
  const response = ui.prompt(message + (current ? ' (текущее: ' + current + ')' : ''), ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) {
    return current;
  }
  return response.getResponseText().trim();
}

function createOrUpdateSheets() {
  ensureAllSheets();
  SpreadsheetApp.getUi().alert('Листы созданы/обновлены. Проверьте лист Settings.');
}

function checkConnection() {
  const groupId = getSetting('GROUP_ID');
  if (!groupId) {
    SpreadsheetApp.getUi().alert('GROUP_ID не настроен.');
    return;
  }
  const response = callVk('groups.getById', { group_id: groupId });
  if (response && response.response && response.response.length) {
    SpreadsheetApp.getUi().alert('Соединение установлено: ' + response.response[0].name);
  } else {
    SpreadsheetApp.getUi().alert('Не удалось проверить соединение.');
  }
}

function refreshCache() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('CACHE_SALT', String(new Date().getTime()));
  SpreadsheetApp.getUi().alert('Кэш событий очищен.');
}

function runQueue() {
  processQueue();
}

function finalizeNow() {
  finalizeExpiredLots(true);
}

function showStatus() {
  const status = buildStatus();
  SpreadsheetApp.getUi().alert(status);
}

function setupTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Clear existing triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  // Queue processor
  ScriptApp.newTrigger('processQueue')
    .timeBased()
    .everyMinutes(1)
    .create();
    
  // Health check
  ScriptApp.newTrigger('healthCheck')
    .timeBased()
    .everyHours(1)
    .create();
    
  SpreadsheetApp.getUi().alert('Триггеры настроены (каждую минуту обработка очереди, каждый час health-check).');
}

function healthCheck() {
  try {
    const groupId = getSetting('GROUP_ID');
    if (!groupId) return;
    const response = callVk('groups.getById', { group_id: groupId });
    if (response && response.response) {
      logInfo('Health Check: OK');
    } else {
      logError('Health Check', 'Failed to connect to VK', response);
    }
  } catch (e) {
    logError('Health Check', e);
  }
}

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ doPost
function doPost(e) {
  try {
    // Логируем сырой запрос для диагностики
    if (!e || !e.postData || !e.postData.contents) {
      logError('doPost', 'Empty request', 'No payload received');
      return ContentService.createTextOutput('ok')
        .setMimeType(ContentService.MimeType.TEXT);  // ✅ Добавлен setMimeType
    }
    
    const payload = JSON.parse(e.postData.contents);
    
    // ✅ Логируем ВСЕ входящие события
    logInfo('doPost received', { 
      type: payload.type, 
      event_id: payload.event_id || 'no_id',
      group_id: payload.group_id
    });
    
    // ✅ Обработка confirmation с setMimeType
    if (payload.type === 'confirmation') {
      const confirmation = getSetting('CONFIRMATION_STRING');
      
      if (!confirmation) {
        logError('doPost', 'CONFIRMATION_STRING not set', payload.group_id);
        return ContentService.createTextOutput('')
          .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType
      }
      
      logInfo('Returning confirmation', { 
        code: confirmation.substring(0, 10) + '...',
        group_id: payload.group_id
      });
      
      return ContentService.createTextOutput(String(confirmation).trim())
        .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType
    }

    // ✅ Проверка secret
    const secret = getSetting('VK_SECRET');
    if (secret && payload.secret !== secret) {
      logError('doPost', 'Secret mismatch', { 
        expected_prefix: secret.substring(0, 3) + '...', 
        received_prefix: payload.secret ? payload.secret.substring(0, 3) + '...' : 'none',
        type: payload.type
      });
      return ContentService.createTextOutput('ok')
        .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType
    }

    // ✅ Проверка дубликатов (не блокирует при ошибках)
    if (isDuplicateEvent(payload)) {
      logInfo('Duplicate event skipped', { 
        type: payload.type, 
        event_id: payload.event_id 
      });
      return ContentService.createTextOutput('ok')
        .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType
    }

    // Добавляем в очередь
    enqueueEvent(payload);
    logInfo('Event enqueued', { 
      type: payload.type, 
      event_id: payload.event_id || buildEventId(payload) 
    });
    
    return ContentService.createTextOutput('ok')
      .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType
      
  } catch (error) {
    logError('doPost Exception', error.message || String(error), 
      e && e.postData ? e.postData.contents.substring(0, 200) : 'no payload');
    
    return ContentService.createTextOutput('ok')
      .setMimeType(ContentService.MimeType.TEXT);  // ✅ setMimeType даже при ошибке
  }
}

// ✅ НОВАЯ ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ
function testVkApiConnection() {
  const ui = SpreadsheetApp.getUi();
  const results = [];
  
  try {
    // Тест 1: Получение информации о группе
    const groupId = getSetting('GROUP_ID');
    if (!groupId) {
      ui.alert('❌ GROUP_ID не настроен');
      return;
    }
    
    const groupInfo = callVk('groups.getById', { group_id: groupId });
    if (groupInfo && groupInfo.response) {
      results.push('✅ Группа: ' + groupInfo.response[0].name);
    } else if (groupInfo && groupInfo.error) {
      results.push('❌ Ошибка группы: ' + groupInfo.error.error_msg);
    } else {
      results.push('❌ Нет ответа от VK API');
    }
    
    // Тест 2: Проверка callback серверов
    const servers = callVk('groups.getCallbackServers', { group_id: groupId });
    if (servers && servers.response) {
      results.push('📡 Серверов: ' + servers.response.count);
      if (servers.response.items && servers.response.items.length > 0) {
        results.push('  URL: ' + servers.response.items[0].url);
        results.push('  Статус: ' + servers.response.items[0].status);
      }
    }
    
    // Тест 3: Проверка confirmation code
    const confirmation = getSetting('CONFIRMATION_STRING');
    if (confirmation) {
      results.push('✅ Confirmation code: ' + confirmation.substring(0, 10) + '...');
    } else {
      results.push('⚠️ CONFIRMATION_STRING не настроен');
    }
    
    // Тест 4: Проверка secret
    const secret = getSetting('VK_SECRET');
    if (secret) {
      results.push('✅ Secret key: ' + secret.substring(0, 5) + '...');
    } else {
      results.push('⚠️ VK_SECRET не настроен');
    }
    
    // Тест 5: Симуляция входящего события
    const testPayload = {
      type: 'confirmation',
      group_id: Number(groupId)
    };
    
    const mockRequest = {
      postData: {
        contents: JSON.stringify(testPayload)
      }
    };
    
    const response = doPost(mockRequest);
    const responseText = response.getContent();
    
    if (responseText === confirmation) {
      results.push('✅ doPost отвечает правильно');
    } else {
      results.push('❌ doPost вернул: "' + responseText + '"');
    }
    
    ui.alert('Результаты тестирования:\n\n' + results.join('\n'));
    
  } catch (e) {
    ui.alert('❌ Ошибка теста:\n' + e.message + '\n\n' + results.join('\n'));
    logError('testVkApiConnection', e, results);
  }
}
