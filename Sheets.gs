const SHEETS = {
  LOTS: { name: 'Лоты', headers: ['Lot Number', 'Post Id', 'Start Price', 'Step', 'Deadline', 'Status', 'Current Price', 'Winner Id', 'Winner Comment Id', 'Image Url', 'Last Updated'] },
  SETTINGS: { name: 'Settings', headers: ['Key', 'Value', 'Description'] },
  BIDS: { name: 'Bids', headers: ['Timestamp', 'Lot Number', 'User Id', 'Bid Amount', 'Comment Id', 'Post Id'] },
  WINNERS: { name: 'Winners', headers: ['Timestamp', 'Lot Number', 'User Id', 'Price', 'Post Id', 'Image Url', 'Notified'] },
  SHIPPING: { name: 'Shipping', headers: ['Timestamp', 'User Id', 'Lot Numbers', 'Message', 'Status'] },
  LOGS: { name: 'Logs', headers: ['Timestamp', 'Level', 'Message', 'Data'] },
  ERRORS: { name: 'Errors', headers: ['Timestamp', 'Context', 'Message', 'Data'] },
  QUEUE: { name: 'Queue', headers: ['Timestamp', 'Event Id', 'Type', 'Payload'] }
};

const LOT_STATUS_ACTIVE = 'ACTIVE';
const LOT_STATUS_ENDED = 'ENDED';

function ensureAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Rename Config to Лоты if it exists
  const oldConfig = ss.getSheetByName('Config');
  if (oldConfig) {
    const newLots = ss.getSheetByName(SHEETS.LOTS.name);
    if (!newLots) {
      oldConfig.setName(SHEETS.LOTS.name);
    }
  }

  Object.keys(SHEETS).forEach((key) => {
    const sheetDef = SHEETS[key];
    ensureSheet(sheetDef.name, sheetDef.headers);
  });
  initializeSettingsSheet();
}

function ensureSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function initializeSettingsSheet() {
  const sheet = getSheet(SHEETS.SETTINGS.name);
  const settings = [
    ['only_saturday', 'FALSE', 'Только субботние посты (TRUE/FALSE)'],
    ['admin_ids', '', 'ID администраторов через запятую (для отчетов)'],
    ['dm_template_auction', 'Привет! 🌸\n\nВы выиграли в аукционе:\n{lots}\n\nИТОГО: {total} руб.\nДоставка: {delivery} руб.\n\nКарта для оплаты: {payment_details}\nПосле оплаты пришлите скриншот.', 'Шаблон сообщения о выигрыше'],
  ];
  
  const existingData = sheet.getDataRange().getValues();
  settings.forEach((s) => {
    const exists = existingData.some(row => row[0] === s[0]);
    if (!exists) {
      sheet.appendRow(s);
    }
  });
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function logInfo(message, data) {
  appendLog(SHEETS.LOGS.name, 'INFO', message, data, '#f3f3f3');
}

function logError(context, error, data) {
  const message = error && error.message ? error.message : String(error);
  appendLog(SHEETS.ERRORS.name, context, message, data, '#ea9999');
}

function appendLog(sheetName, level, message, data, color) {
  const sheet = getSheet(sheetName);
  if (!sheet) {
    return;
  }
  sheet.insertRowAfter(1);
  const row = [new Date(), level, message, data ? (typeof data === 'string' ? data : JSON.stringify(data)) : ''];
  sheet.getRange(2, 1, 1, row.length).setValues([row]);
  if (color) {
    sheet.getRange(2, 1, 1, row.length).setBackground(color);
  }
}

function enqueueEvent(payload) {
  const sheet = getSheet(SHEETS.QUEUE.name) || ensureAndGetSheet(SHEETS.QUEUE.name, SHEETS.QUEUE.headers);
  const eventId = payload.event_id || buildEventId(payload);
  sheet.appendRow([new Date(), eventId, payload.type, JSON.stringify(payload)]);
}

function ensureAndGetSheet(name, headers) {
  ensureSheet(name, headers);
  return getSheet(name);
}

function getConfigRows() {
  const sheet = getSheet(SHEETS.LOTS.name);
  if (!sheet) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  return values.slice(1);
}

function findLotByPostId(postId) {
  const sheet = getSheet(SHEETS.LOTS.name);
  if (!sheet) {
    return null;
  }
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) === String(postId)) {
      return { rowIndex: i + 1, values: values[i] };
    }
  }
  return null;
}

function findLotByNumber(lotNumber) {
  const sheet = getSheet(SHEETS.LOTS.name);
  if (!sheet) {
    return null;
  }
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(lotNumber)) {
      return { rowIndex: i + 1, values: values[i] };
    }
  }
  return null;
}

function upsertLot(lotData) {
  const sheet = getSheet(SHEETS.LOTS.name) || ensureAndGetSheet(SHEETS.LOTS.name, SHEETS.LOTS.headers);
  const existing = findLotByNumber(lotData.lotNumber) || findLotByPostId(lotData.postId);
  const row = [
    lotData.lotNumber,
    lotData.postId,
    lotData.startPrice,
    lotData.step,
    lotData.deadline,
    lotData.status || LOT_STATUS_ACTIVE,
    lotData.currentPrice || '',
    lotData.winnerId || '',
    lotData.winnerCommentId || '',
    lotData.imageUrl || '',
    new Date()
  ];
  if (existing) {
    sheet.getRange(existing.rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function updateLotRow(rowIndex, updates) {
  const sheet = getSheet(SHEETS.LOTS.name);
  if (!sheet) {
    return;
  }
  const current = sheet.getRange(rowIndex, 1, 1, SHEETS.LOTS.headers.length).getValues()[0];
  const updated = current.slice();
  Object.keys(updates).forEach((key) => {
    const columnIndex = getConfigColumnIndex(key);
    if (columnIndex !== null) {
      updated[columnIndex] = updates[key];
    }
  });
  updated[10] = new Date();
  sheet.getRange(rowIndex, 1, 1, updated.length).setValues([updated]);
}

function getConfigColumnIndex(key) {
  const mapping = {
    lotNumber: 0,
    postId: 1,
    startPrice: 2,
    step: 3,
    deadline: 4,
    status: 5,
    currentPrice: 6,
    winnerId: 7,
    winnerCommentId: 8,
    imageUrl: 9,
    lastUpdated: 10
  };
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : null;
}

function appendBid(lotNumber, userId, amount, commentId, postId) {
  const sheet = getSheet(SHEETS.BIDS.name) || ensureAndGetSheet(SHEETS.BIDS.name, SHEETS.BIDS.headers);
  sheet.appendRow([new Date(), lotNumber, userId, amount, commentId, postId]);
}

function appendWinner(lotNumber, userId, price, postId, imageUrl, notified) {
  const sheet = getSheet(SHEETS.WINNERS.name) || ensureAndGetSheet(SHEETS.WINNERS.name, SHEETS.WINNERS.headers);
  if (winnerExists(lotNumber)) {
    return;
  }
  sheet.appendRow([new Date(), lotNumber, userId, price, postId, imageUrl, notified ? 'YES' : 'NO']);
}

function winnerExists(lotNumber) {
  const sheet = getSheet(SHEETS.WINNERS.name);
  if (!sheet) {
    return false;
  }
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) === String(lotNumber)) {
      return true;
    }
  }
  return false;
}

function appendShipping(userId, lotNumbers, message) {
  const sheet = getSheet(SHEETS.SHIPPING.name) || ensureAndGetSheet(SHEETS.SHIPPING.name, SHEETS.SHIPPING.headers);
  sheet.appendRow([new Date(), userId, lotNumbers, message, 'RECEIVED']);
}

function getWinnersByUser(userId) {
  const sheet = getSheet(SHEETS.WINNERS.name);
  if (!sheet) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][2]) === String(userId)) {
      result.push({
        lotNumber: values[i][1],
        price: values[i][3],
        postId: values[i][4],
        imageUrl: values[i][5]
      });
    }
  }
  return result;
}

function getAllWinners() {
  const sheet = getSheet(SHEETS.WINNERS.name);
  if (!sheet) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  return values.slice(1).map((row) => ({
    lotNumber: row[1],
    userId: row[2],
    price: row[3],
    imageUrl: row[5]
  }));
}

function buildStatus() {
  const configCount = getSheetRowCount(SHEETS.LOTS.name);
  const bidsCount = getSheetRowCount(SHEETS.BIDS.name);
  const winnersCount = getSheetRowCount(SHEETS.WINNERS.name);
  const queueCount = getSheetRowCount(SHEETS.QUEUE.name);
  const lastOutbid = getSetting('LAST_OUTBID_REPLY_AT');
  return [
    'Лоты: ' + configCount,
    'Ставки: ' + bidsCount,
    'Победители: ' + winnersCount,
    'Очередь: ' + queueCount,
    'Last outbid reply: ' + (lastOutbid ? new Date(Number(lastOutbid)).toLocaleString() : 'нет')
  ].join('\n');
}

function getSheetRowCount(name) {
  const sheet = getSheet(name);
  if (!sheet) {
    return 0;
  }
  const lastRow = sheet.getLastRow();
  return Math.max(0, lastRow - 1);
}

function getSetting(key) {
  // Check Sheet first
  const sheet = getSheet(SHEETS.SETTINGS.name);
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        return data[i][1];
      }
    }
  }
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function setSettings(settings) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(settings).forEach((key) => {
    if (settings[key]) {
      props.setProperty(key, settings[key]);
    }
  });
}

function setSetting(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function getCachePrefix() {
  const salt = getSetting('CACHE_SALT') || 'default';
  return 'event:' + salt + ':';
}

function buildEventId(payload) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(payload));
  return Utilities.base64Encode(digest);
}
