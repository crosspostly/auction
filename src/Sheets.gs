const SHEETS = {
  Config: {
    name: "Config",
    headers: ["lot_id", "post_id", "name", "start_price", "current_price", "leader_id", "status", "created_at"]
  },
  Bids: {
    name: "Bids",
    headers: ["bid_id", "lot_id", "user_id", "bid_amount", "timestamp", "comment_id"]
  },
  Winners: {
    name: "Winners",
    headers: ["lot_id", "name", "price", "winner_id", "winner_name", "won_at", "status", "delivery", "paid", "shipped"]
  },
  Settings: {
    name: "Settings",
    headers: ["setting_key", "setting_value"]
  },
  NotificationQueue: {
    name: "NotificationQueue",
    headers: ["queue_id", "user_id", "type", "payload", "status", "created_at", "processed_at", "send_after"]
  },
  Errors: {
    name: "Errors",
    headers: ["error_id", "source", "message", "payload", "created_at"]
  }
};

const DEFAULT_SETTINGS = {
  bid_step_enabled: true,
  bid_step: 50,
  min_bid_increment: 50,
  max_bid: 1000000,
  delivery_rules: JSON.stringify({ "1-3": 450, "4-6": 550, "7+": 650 }),
  order_summary_template:
    "Добрый день!\n\nВаши выигранные лоты:\n{LOTS_LIST}\n\nСумма за лоты: {LOTS_TOTAL}₽\nДоставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽\n━━━━━━━━━━━━━━━━━━━\nИТОГО К ОПЛАТЕ: {TOTAL_COST}₽\n\nДля оформления отправки пришлите:\n1. ФИО полностью\n2. Город и адрес (или СДЭК/Почта России)\n3. Номер телефона\n4. Скриншот оплаты\n\n💳 Реквизиты для оплаты:\n{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}\n\n📦 П.С. Можете копить фигурки! Аукцион каждую субботу.\nНапишите \"КОПИТЬ\", если хотите накопить больше фигурок перед отправкой.",
  payment_phone: "",
  payment_bank: "",
  group_id: "",
  confirmation_code: ""
};

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(sheetName) {
  const sheetConfig = SHEETS[sheetName] || { name: sheetName, headers: [] };
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetConfig.name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetConfig.name);
  }
  ensureHeaders(sheet, sheetConfig.headers || []);
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (!headers.length) {
    return;
  }
  const range = sheet.getRange(1, 1, 1, headers.length);
  const existing = range.getValues()[0];
  const isEmpty = existing.every(cell => !cell);
  if (isEmpty) {
    range.setValues([headers]);
  }
}

function getSheetData(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }
  const headers = values[0];
  return values.slice(1).map((row, index) => ({
    rowIndex: index + 2,
    data: headers.reduce((acc, header, idx) => {
      acc[header] = row[idx];
      return acc;
    }, {})
  }));
}

function updateRow(sheet, rowIndex, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const row = headers.map((header, index) => (header in data ? data[header] : existingRow[index]));
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function appendRow(sheetName, rowData) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(header => (header in rowData ? rowData[header] : ""));
  sheet.appendRow(row);
}

function upsertLot(lot) {
  const sheet = getSheet("Config");
  const rows = getSheetData("Config");
  const existing = rows.find(row => String(row.data.lot_id) === String(lot.lot_id));
  if (existing) {
    updateRow(sheet, existing.rowIndex, lot);
  } else {
    appendRow("Config", lot);
  }
}

function findLotByPostId(postId) {
  const rows = getSheetData("Config");
  const match = rows.find(row => String(row.data.post_id) === String(postId));
  return match ? match.data : null;
}

function findLotById(lotId) {
  const rows = getSheetData("Config");
  const match = rows.find(row => String(row.data.lot_id) === String(lotId));
  return match ? match.data : null;
}

function updateLot(lotId, updates) {
  const sheet = getSheet("Config");
  const rows = getSheetData("Config");
  const existing = rows.find(row => String(row.data.lot_id) === String(lotId));
  if (!existing) {
    return;
  }
  updateRow(sheet, existing.rowIndex, { ...existing.data, ...updates });
}

function updateLotStatus(lotId, status) {
  updateLot(lotId, { status: status });
}

function recordBid(bid) {
  appendRow("Bids", bid);
}

function recordWinner(winner) {
  appendRow("Winners", winner);
}

function getSettings() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("settings");
  if (cached) {
    return JSON.parse(cached);
  }
  const sheet = getSheet("Settings");
  const values = sheet.getDataRange().getValues();
  const settings = { ...DEFAULT_SETTINGS };
  if (values.length > 1) {
    values.slice(1).forEach(row => {
      const key = row[0];
      const value = row[1];
      if (key) {
        settings[key] = parseSettingValue(value);
      }
    });
  } else {
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      sheet.appendRow([key, DEFAULT_SETTINGS[key]]);
    });
  }
  cache.put("settings", JSON.stringify(settings), 300);
  return settings;
}

function parseSettingValue(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  const trimmed = String(value).trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") {
    return Number(trimmed);
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return trimmed;
    }
  }
  return trimmed;
}

function queueNotification(notification) {
  const queueRows = getSheetData("NotificationQueue");
  const existing = queueRows.find(row => {
    if (row.data.status !== "pending") {
      return false;
    }
    if (String(row.data.user_id) !== String(notification.user_id) || row.data.type !== notification.type) {
      return false;
    }
    try {
      const payload = JSON.parse(row.data.payload || "{}");
      return payload.lot_id && String(payload.lot_id) === String(notification.payload.lot_id);
    } catch (error) {
      return false;
    }
  });

  const payloadString = JSON.stringify(notification.payload || {});
  if (existing) {
    const sheet = getSheet("NotificationQueue");
    updateRow(sheet, existing.rowIndex, {
      ...existing.data,
      payload: payloadString,
      created_at: new Date(),
      send_after: notification.send_after || new Date()
    });
  } else {
    appendRow("NotificationQueue", {
      queue_id: generateId(),
      user_id: notification.user_id,
      type: notification.type,
      payload: payloadString,
      status: "pending",
      created_at: new Date(),
      processed_at: "",
      send_after: notification.send_after || new Date()
    });
  }
}

function updateNotificationStatus(queueId, status, processedAt) {
  const sheet = getSheet("NotificationQueue");
  const rows = getSheetData("NotificationQueue");
  const existing = rows.find(row => String(row.data.queue_id) === String(queueId));
  if (!existing) {
    return;
  }
  updateRow(sheet, existing.rowIndex, {
    ...existing.data,
    status: status,
    processed_at: processedAt || new Date()
  });
}

function logError(source, error, payload) {
  appendRow("Errors", {
    error_id: generateId(),
    source: source,
    message: error && error.message ? error.message : String(error),
    payload: payload ? JSON.stringify(payload) : "",
    created_at: new Date()
  });
}

function generateId() {
  return Utilities.getUuid();
}

function updateWinnersStatus(userId, status) {
  const sheet = getSheet("Winners");
  const rows = getSheetData("Winners");
  rows.forEach(row => {
    if (String(row.data.winner_id) === String(userId)) {
      updateRow(sheet, row.rowIndex, { ...row.data, status: status });
    }
  });
}
