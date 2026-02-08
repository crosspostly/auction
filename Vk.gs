function processQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return;
  }
  try {
    const sheet = getSheet(SHEETS.QUEUE.name);
    if (!sheet || sheet.getLastRow() < 2) {
      finalizeExpiredLots(false);
      return;
    }
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const payloadText = values[i][3];
      if (!payloadText) {
        continue;
      }
      try {
        const payload = JSON.parse(payloadText);
        handleEvent(payload);
      } catch (error) {
        logError('processQueue', error, payloadText);
      }
    }
    if (values.length > 1) {
      sheet.deleteRows(2, values.length - 1);
    }
    finalizeExpiredLots(false);
  } finally {
    lock.releaseLock();
  }
}

function handleEvent(payload) {
  if (!payload || !payload.type) {
    return;
  }
  if (payload.type === 'wall_post_new') {
    handleWallPost(payload.object);
  } else if (payload.type === 'wall_reply_new') {
    handleWallReply(payload.object);
  } else if (payload.type === 'message_new') {
    handleMessageNew(payload.object);
  }
}

function handleWallPost(post) {
  if (!post || !post.text) {
    return;
  }
  if (isGiftPost(post.text)) {
    return;
  }
  const lotData = parseLotFromText(post.text);
  if (!lotData) {
    logInfo('Post ignored (not a lot)', post.id);
    return;
  }
  const existing = findLotByNumber(lotData.lotNumber) || findLotByPostId(post.id);
  if (existing) {
    return;
  }
  const imageUrl = getPhotoUrlFromAttachments(post.attachments || []);
  upsertLot({
    lotNumber: lotData.lotNumber,
    postId: post.id,
    startPrice: lotData.startPrice,
    step: lotData.step,
    deadline: lotData.deadline,
    status: LOT_STATUS_ACTIVE,
    currentPrice: lotData.startPrice,
    winnerId: '',
    winnerCommentId: '',
    imageUrl: imageUrl
  });
  logInfo('Lot stored', { lotNumber: lotData.lotNumber, postId: post.id });
}

function handleWallReply(comment) {
  if (!comment || !comment.text) {
    return;
  }
  const lot = findLotByPostId(comment.post_id);
  if (!lot) {
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return;
  }
  try {
    processBid(comment, lot);
  } finally {
    lock.releaseLock();
  }
}

function handleMessageNew(object) {
  if (!object || !object.message) {
    return;
  }
  const message = object.message;
  const text = (message.text || '').toLowerCase();
  const userId = message.from_id;
  if (!userId) {
    return;
  }
  if (text.indexOf('аукцион') !== -1) {
    sendUserWins(userId);
  } else {
    storeShippingData(userId, message.text || '');
  }
}

function processBid(comment, lot) {
  const amount = parseBidAmount(comment.text);
  if (!amount) {
    return;
  }
  const deadline = new Date(lot.values[4]);
  if (new Date() > deadline) {
    return;
  }
  const currentPrice = Number(lot.values[6]) || Number(lot.values[2]) || 0;
  const step = Number(lot.values[3]) || 50;
  const previousWinnerId = lot.values[7];
  const minBid = previousWinnerId ? currentPrice + step : currentPrice;
  if (amount < minBid) {
    return;
  }

  const lotNumber = lot.values[0];
  const previousCommentId = lot.values[8];

  appendBid(lotNumber, comment.from_id, amount, comment.id, comment.post_id);

  if (previousWinnerId && previousWinnerId !== comment.from_id && previousCommentId) {
    sendOutbidComment(comment.post_id, previousCommentId);
  }

  const updatedDeadline = extendDeadlineIfNeeded(deadline);
  updateLotRow(lot.rowIndex, {
    currentPrice: amount,
    winnerId: comment.from_id,
    winnerCommentId: comment.id,
    deadline: updatedDeadline
  });
}

function extendDeadlineIfNeeded(deadline) {
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 10 * 60 * 1000) {
    const extended = new Date(deadline.getTime() + 10 * 60 * 1000);
    return extended;
  }
  return deadline;
}

function finalizeExpiredLots(force) {
  const sheet = getSheet(SHEETS.CONFIG.name);
  if (!sheet) {
    return;
  }
  const values = sheet.getDataRange().getValues();
  const now = new Date();
  let finalizedAny = false;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const status = row[5];
    const deadline = row[4] ? new Date(row[4]) : null;
    if (status === LOT_STATUS_ENDED) {
      continue;
    }
    if (!force && deadline && deadline > now) {
      continue;
    }
    finalizeLot(row, i + 1);
    finalizedAny = true;
  }
  if (finalizedAny) {
    sendAdminSummaryIfNeeded();
  }
}

function finalizeLot(row, rowIndex) {
  const lotNumber = row[0];
  const postId = row[1];
  const currentPrice = Number(row[6]) || 0;
  const winnerId = row[7];
  const imageUrl = row[9];
  if (!winnerId || currentPrice === 0) {
    sendComment(postId, LOT_NOT_SOLD_MESSAGE);
  } else {
    const message = WINNER_MESSAGE_TEMPLATE
      .replace('{lotNumber}', lotNumber)
      .replace('{price}', currentPrice)
      .replace('{date}', formatDate(row[4]));
    sendMessage(winnerId, message);
    appendWinner(lotNumber, winnerId, currentPrice, postId, imageUrl, true);
  }
  updateLotRow(rowIndex, { status: LOT_STATUS_ENDED });
}

function sendUserWins(userId) {
  const wins = getWinnersByUser(userId);
  if (!wins.length) {
    sendMessage(userId, 'Пока нет выигранных лотов.');
    return;
  }
  const lines = wins.map((win) => {
    return 'Лот №' + win.lotNumber + ' — ' + win.price + ' руб. Фото: ' + (win.imageUrl || 'нет');
  });
  const message = [USER_WINS_HEADER].concat(lines).join('\n') + USER_WINS_FOOTER;
  sendMessage(userId, message);
}

function storeShippingData(userId, text) {
  const wins = getWinnersByUser(userId);
  if (!wins.length) {
    return;
  }
  const lotNumbers = wins.map((win) => win.lotNumber).join(', ');
  appendShipping(userId, lotNumbers, text);
}

function sendAdminSummaryIfNeeded() {
  const adminId = getSetting('ADMIN_ID');
  if (!adminId) {
    return;
  }
  const lastSummary = getSetting('SUMMARY_SENT_AT');
  const configRows = getConfigRows();
  const active = configRows.some((row) => row[5] !== LOT_STATUS_ENDED);
  if (active) {
    return;
  }
  if (lastSummary) {
    return;
  }
  const winners = getAllWinners();
  if (!winners.length) {
    return;
  }
  const grouped = {};
  winners.forEach((winner) => {
    if (!grouped[winner.userId]) {
      grouped[winner.userId] = [];
    }
    grouped[winner.userId].push(winner);
  });
  const lines = ['Итоги аукциона:'];
  Object.keys(grouped).forEach((userId) => {
    lines.push('Победитель ' + userId + ':');
    grouped[userId].forEach((item) => {
      lines.push('• Лот №' + item.lotNumber + ' — ' + item.price + ' руб. Фото: ' + (item.imageUrl || 'нет'));
    });
  });
  sendMessage(adminId, lines.join('\n'));
  setSetting('SUMMARY_SENT_AT', String(new Date().getTime()));
}

function isDuplicateEvent(payload) {
  const cache = CacheService.getScriptCache();
  const eventId = payload.event_id || buildEventId(payload);
  const key = getCachePrefix() + eventId;
  if (cache.get(key)) {
    return true;
  }
  cache.put(key, '1', CACHE_TTL_SECONDS);
  return false;
}

function parseLotFromText(text) {
  const lotNumberMatch = text.match(/лот\s*№?\s*(\d+)/i);
  const startPriceMatch = text.match(/(?:старт(?:овая)?|начальн(?:ая|ой) цена)\s*[:\-]?\s*(\d+)/i);
  const stepMatch = text.match(/шаг(?: ставки)?\s*[:\-]?\s*(\d+)/i);
  const deadline = parseDeadline(text);
  if (!lotNumberMatch || !startPriceMatch || !deadline) {
    return null;
  }
  const step = stepMatch ? Number(stepMatch[1]) : 50;
  return {
    lotNumber: Number(lotNumberMatch[1]),
    startPrice: Number(startPriceMatch[1]),
    step: step,
    deadline: deadline
  };
}

function parseDeadline(text) {
  const match = text.match(/(\d{1,2})[.\/\-](\d{1,2})(?:[.\/\-](\d{2,4}))?[^\d]*(\d{1,2})[:.](\d{2})/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) {
    year += 2000;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return new Date(year, month, day, hour, minute);
}

function parseBidAmount(text) {
  const match = text.match(/(\d[\d\s]*)/);
  if (!match) {
    return null;
  }
  return Number(match[1].replace(/\s/g, ''));
}

function isGiftPost(text) {
  return /подарок/i.test(text);
}

function getPhotoUrlFromAttachments(attachments) {
  if (!attachments || !attachments.length) {
    return '';
  }
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    if (attachment.type === 'photo' && attachment.photo && attachment.photo.sizes) {
      const sizes = attachment.photo.sizes;
      let best = sizes[0];
      sizes.forEach((size) => {
        if (size.width * size.height > best.width * best.height) {
          best = size;
        }
      });
      return best.url || '';
    }
  }
  return '';
}

function sendOutbidComment(postId, replyToCommentId) {
  const now = new Date().getTime();
  const last = Number(getSetting('LAST_OUTBID_REPLY_AT')) || 0;
  const intervalSec = Math.floor(Math.random() * 15) + 10;
  const waitMs = intervalSec * 1000 - (now - last);
  if (waitMs > 0) {
    Utilities.sleep(waitMs);
  }
  sendComment(postId, OUTBID_MESSAGE, replyToCommentId);
  setSetting('LAST_OUTBID_REPLY_AT', String(new Date().getTime()));
}

function sendMessage(userId, message) {
  callVk('messages.send', {
    user_id: userId,
    random_id: Math.floor(Math.random() * 1000000),
    message: message
  });
}

function sendComment(postId, message, replyToCommentId) {
  const ownerId = -Number(getSetting('GROUP_ID'));
  const params = {
    owner_id: ownerId,
    post_id: postId,
    message: message
  };
  if (replyToCommentId) {
    params.reply_to_comment = replyToCommentId;
  }
  callVk('wall.createComment', params);
}

function callVk(method, params) {
  const token = getSetting('VK_TOKEN');
  if (!token) {
    logError('callVk', 'VK_TOKEN не задан', method);
    return null;
  }
  const payload = Object.assign({}, params, {
    access_token: token,
    v: API_VERSION
  });
  const response = UrlFetchApp.fetch('https://api.vk.com/method/' + method, {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  const body = response.getContentText();
  const parsed = JSON.parse(body);
  if (parsed.error) {
    logError('callVk:' + method, parsed.error, params);
  }
  return parsed;
}

function formatDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return day + '.' + month + '.' + year;
}
