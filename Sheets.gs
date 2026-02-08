const SHEETS = {
  CONFIG: { name: 'Config', headers: ['Lot Number', 'Post Id', 'Start Price', 'Step', 'Deadline', 'Status', 'Current Price', 'Winner Id', 'Winner Comment Id', 'Image Url', 'Last Updated'] },
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
  Object.keys(SHEETS).forEach((key) => {
    const sheetDef = SHEETS[key];
    ensureSheet(sheetDef.name, sheetDef.headers);
  });
}

function ensureSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function logInfo(message, data) {
  appendLog(SHEETS.LOGS.name, 'INFO', message, data);
}

function logError(context, error, data) {
  const message = error && error.message ? error.message : String(error);
  appendLog(SHEETS.ERRORS.name, context, message, data);
}

function appendLog(sheetName, level, message, data) {
  const sheet = getSheet(sheetName);
  if (!sheet) {
    return;
  }
  sheet.appendRow([new Date(), level, message, data ? JSON.stringify(data) : '']);
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
  const sheet = getSheet(SHEETS.CONFIG.name);
  if (!sheet) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  return values.slice(1);
}

function findLotByPostId(postId) {
  const sheet = getSheet(SHEETS.CONFIG.name);
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
  const sheet = getSheet(SHEETS.CONFIG.name);
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
  const sheet = getSheet(SHEETS.CONFIG.name) || ensureAndGetSheet(SHEETS.CONFIG.name, SHEETS.CONFIG.headers);
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
  const sheet = getSheet(SHEETS.CONFIG.name);
  if (!sheet) {
    return;
  }
  const current = sheet.getRange(rowIndex, 1, 1, SHEETS.CONFIG.headers.length).getValues()[0];
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
  const configCount = getSheetRowCount(SHEETS.CONFIG.name);
  const bidsCount = getSheetRowCount(SHEETS.BIDS.name);
  const winnersCount = getSheetRowCount(SHEETS.WINNERS.name);
  const queueCount = getSheetRowCount(SHEETS.QUEUE.name);
  const lastOutbid = getSetting('LAST_OUTBID_REPLY_AT');
  return [
    'Config rows: ' + configCount,
    'Bids rows: ' + bidsCount,
    'Winners rows: ' + winnersCount,
    'Queue rows: ' + queueCount,
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
