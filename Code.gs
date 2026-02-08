const API_VERSION = '5.131';
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
    .addItem('Запустить очередь', 'runQueue')
    .addItem('Завершить активные лоты', 'finalizeNow')
    .addItem('Статус', 'showStatus')
    .addItem('Настроить триггеры', 'setupTriggers')
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

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const confirmation = getSetting('CONFIRMATION_STRING');
    if (payload.type === 'confirmation') {
      return ContentService.createTextOutput(confirmation || '');
    }

    const secret = getSetting('VK_SECRET');
    if (secret && payload.secret !== secret) {
      logError('doPost', 'Secret mismatch', payload);
      return ContentService.createTextOutput('ok');
    }

    if (isDuplicateEvent(payload)) {
      return ContentService.createTextOutput('ok');
    }

    enqueueEvent(payload);
    return ContentService.createTextOutput('ok');
  } catch (error) {
    logError('doPost', error, e && e.postData ? e.postData.contents : 'no payload');
    return ContentService.createTextOutput('ok');
  }
}
