const SHEETS = {
  Config: { name: "Лоты", headers: ["lot_id", "post_id", "name", "start_price", "current_price", "leader_id", "status", "created_at", "deadline", "bid_step", "image_url", "attachment_id"] },
  Bids: { name: "Ставки", headers: ["bid_id", "lot_id", "post_id", "user_id", "bid_amount", "timestamp", "comment_id", "status"] },
  Users: { name: "Пользователи", headers: ["user_id", "user_name", "first_win_date", "last_win_date", "total_lots_won", "total_lots_paid", "shipping_status", "shipping_details"] },
  Orders: { name: "Заказы", headers: ["order_id", "lot_id", "lot_name", "post_id", "user_id", "win_date", "win_price", "status", "shipping_batch_id"] },
  Settings: { name: "Настройки", headers: ["setting_key", "setting_value", "description"] },
  EventQueue: { name: "Очередь Событий", headers: ["eventId", "payload", "status", "receivedAt"] },
  NotificationQueue: { name: "Очередь", headers: ["queue_id", "user_id", "type", "payload", "status", "created_at", "processed_at", "send_after"] },
  Incoming: { name: "Входящие", headers: ["date", "type", "group_id", "params", "payload"] },
  OrderStatuses: { name: "Статусы Заказов", headers: ["status_key", "status_description"] },
  Logs: { name: "Журнал", headers: ["date", "type", "message", "details"] }
};

const SHIPPING_STATUS_OPTIONS = [
  "Накопление",
  "Готов к отправке",
  "Ожидает отправки",
  "Отправлено",
  "Доставлено",
  "Проблема"
];

const SHIPPING_STATUS_DESCRIPTIONS = {
  "Накопление": "Пользователь продолжает копить лоты, не готов к отправке.",
  "Готов к отправке": "Пользователь запросил отправку (например, написал \"АУКЦИОН\"), но еще не оплатил или не предоставил все детали.",
  "Ожидает отправки": "Оплата получена, все данные есть, лоты ожидают физической отправки.",
  "Отправлено": "Лоты отправлены.",
  "Доставлено": "Лоты получены пользователем.",
  "Проблема": "Возникли сложности с отправкой (возврат, неверный адрес и т.п.)."
};

const USER_HEADERS_DESCRIPTIONS = {
  user_id: "Уникальный ID пользователя VK.",
  user_name: "Имя и фамилия пользователя VK.",
  first_win_date: "Дата первой победы в аукционе.",
  last_win_date: "Дата последней победы в аукционе.",
  total_lots_won: "Общее количество выигранных лотов.",
  total_lots_paid: "Количество оплаченных лотов.",
  shipping_status: "Текущий статус отправки лотов для пользователя.",
  shipping_details: "Детали доставки (адрес, ФИО, телефон), предоставленные пользователем."
};

const ORDER_HEADERS_DESCRIPTIONS = {
  order_id: "Уникальный ID заказа.",
  lot_id: "ID лота, к которому относится заказ.",
  lot_name: "Название лота.",
  post_id: "ID поста VK с лотом.",
  user_id: "ID пользователя, выигравшего лот.",
  win_date: "Дата выигрыша лота.",
  win_price: "Цена выигрыша лота.",
  status: "Статус оплаты заказа (unpaid, paid, abandoned).",
  shipping_batch_id: "ID партии доставки, если лот отправлен."
};

const DEFAULT_SETTINGS = {
  CODE_WORD: 'Аукцион',
  bid_step: 50,
  min_bid_increment: 50,
  max_bid: 1000000,
  delivery_rules: '{"1-3":450,"4-6":550,"7+":650}',
  order_summary_template: `Добрый день!

Ваши выигранные лоты:
{LOTS_LIST}

Сумма за лоты: {LOTS_TOTAL}₽
Доставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽
━━━━━━━━━━━━━━━━━━━
ИТОГО К ОПЛАТЕ: {TOTAL_COST}₽

Для оформления отправки пришлите:
1. ФИО полностью
2. Город и адрес (или СДЭК/Почта России)
3. Номер телефона
4. Скриншот оплаты

💳 Реквизиты для оплаты:
{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}

📦 П.С. Можете копить фигурки! Аукцион каждую субботу.
Напишите ""КОПИТЬ"", если хотите накопить больше фигурок перед отправкой.`,
  outbid_notification_template: `🔔 Ваша ставка перебита!`,
  low_bid_notification_template: `👋 Привет! Твоя ставка {your_bid}₽ по лоту «{lot_name}» чуть ниже текущей цены {current_bid}₽. Попробуй предложить больше, чтобы побороться за лот! 😉`,
  winner_notification_template: `🎉 Выиграли лот {lot_name} за {price}₽!\nНапишите ""АУКЦИОН"".`,
  winner_comment_template: `Поздравляем с победой в аукционе за миниатюру! [id{user_id}|{user_name}] Напишите в сообщения группы \"Аукцион ({date})\", чтобы забрать свой лот`,
  unsold_lot_comment_template: `❌ Лот не продан`,
  subscription_required_template: `👋 Привет! Чтобы сделать ставку, нужно подписаться на нашу группу. Подпишись и попробуй снова! 📢`,
  invalid_step_template: `👋 Твоя ставка {your_bid}₽ не кратна шагу {bid_step}₽. Попробуй, например, {example_bid}₽ или {example_bid2}₽. Удачи! ✨`,
  max_bid_exceeded_template: `Ого, {your_bid}₽! 📈 Это больше нашего максимума в {max_bid}₽. Может, опечатка? 😉`,
  auction_finished_template: `Увы, аукцион по лоту «{lot_name}» уже завершен! 😔 Следи за новыми лотами!`,
  bid_step_enabled: 'ВКЛ',
  subscription_check_enabled: 'ВЫКЛ',
  debug_logging_enabled: 'ВЫКЛ',
  reply_on_invalid_bid_enabled: 'ВКЛ',
  send_winner_dm_enabled: 'ВКЛ',
  saturday_only_enabled: 'ВКЛ',
  test_mode_enabled: 'ВЫКЛ'
};

const SETTINGS_DESCRIPTIONS = {
  ADMIN_IDS: "VK ID администраторов через запятую (например, 12345,67890)",
  CODE_WORD: "Кодовое слово, которое пользователь пишет в ЛС для получения сводки по заказам",
  bid_step: "Размер шага ставки (например, 50 руб)",
  min_bid_increment: "Минимальная надбавка к текущей цене",
  max_bid: "Максимально допустимая ставка (защита от опечаток)",
  delivery_rules: 'Правила доставки (JSON). Формат: "кол-во":цена',
  order_summary_template: "Шаблон сообщения победителю с деталями заказа",
  winner_comment_template: "Шаблон комментария о победе с упоминанием пользователя",
  unsold_lot_comment_template: "Шаблон комментария для не проданного лота",
  outbid_notification_template: "Шаблон уведомления о перебитой ставке",
  low_bid_notification_template: "Шаблон уведомления о низкой ставке",
  winner_notification_template: "Шаблон уведомления победителю",
  subscription_required_template: "Шаблон уведомления о необходимости подписки",
  invalid_step_template: "Шаблон уведомления о некорректном шаге ставки",
  max_bid_exceeded_template: "Шаблон уведомления о превышении максимальной ставки",
  auction_finished_template: "Шаблон уведомления о завершении аукциона",
  bid_step_enabled: "Включить проверку шага ставки (ВКЛ/ВЫКЛ)",
  subscription_check_enabled: "Проверять подписку на группу перед приемом ставки (ВКЛ/ВЫКЛ)",
  debug_logging_enabled: "Включить подробные технические логи (ВКЛ/ВЫКЛ)",
  reply_on_invalid_bid_enabled: "Отвечать комментарием на некорректные ставки (шаг, цена) (ВКЛ/ВЫКЛ)",
  send_winner_dm_enabled: "Отправлять победителю сообщение в ЛС (ВКЛ/ВЫКЛ)",
  saturday_only_enabled: "Обрабатывать только посты, опубликованные в субботу (ВКЛ/ВЫКЛ)",
  test_mode_enabled: "Режим тестирования. Если ВКЛ, аукцион длится 5 минут. (ВКЛ/ВЫКЛ)"
};

const TOGGLE_SETTINGS = {
  bid_step_enabled: "ВКЛ",
  subscription_check_enabled: "ВЫКЛ",
  debug_logging_enabled: "ВЫКЛ",
  reply_on_invalid_bid_enabled: "ВКЛ",
  send_winner_dm_enabled: "ВКЛ",
  saturday_only_enabled: "ВКЛ"  
};

var _ss_cache = null;
function getSpreadsheet() { 
  if (!_ss_cache) _ss_cache = SpreadsheetApp.getActiveSpreadsheet();
  return _ss_cache; 
}

function getSheet(sheetKey) {
  const config = SHEETS[sheetKey];
  if (!config) {
    throw new Error(`Лист с ключом "${sheetKey}" не определен в конфигурации SHEETS.`);
  }
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(config.name);
  if (!sheet) {
    try {
      sheet = ss.insertSheet(config.name);
      ensureHeaders(sheet, config.headers);
      
      // Apply date formatting to known date columns in ANY sheet
      applyDateFormatting(sheet, config.headers);
      
      logInfo(`Создан новый лист: ${config.name}`);
    } catch (e) {
      throw new Error(`Не удалось создать лист "${config.name}": ${e.message}`);
    }
  }
  return sheet;
}

function applyDateFormatting(sheet, headers) {
  const dateColumns = ['created_at', 'deadline', 'timestamp', 'date', 'receivedAt', 'processed_at', 'win_date', 'first_win_date', 'last_win_date'];
  
  dateColumns.forEach(colName => {
    const colIndex = headers.indexOf(colName) + 1;
    if (colIndex > 0) {
      // Apply format to the entire column (rows 2 to max)
      // Use full timestamp format for precision
      sheet.getRange(2, colIndex, sheet.getMaxRows() - 1, 1)
           .setNumberFormat("dd.MM.yyyy HH:mm:ss");
    }
  });
}

function ensureHeaders(sheet, headers) {
  const lastColumn = sheet.getLastColumn();
  const headerRange = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn) : null;
  const currentHeaders = headerRange ? headerRange.getValues()[0] : [];

  // Check if headers are already perfect
  if (currentHeaders.length === headers.length && currentHeaders.every((h, i) => String(h) === String(headers[i]))) {
    return; // Headers are fine, do nothing.
  }

  // If we're here, headers are wrong or missing. Overwrite them.
  // This is safer than trying to insert columns.
  
  // Clear the old header range to remove any extra columns
  if (headerRange) {
    headerRange.clearContent();
  }
  
  // Write the new, correct headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  Logger.log(`Headers enforced for sheet: ${sheet.getName()}`);
}

function getSheetData(sheetKey) {
  const cacheKey = 'sheet_' + sheetKey;
  
  // Determine if running interactively (user clicking in UI) vs. automatically (trigger, webapp)
  let isInteractive = false;
  try {
    // This call fails if there's no user interface, indicating an automatic execution
    if (ScriptApp.getUi()) isInteractive = true;
  } catch (e) {
    isInteractive = false;
  }
  
  // ONLY use cache for interactive sessions to speed up UI
  if (isInteractive) {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const sheet = getSheet(sheetKey);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const data = values.slice(1).map((row, index) => ({
    rowIndex: index + 2,
    data: headers.reduce((acc, header, idx) => { acc[header] = row[idx]; return acc; }, {})
  }));

  if (isInteractive) {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(data), 120); // Cache for 2 minutes
  }

  return data;
}

function appendRow(sheetKey, rowData) {
  const sheet = getSheet(sheetKey);
  const headers = SHEETS[sheetKey].headers;
  
  const row = headers.map(h => {
    let val = rowData[h];
    // --- FORCE DATE FORMATTING ---
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm:ss");
    }
    return val !== undefined ? val : "";
  });
  
  // Insert new row immediately after the header (row 1)
  // This makes the newest entries appear at the top (descending order)
  sheet.insertRowAfter(1);
  const range = sheet.getRange(2, 1, 1, row.length);
  range.setValues([row]);
  range.setFontWeight("normal"); // Reset formatting to normal (not bold)
  
  SpreadsheetApp.flush(); // Force the sheet to update immediately
  CacheService.getScriptCache().remove('sheet_' + sheetKey); // Always clear cache on write
}

function updateRow(sheetKey, rowIndex, rowData) {
  const sheet = getSheet(sheetKey);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return;
  
  const headers = values[0];
  const range = sheet.getRange(rowIndex, 1, 1, headers.length);
  const currentRowValues = range.getValues()[0];
  
  const updatedRow = headers.map((h, i) => {
    let val = rowData[h] !== undefined ? rowData[h] : currentRowValues[i];
    // --- FORCE DATE FORMATTING ---
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm:ss");
    }
    return val;
  });
  
  range.setValues([updatedRow]);
  CacheService.getScriptCache().remove('sheet_' + sheetKey); // Always clear cache on write
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
  // getSetting доступна глобально из Code.gs
  const debugEnabled = getSetting('debug_logging_enabled'); 
  if (debugEnabled === true || debugEnabled === 'ВКЛ') {
    log("ОТЛАДКА", msg, det);
  }
}
function logError(src, err, pay) { log("ОШИБКА", `[${src}] ${err.message || String(err)}`, pay); }
function logIncoming(data) { log("ВХОДЯЩИЙ", "Webhook от VK", data); }

/**
 * Logs raw incoming VK events to the "Входящие" sheet and keeps only the last 100 rows.
 * @param {object} data - The parsed VK event data.
 * @param {string} rawPayload - The raw JSON string from VK.
 */
function logIncomingRaw(data, rawPayload) {
  try {
    const sheet = getSheet("Incoming");
    
    // Add new row
    appendRow("Incoming", {
      date: new Date(),
      type: data.type || "unknown",
      group_id: data.group_id || "",
      params: data.params || "",
      payload: rawPayload
    });

    // Keep only last 100 rows
    const maxRows = 100;
    const lastRow = sheet.getLastRow();
    if (lastRow > maxRows + 1) { // +1 for header
      const rowsToDelete = lastRow - (maxRows + 1);
      sheet.deleteRows(2, rowsToDelete);
    }
  } catch (e) {
    // If logging fails, we don't want to crash the whole process
    console.error("Failed to log raw incoming event", e);
  }
}

function toggleSystemSheets(hide) {
  const systemKeys = ["Bids", "NotificationQueue", "EventQueue", "Logs", "Incoming"];
  const ss = getSpreadsheet();
  systemKeys.forEach(key => {
    if (SHEETS[key]) {
      const sheet = ss.getSheetByName(SHEETS[key].name);
      if (sheet) hide ? sheet.hideSheet() : sheet.showSheet();
    }
  });
}

function upsertLot(lot) {
  const sheetKey = "Config";
  const rows = getSheetData(sheetKey);
  const existing = rows.find(r => String(r.data.lot_id) === String(lot.lot_id));
  
  // Format post_id as a clickable link if it looks like a valid VK post ID
  if (lot.post_id && String(lot.post_id).includes('_')) {
    // Escape double quotes just in case, though post_id shouldn't have them
    const safePostId = String(lot.post_id).replace(/"/g, '""');
    // Formula: =HYPERLINK("https://vk.com/wall-213_123"; "-213_123")
    lot.post_id = `=HYPERLINK("https://vk.com/wall${safePostId}"; "${safePostId}")`;
  }

  Monitoring.recordEvent('UPSERT_LOT_ATTEMPT', { 
    lot_id: lot.lot_id, 
    exists: !!existing, 
    sheetKey: sheetKey 
  });

  if (existing) {
    updateRow(sheetKey, existing.rowIndex, lot);
  } else {
    appendRow(sheetKey, lot);
  }
}

// Helper to extract plain ID from HYPERLINK formula if present
function extractIdFromFormula(val) {
  if (!val) return "";
  const s = String(val);
  if (s.startsWith("=HYPERLINK")) {
    const match = s.match(/;\s*"([^"]+)"\)/i);
    return match ? match[1] : s;
  }
  return s;
}

function findLotByPostId(postId) {
  const rows = getSheetData("Config");
  const match = rows.find(r => extractIdFromFormula(r.data.post_id) === String(postId));
  return match ? match.data : null;
}

/**
 * Checks if a bid with a given comment_id already exists.
 * This is a robust way to prevent processing duplicate events.
 * @param {string} commentId The VK comment ID to check.
 * @returns {boolean} True if the bid exists, false otherwise.
 */
function isBidExists(commentId) {
  if (!commentId) return false;
  const bids = getSheetData("Bids");
  return bids.some(b => String(b.data.comment_id) === String(commentId));
}

function updateLot(lotId, updates) {
  const rows = getSheetData("Config");
  const existing = rows.find(r => String(r.data.lot_id) === String(lotId));
  if (existing) {
    // If updating post_id, wrap in HYPERLINK
    if (updates.post_id && !String(updates.post_id).startsWith("=HYPERLINK")) {
      const safeId = String(updates.post_id).replace(/"/g, '""');
      updates.post_id = `=HYPERLINK("https://vk.com/wall${safeId}"; "${safeId}")`;
    }
    updateRow("Config", existing.rowIndex, updates);
  }
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

  const addSettingIfNotExists = (key, value, description) => {
    // Re-fetch existing settings inside the helper to ensure we have the latest data,
    // as appendRow will clear the cache.
    const existingSettings = getSheetData('Settings').map(s => s.data.setting_key);
    if (!existingSettings.includes(key)) {
      // Use the project's custom appendRow to ensure cache is busted for the next check.
      appendRow("Settings", { 
        setting_key: key, 
        setting_value: value, 
        description: description 
      });
    }
  };

  // --- АДМИНИСТРАТОР ---
  addSettingIfNotExists("--- АДМИНИСТРАТОР ---", "", "");
  addSettingIfNotExists("ADMIN_IDS", "", SETTINGS_DESCRIPTIONS.ADMIN_IDS);

  // --- ОСНОВНЫЕ ПАРАМЕТРЫ ---
  addSettingIfNotExists("--- ОСНОВНЫЕ ПАРАМЕТРЫ ---", "", "");
  for (const key of ["CODE_WORD", "bid_step", "min_bid_increment", "max_bid", "delivery_rules"]) {
    addSettingIfNotExists(key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]);
  }

  // --- ПЕРЕКЛЮЧАТЕЛИ ---
  addSettingIfNotExists("--- ПЕРЕКЛЮЧАТЕЛИ ---", "", "");
  for (const key of [
    "bid_step_enabled",
    "subscription_check_enabled",
    "debug_logging_enabled",
    "reply_on_invalid_bid_enabled",
    "send_winner_dm_enabled",
    "saturday_only_enabled",
    "test_mode_enabled"
  ]) {
    addSettingIfNotExists(key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]);
  }

  // --- ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ ---
  addSettingIfNotExists("--- ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ ---", "", "");

  // --- ШАБЛОНЫ ---
  addSettingIfNotExists("--- ШАБЛОНЫ ---", "", "");
  const templateKeys = [
    "order_summary_template",
    "winner_comment_template",
    "unsold_lot_comment_template",
    "outbid_notification_template",
    "low_bid_notification_template",
    "winner_notification_template",
    "subscription_required_template",
    "invalid_step_template",
    "max_bid_exceeded_template",
    "auction_finished_template",
  ];
  for (const key of templateKeys) {
    addSettingIfNotExists(key, DEFAULT_SETTINGS[key], SETTINGS_DESCRIPTIONS[key]);
  }
  
  applyDropdownValidation();
  setupConditionalFormatting();

  const usersSheet = getSheet('Users');
  const ordersSheet = getSheet('Orders');
  const orderStatusesSheet = getSheet('OrderStatuses');

  if (orderStatusesSheet.getLastRow() <= 1) {
    SHIPPING_STATUS_OPTIONS.forEach(status => {
      appendRow('OrderStatuses', { status_key: status, status_description: SHIPPING_STATUS_DESCRIPTIONS[status] });
    });
  }

  const usersHeaders = SHEETS.Users.headers;
  const shippingStatusColIndex = usersHeaders.indexOf('shipping_status') + 1;
  if (shippingStatusColIndex > 0) {
    const dropdownRange = usersSheet.getRange(2, shippingStatusColIndex, 999, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(SHIPPING_STATUS_OPTIONS)
      .setAllowInvalid(false)
      .setHelpText('Выберите статус отправки из списка.')
      .build();
    dropdownRange.setDataValidation(rule);
  }

  applyHeaderTooltips(usersSheet, SHEETS.Users.headers, USER_HEADERS_DESCRIPTIONS);
  applyHeaderTooltips(ordersSheet, SHEETS.Orders.headers, ORDER_HEADERS_DESCRIPTIONS);
  
  setupUsersConditionalFormatting();
  setupOrdersConditionalFormatting();
}

/**
 * Настраивает цветовое выделение для статусов в листе Заказы
 */
function setupOrdersConditionalFormatting() {
  const sheet = getSheet('Orders');
  const headers = SHEETS.Orders.headers;
  const colIndex = headers.indexOf('status') + 1;
  
  if (colIndex === 0) return;
  
  const range = sheet.getRange(2, colIndex, 999, 1);
  const rules = sheet.getConditionalFormatRules();
  
  const newRules = rules.filter(rule => rule.getRanges()[0].getA1Notation() !== range.getA1Notation());

  const statusColors = {
    "paid": "#d9ead3",    // Зеленый
    "unpaid": "#f4cccc",  // Красный
    "shipped": "#cfe2f3", // Синий
    "accumulating": "#fff2cc" // Желтый (если используется)
  };

  for (const [status, color] of Object.entries(statusColors)) {
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(color)
      .setRanges([range])
      .build();
    newRules.push(rule);
  }

  sheet.setConditionalFormatRules(newRules);
}

/**
 * Настраивает цветовое выделение для статусов в листе Пользователи
 */
function setupUsersConditionalFormatting() {
  const sheet = getSheet('Users');
  const headers = SHEETS.Users.headers;
  const colIndex = headers.indexOf('shipping_status') + 1;
  
  if (colIndex === 0) return;
  
  const range = sheet.getRange(2, colIndex, 999, 1);
  const rules = sheet.getConditionalFormatRules();
  
  // Удаляем старые правила для этой колонки
  const newRules = rules.filter(rule => rule.getRanges()[0].getA1Notation() !== range.getA1Notation());

  const statusColors = {
    "Накопление": "#d9ead3",      // Светло-зеленый
    "Готов к отправке": "#fff2cc", // Светло-желтый
    "Ожидает отправки": "#fce5cd", // Светло-оранжевый
    "Отправлено": "#cfe2f3",       // Светло-синий
    "Доставлено": "#efefef",       // Серый
    "Проблема": "#f4cccc"          // Светло-красный
  };

  for (const [status, color] of Object.entries(statusColors)) {
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(color)
      .setRanges([range])
      .build();
    newRules.push(rule);
  }

  sheet.setConditionalFormatRules(newRules);
  logDebug("Настроено цветовое выделение в листе Пользователи");
}

// Новая вспомогательная функция для применения тултипов
function applyHeaderTooltips(sheet, headers, descriptions) {
  if (!sheet) return;
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  for (let i = 0; i < headers.length; i++) {
    const headerKey = headers[i];
    if (descriptions[headerKey]) {
      sheet.getRange(1, i + 1).setNote(descriptions[headerKey]);
    }
  }
}


function applyDropdownValidation() {
  const sheet = getSheet('Settings');
  const values = sheet.getDataRange().getValues();
  const dropdownOptions = ['ВКЛ', 'ВЫКЛ'];

  for (let i = 1; i < values.length; i++) { // Skip header row
    const settingKey = values[i][0];
    if ([
      "bid_step_enabled",
      "subscription_check_enabled",
      "debug_logging_enabled",
      "reply_on_invalid_bid_enabled",
      "send_winner_dm_enabled",
      "saturday_only_enabled",
      "test_mode_enabled"
    ].includes(settingKey)) {
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
  
  // Check for existing PENDING notification with same user_id, type, and similar payload
  let existing = null;

  if (n.type === "outbid" || n.type === "winner") {
    // For outbid and winner notifications, check if there's already a pending notification for this user and lot
    existing = rows.find(r =>
      r.data.status === "pending" &&
      String(r.data.user_id) === String(n.user_id) &&
      r.data.type === n.type &&
      r.data.payload.includes(n.payload.lot_id) // Check if payload contains the same lot_id
    );
  } else {
    // For other types, check user_id and type
    existing = rows.find(r =>
      r.data.status === "pending" &&
      String(r.data.user_id) === String(n.user_id) &&
      r.data.type === n.type
    );
  }

  // If no pending notification exists, also check for recently processed notifications to prevent duplicates
  if (!existing) {
    // Check for notifications processed in the last 5 minutes to prevent spam during rapid-fire events
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const recentDuplicate = rows.find(r =>
      String(r.data.user_id) === String(n.user_id) &&
      r.data.type === n.type &&
      r.data.status !== "pending" && // Already processed notifications
      new Date(r.data.processed_at || r.data.created_at) > fiveMinutesAgo &&
      (n.type === "outbid" || n.type === "winner" ? 
        r.data.payload.includes(n.payload.lot_id) : true) // For outbid/winner, also check lot_id
    );
    
    if (recentDuplicate) {
      // If we found a recent duplicate, don't send another one
      Monitoring.recordEvent('DUPLICATE_NOTIFICATION_PREVENTED', {
        user_id: n.user_id,
        type: n.type,
        lot_id: n.payload.lot_id,
        duplicate_with_queue_id: recentDuplicate.data.queue_id,
        duplicate_payload: recentDuplicate.data.payload,
        current_payload: JSON.stringify(n.payload)
      });
      return; // Exit early, don't queue the duplicate
    }
  }

  if (existing) {
    // Update existing notification with new payload and timestamp
    updateRow("NotificationQueue", existing.rowIndex, {
      payload: JSON.stringify(n.payload),
      created_at: new Date(),
      send_after: n.send_after || null // Update send_after if provided
    });
  } else {
    // Add new notification
    appendRow("NotificationQueue", {
      queue_id: Utilities.getUuid(),
      user_id: n.user_id,
      type: n.type,
      payload: JSON.stringify(n.payload),
      status: "pending",
      created_at: new Date(),
      send_after: n.send_after || null
    });
  }
}

function updateNotificationStatus(id, status, date) {
  const rows = getSheetData("NotificationQueue");
  const match = rows.find(r => String(r.data.queue_id) === String(id));
  if (match) updateRow("NotificationQueue", match.rowIndex, { status: status, processed_at: date || new Date() });
}