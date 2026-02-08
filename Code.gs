const API_VERSION = '5.131';
const CACHE_TTL_SECONDS = 21600;
const OUTBID_MESSAGE = 'Ваша ставка перебита';
const LOT_NOT_SOLD_MESSAGE = 'Лот не продан';
const WINNER_MESSAGE_TEMPLATE = 'Поздравляем! Вы выиграли лот №{lotNumber} за {price} руб. Напишите в сообщения группы "Аукцион ({date})" для оформления.';
const USER_WINS_HEADER = 'Ваши выигрыши:';
const USER_WINS_FOOTER = '\nОплата и доставка обсуждаются с администратором. Отправьте данные для доставки ответным сообщением.\nБудете копить?';

function onOpen() {
  createMenu();
}

function createMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('VK Auction')
    .addItem('Authorization/Setup', 'setupAuthorization')
    .addItem('Create/Update sheets', 'createOrUpdateSheets')
    .addItem('Check connection', 'checkConnection')
    .addItem('Refresh cache', 'refreshCache')
    .addItem('Run queue', 'runQueue')
    .addItem('Finalize now', 'finalizeNow')
    .addItem('Status', 'showStatus')
    .addToUi();
}

function setupAuthorization() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Для получения VK token используйте https://vkhost.github.io.\n' +
      'Выберите приложение "VK Admin", отметьте права messages, wall, groups и скопируйте access_token.'
  );
  const settings = {
    VK_TOKEN: promptSetting(ui, 'VK_TOKEN', 'Введите VK_TOKEN'),
    GROUP_ID: promptSetting(ui, 'GROUP_ID', 'Введите GROUP_ID (число без минуса)'),
    CONFIRMATION_STRING: promptSetting(ui, 'CONFIRMATION_STRING', 'Введите CONFIRMATION_STRING для Callback API'),
    VK_SECRET: promptSetting(ui, 'VK_SECRET', 'Введите VK_SECRET (secret key из Callback API)'),
    ADMIN_ID: promptSetting(ui, 'ADMIN_ID', 'Введите ADMIN_ID для итоговых отчетов')
  };
  setSettings(settings);
  ui.alert('Настройки сохранены.');
}

function promptSetting(ui, key, message) {
  const response = ui.prompt(message, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) {
    return getSetting(key);
  }
  return response.getResponseText().trim();
}

function createOrUpdateSheets() {
  ensureAllSheets();
  SpreadsheetApp.getUi().alert('Листы созданы/обновлены.');
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
  SpreadsheetApp.getUi().alert('Cache обновлен.');
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
