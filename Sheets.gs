const SHEETS = {
  Config: { name: "Лоты", headers: ["lot_id", "post_id", "name", "start_price", "current_price", "leader_id", "status", "created_at", "deadline", "bid_step", "image_url", "attachment_id"] },
  Bids: { name: "Ставки", headers: ["bid_id", "lot_id", "user_id", "bid_amount", "timestamp", "comment_id", "status"] },
  Users: { name: "Пользователи", headers: ["user_id", "user_name", "first_win_date", "last_win_date", "total_lots_won", "total_lots_paid", "shipping_status", "shipping_details"] },
  Orders: { name: "Заказы", headers: ["order_id", "lot_id", "lot_name", "post_id", "user_id", "win_date", "win_price", "status", "shipping_batch_id"] },
  Settings: { name: "Настройки", headers: ["setting_key", "setting_value", "description"] },
  Statistics: { name: "Статистика", headers: ["Timestamp", "EventType", "Details"] },
  EventQueue: { name: "Очередь Событий", headers: ["eventId", "payload", "status", "receivedAt"] },
  NotificationQueue: { name: "Очередь", headers: ["queue_id", "user_id", "type", "payload", "status", "created_at", "processed_at", "send_after"] },
  Logs: { name: "Журнал", headers: ["date", "type", "message", "details"] }
};

const DEFAULT_SETTINGS = {
  CODE_WORD: 'Аукцион',
  bid_step: 50,
  min_bid_increment: 50,
  max_bid: 1000000,
  delivery_rules: JSON.stringify({ "1-3": 450, "4-6": 550, "7+": 650 }),
  order_summary_template: "Добрый день!

" +
    "Ваши выигранные лоты:
{LOTS_LIST}

" +
    "Сумма за лоты: {LOTS_TOTAL}₽
" +
    "Доставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽
" +
    "━━━━━━━━━━━━━━━━━━━
" +
    "ИТОГО К ОПЛАТЕ: {TOTAL_COST}₽

" +
    "Для оформления отправки пришлите:
" +
    "1. ФИО полностью
" +
    "2. Город и адрес (или СДЭК/Почта России)
" +
    "3. Номер телефона
" +
    "4. Скриншот оплаты

" +
    "💳 Реквизиты для оплаты:
" +
    "{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}

" +
    "📦 П.С. Можете копить фигурки! Аукцион каждую субботу.
" +
    "Напишите "КОПИТЬ", если хотите накопить больше фигурок перед отправкой.",
  outbid_notification_template: "🔔 Ваша ставка перебита!
Лот: {lot_name}
Новая ставка: {new_bid}₽
https://vk.com/wall{post_id}",
  low_bid_notification_template: "👋 Привет! Твоя ставка {your_bid}₽ по лоту «{lot_name}» чуть ниже текущей цены {current_bid}₽. Попробуй предложить больше, чтобы побороться за лот! 😉
https://vk.com/wall{post_id}",
  winner_notification_template: "🎉 Выиграли лот {lot_name} за {price}₽!
Напишите "АУКЦИОН".",
  subscription_required_template: "👋 Привет! Чтобы сделать ставку, нужно подписаться на нашу группу. Подпишись и попробуй снова! 📢",
  invalid_step_template: "👋 Твоя ставка {your_bid}₽ не кратна шагу {bid_step}₽. Попробуй, например, {example_bid}₽ или {example_bid2}₽. Удачи! ✨",
  max_bid_exceeded_template: "Ого, {your_bid}₽! 📈 Это больше нашего максимума в {max_bid}₽. Может, опечатка? 😉",
  auction_finished_template: "Увы, аукцион по лоту «{lot_name}» уже завершен! 😔 Следи за новыми лотами!"
};

const TOGGLE_SETTINGS = {
  bid_step_enabled: "ВКЛ",
  require_subscription: "ВЫКЛ"
};

const SETTINGS_DESCRIPTIONS = {
  ADMIN_IDS: "VK ID администраторов через запятую (например, 12345,67890)",
  CODE_WORD: "Кодовое слово, которое пользователь пишет в ЛС для получения сводки по заказам",
  bid_step: "Размер шага ставки (например, 50 руб)",
  min_bid_increment: "Минимальная надбавка к текущей цене",
  max_bid: "Максимально допустимая ставка (защита от опечаток)",
  delivery_rules: "Правила доставки (JSON). Формат: "кол-во":цена",
  order_summary_template: "Шаблон сообщения победителю с деталями заказа",
  outbid_notification_template: "Шаблон уведомления о перебитой ставке",
  low_bid_notification_template: "Шаблон уведомления о низкой ставке",
  winner_notification_template: "Шаблон уведомления победителю",
  subscription_required_template: "Шаблон уведомления о необходимости подписки",
  invalid_step_template: "Шаблон уведомления о некорректном шаге ставки",
  max_bid_exceeded_template: "Шаблон уведомления о превышении максимальной ставки",
  auction_finished_template: "Шаблон уведомления о завершении аукциона",
  bid_step_enabled: "Включить проверку шага ставки (ВКЛ/ВЫКЛ)",
  require_subscription: "Требовать подписку на группу для участия в аукционе (ВКЛ/ВЫКЛ)"
};


var _ss_cache = null;
function getSpreadsheet() { 
  if (!_ss_cache) _ss_cache = SpreadsheetApp.getActiveSpreadsheet();
  return _ss_cache; 
}

function getSheet(sheetKey) {
  const config = SHEETS[sheetKey];
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(config.name);
  if (!sheet) {
    sheet = ss.insertSheet(config.name);
    ensureHeaders(sheet, config.headers);
  }
  return sheet;
}

function ensureHeaders(sheet, headers) {
  const lastRow = sheet.getLastRow();
  
  if (lastRow === 0) {
    // Лист пуст — просто пишем заголовки
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }

  // Лист не пуст. Проверяем первую строку.
  const firstRowValues = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const isMatch = headers.every((h, i) => String(firstRowValues[i]) === String(h));

  if (!isMatch) {
    // Заголовки не совпадают! Значит, это данные, а заголовков нет.
    // Вставляем строку сверху и пишем заголовки.
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log(`Headers restored for sheet: ${sheet.getName()}`);
  }
}

function getSheetData(sheetKey) {
  const sheet = getSheet(sheetKey);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row, index) => ({
    rowIndex: index + 2,
    data: headers.reduce((acc, header, idx) => { acc[header] = row[idx]; return acc; }, {})
  }));
}

function appendRow(sheetKey, rowData) {
  const sheet = getSheet(sheetKey);
  const headers = SHEETS[sheetKey].headers;
  const row = headers.map(h => rowData[h] !== undefined ? rowData[h] : "");
  sheet.appendRow(row);
}

function updateRow(sheetKey, rowIndex, rowData) {
  const sheet = getSheet(sheetKey);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return;
  
  const headers = values[0];
  const range = sheet.getRange(rowIndex, 1, 1, headers.length);
  const currentRowValues = range.getValues()[0];
  
  const updatedRow = headers.map((h, i) => {
    return rowData[h] !== undefined ? rowData[h] : currentRowValues[i];
  });
  
  range.setValues([updatedRow]);
}

function log(type, message, details) {
  try {
    appendRow("Logs", { 
      date: new Date(), 
      type: type, 
      message: message, 
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : "" 
    });
  } catch (e) {}
}

function logInfo(msg, det) { log("ИНФО", msg, det); }
function logDebug(msg, det) {
  const debug = getSetting('DEBUG_VK_API');
  if (debug === true || debug === 'TRUE') {
    log("ОТЛАДКА", msg, det);
  }
}
function logError(src, err, pay) { log("ОШИБКА", `[${src}] ${err.message || String(err)}`, pay); }
function logIncoming(data) { log("ВХОДЯЩИЙ", "Webhook от VK", data); }

function toggleSystemSheets(hide) {
  const systemKeys = ["Bids", "NotificationQueue", "Logs"];
  const ss = getSpreadsheet();
  systemKeys.forEach(key => {
    const sheet = ss.getSheetByName(SHEETS[key].name);
    if (sheet) hide ? sheet.hideSheet() : sheet.showSheet();
  });
}

function upsertLot(lot) {
  const rows = getSheetData("Config");
  const existing = rows.find(r => String(r.data.lot_id) === String(lot.lot_id));
  if (existing) updateRow("Config", existing.rowIndex, lot);
  else appendRow("Config", lot);
}

function findLotByPostId(postId) {
  const rows = getSheetData("Config");
  const match = rows.find(r => String(r.data.post_id) === String(postId));
  return match ? match.data : null;
}

function updateLot(lotId, updates) {
  const rows = getSheetData("Config");
  const existing = rows.find(r => String(r.data.lot_id) === String(lotId));
  if (existing) updateRow("Config", existing.rowIndex, updates);
}

function getSettings() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("settings");
  if (cached) return JSON.parse(cached);

  const values = getSheet("Settings").getDataRange().getValues();
  const settings = { ...DEFAULT_SETTINGS };
  
  // Обновляем только те настройки, которые имеют непустые значения
  if (values.length > 1) {
    values.slice(1).forEach(row => { 
      if (row[0] && row[1] !== "" && row[1] !== null && row[1] !== undefined) {
        settings[row[0]] = parseSettingValue(row[1]); 
      }
    });
  }

  const props = PropertiesService.getScriptProperties().getProperties();
  const keys = ["VK_TOKEN", "GROUP_ID", "CONFIRMATION_CODE", "VK_SECRET", "PAYMENT_PHONE", "PAYMENT_BANK", "WEB_APP_URL"];
  keys.forEach(k => { if (props[k]) settings[k] = props[k]; });

  cache.put("settings", JSON.stringify(settings), 300);
  return settings;
}

function parseSettingValue(v) {
  if (v === "" || v === null) return "";
  if (v === true || v === false) return v;
  const s = String(v).trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (!isNaN(Number(s)) && s !== "") return Number(s);
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) { try { return JSON.parse(s); } catch (e) { return s; } }
  return s;
}

function createDemoData() {
  const lotSheet = getSheet('Config');
  if (lotSheet.getLastRow() <= 1) {
    appendRow('Config', { lot_id: '1234', name: 'Пример лота', start_price: 1000, current_price: 1000, status: 'active', created_at: new Date(), deadline: new Date(new Date().getTime() + 7*24*60*60*1000) });
  }
  const settingsSheet = getSheet('Settings');
  const data = settingsSheet.getDataRange().getValues();
  const keysPresent = new Set(data.map(r => r[0])); // Use Set for faster lookups

  // Clear existing settings data (except headers) before writing new structured data
  if (data.length > 1) {
    settingsSheet.deleteRows(2, data.length - 1);
  }

  // --- АДМИНИСТРАТОР ---
  settingsSheet.appendRow(["--- АДМИНИСТРАТОР ---", "", ""]);
  if (!keysPresent.has("ADMIN_IDS")) settingsSheet.appendRow(["ADMIN_IDS", "", SETTINGS_DESCRIPTIONS.ADMIN_IDS]);

  // --- ОСНОВНЫЕ ПАРАМЕТРЫ ---
  settingsSheet.appendRow(["--- ОСНОВНЫЕ ПАРАМЕТРЫ ---", "", ""]);
  const mainSettingsKeys = ["CODE_WORD", "bid_step", "min_bid_increment", "max_bid", "delivery_rules"];
  mainSettingsKeys.forEach(key => {
    settingsSheet.appendRow([key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]]);
  });
  
  // --- ПЕРЕКЛЮЧАТЕЛИ ---
  settingsSheet.appendRow(["--- ПЕРЕКЛЮЧАТЕЛИ ---", "", ""]);
  const toggleSettingsKeys = Object.keys(TOGGLE_SETTINGS);
  toggleSettingsKeys.forEach(key => {
    settingsSheet.appendRow([key, TOGGLE_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]]);
  });

  // --- ШАБЛОНЫ ---
  settingsSheet.appendRow(["--- ШАБЛОНЫ ---", "", ""]);
  const templateSettingsKeys = Object.keys(DEFAULT_SETTINGS).filter(k => k.endsWith('_template'));
  templateSettingsKeys.forEach(key => {
    settingsSheet.appendRow([key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]]);
  });
  
  applyDropdownValidation(); // Apply dropdowns after creating settings
  setupConditionalFormatting(); // Apply conditional formatting
}

function applyDropdownValidation() {
  const sheet = getSheet('Settings');
  const values = sheet.getDataRange().getValues();
  const dropdownOptions = ['ВКЛ', 'ВЫКЛ'];

  for (let i = 1; i < values.length; i++) { // Skip header row
    const settingKey = values[i][0];
    if (TOGGLE_SETTINGS.hasOwnProperty(settingKey)) {
      const range = sheet.getRange(i + 1, 2); // Column B for setting_value

      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(dropdownOptions)
        .setAllowInvalid(false)
        .setHelpText('Выберите ВКЛ или ВЫКЛ.')
        .build();
      range.setDataValidation(rule);
    }
  }
}


function setupConditionalFormatting() {
  const sheet = getSheet('Settings');
  const range = sheet.getRange("B2:B"); // Колонка B со значениями

  const rules = sheet.getConditionalFormatRules();
  // Удаляем старые правила для этой колонки, чтобы избежать дублей
  const newRules = rules.filter(rule => rule.getRanges()[0].getA1Notation() !== range.getA1Notation());

  // Правило для "ВКЛ" (зеленый)
  const ruleOn = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("ВКЛ")
    .setBackground("#d9ead3") // Светло-зеленый
    .setRanges([range])
    .build();
  newRules.push(ruleOn);

  // Правило для "ВЫКЛ" (красный)
  const ruleOff = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("ВЫКЛ")
    .setBackground("#f4cccc") // Светло-красный
    .setRanges([range])
    .build();
  newRules.push(ruleOff);

  sheet.setConditionalFormatRules(newRules);
}

function queueNotification(n) {
  const rows = getSheetData("NotificationQueue");
  const existing = rows.find(r => r.data.status === "pending" && String(r.data.user_id) === String(n.user_id) && r.data.type === n.type);
  if (existing) updateRow("NotificationQueue", existing.rowIndex, { payload: JSON.stringify(n.payload), created_at: new Date() });
  else appendRow("NotificationQueue", { queue_id: Utilities.getUuid(), user_id: n.user_id, type: n.type, payload: JSON.stringify(n.payload), status: "pending", created_at: new Date() });
}

function updateNotificationStatus(id, status, date) {
  const rows = getSheetData("NotificationQueue");
  const match = rows.find(r => String(r.data.queue_id) === String(id));
  if (match) updateRow("NotificationQueue", match.rowIndex, { status: status, processed_at: date || new Date() });
}

function updateWinnersStatus(userId, status) {
  const rows = getSheetData("Winners");
  rows.forEach(r => { if (String(r.data.winner_id) === String(userId)) updateRow("Winners", r.rowIndex, { status: status }); });
}
