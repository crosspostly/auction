const SHEETS = {
  Config: { name: "Лоты", headers: ["lot_id", "post_id", "name", "start_price", "current_price", "leader_id", "status", "created_at", "deadline", "bid_step"] },
  Bids: { name: "Ставки", headers: ["bid_id", "lot_id", "user_id", "bid_amount", "timestamp", "comment_id"] },
  Winners: { name: "Победители", headers: ["lot_id", "name", "price", "winner_id", "winner_name", "won_at", "status", "delivery", "paid", "shipped"] },
  Settings: { name: "Настройки", headers: ["setting_key", "setting_value", "description"] },
  Statistics: { name: "Статистика", headers: ["Timestamp", "EventType", "Details"] },
  EventQueue: { name: "Очередь Событий", headers: ["eventId", "payload", "status", "receivedAt"] },
  NotificationQueue: { name: "Очередь", headers: ["queue_id", "user_id", "type", "payload", "status", "created_at", "processed_at", "send_after"] },
  Logs: { name: "Журнал", headers: ["date", "type", "message", "details"] }
};

const DEFAULT_SETTINGS = {
  DEBUG_VK_API: true,
  bid_step_enabled: true,
  bid_step: 50,
  min_bid_increment: 50,
  max_bid: 1000000,
  require_subscription: false, // Новая настройка: требовать подписку для участия
  delivery_rules: JSON.stringify({ "1-3": 450, "4-6": 550, "7+": 650 }),
  order_summary_template: "Добрый день!\n\nВаши выигранные лоты:\n{LOTS_LIST}\n\nСумма за лоты: {LOTS_TOTAL}₽\nДоставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽\n━━━━━━━━━━━━━━━━━━━\nИТОГО К ОПЛАТЕ: {TOTAL_COST}₽\n\nДля оформления отправки пришлите:\n1. ФИО полностью\n2. Город и адрес (или СДЭК/Почта России)\n3. Номер телефона\n4. Скриншот оплаты\n\n💳 Реквизиты для оплаты:\n{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}\n\n📦 П.С. Можете копить фигурки! Аукцион каждую субботу.\nНапишите \"КОПИТЬ\", если хотите накопить больше фигурок перед отправкой.",
  ADMIN_IDS: "" // Добавляем ADMIN_IDS
};

const SETTINGS_DESCRIPTIONS = {
  DEBUG_VK_API: "Включить подробное логгирование запросов к VK API (TRUE/FALSE)",
  bid_step_enabled: "Включить проверку шага ставки (TRUE/FALSE)",
  bid_step: "Размер шага ставки (например, 50 руб)",
  min_bid_increment: "Минимальная надбавка к текущей цене",
  max_bid: "Максимально допустимая ставка (защита от опечаток)",
  require_subscription: "Требовать подписку на группу для участия в аукционе (TRUE/FALSE)",
  delivery_rules: "Правила доставки (JSON). Формат: \"кол-во\":цена",
  order_summary_template: "Шаблон сообщения победителю",
  payment_phone: "Телефон для оплаты (СБП)",
  payment_bank: "Название банка для оплаты",
  ADMIN_IDS: "VK ID администраторов через запятую (например, 12345,67890)"
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
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
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
  const headers = SHEETS[sheetKey].headers;
  const existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const updatedRow = headers.map((h, i) => rowData[h] !== undefined ? rowData[h] : existingRow[i]);
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
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
  if (values.length > 1) {
    values.slice(1).forEach(row => { if (row[0]) settings[row[0]] = parseSettingValue(row[1]); });
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
  const keysPresent = data.map(r => r[0]);
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (!keysPresent.includes(key)) settingsSheet.appendRow([key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key] || ""]);
  });
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