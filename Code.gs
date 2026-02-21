/**
 * Handles incoming POST requests from the VK Callback API.
 * Immediately returns a response to VK to prevent timeouts and queues the event for processing.
 */
function doPost(e) {
  try {
    const rawPayload = e.postData.contents;
    const data = JSON.parse(rawPayload);

    logDebug('📨 doPost incoming', { type: data.type || "unknown", group_id: data.group_id || "" });

    const logData = {
      type: data.type || "unknown",
      group_id: data.group_id || "",
      params: e.parameter ? JSON.stringify(e.parameter) : "none"
    };
    logIncomingRaw(logData, rawPayload);

    if (data.type === 'confirmation') {
      const groupId = String(data.group_id);
      const cache = CacheService.getScriptCache();
      const codeFromCache = cache.get("CONFIRM_" + groupId);
      const codeFromProps = PropertiesService.getScriptProperties().getProperty("CONFIRMATION_CODE");
      const codeToReturn = codeFromCache || codeFromProps;
      return ContentService.createTextOutput(String(codeToReturn || "").trim()).setMimeType(ContentService.MimeType.TEXT);
    }

    const myGroupId = String(PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "");
    if (data.group_id && String(data.group_id) !== myGroupId) {
      return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
    }

    if (data.type) {
      routeEvent(data);
    }
    
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    logError('doPost_critical', error, e.postData ? e.postData.contents : 'no post data');
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  }
}

function routeEvent(payload) {
  const myGroupId = String(PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "");
  if (payload.group_id && String(payload.group_id) !== myGroupId) return;

  switch (payload.type) {
    case "wall_post_new": handleWallPostNew(payload); break;
    case "wall_reply_new": handleWallReplyNew(payload); break;
    case "wall_reply_edit": handleWallReplyEdit(payload); break;
    case "wall_reply_delete": handleWallReplyDelete(payload); break;
    case "message_new": handleMessageNew(payload); break;
  }
}

function handleWallReplyNew(payload) {
  const comment = payload.object || {};
  const commentDate = new Date(comment.date * 1000); // ВРЕМЯ КОММЕНТАРИЯ ИЗ ВК

  if (comment.from_id < 0) return; 

  const cache = CacheService.getScriptCache();
  const cacheKey = "REPLY_PROCESSED_" + comment.id;
  if (cache.get(cacheKey)) return;
  cache.put(cacheKey, "true", 300); 

  if (isBidExists(comment.id)) return;

  const ownerId = payload.group_id || getVkGroupId();
  const postKey = `-${ownerId}_${comment.post_id}`;
  
  const lot = findLotByPostId(postKey);
  if (!lot || lot.status !== "active") return;

  const bid = parseBid(comment.text || "");
  const userId = String(comment.from_id);
  if (!bid) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey); 
    
    // ПРОВЕРКА ВРЕМЕНИ КОММЕНТАРИЯ ОТНОСИТЕЛЬНО ДЕДЛАЙНА
    const validationResult = enhancedValidateBid(bid, currentLot, userId, commentDate);
    
    const postId = parsePostKey(postKey).postId;

    if (!validationResult.isValid) {
      // Если дедлайн наступил - отвечаем об ошибке и не записываем ставку
      const errorMessage = `Ставка ${bid}₽ не принята. ${validationResult.reason}`;
      if (!checkIfBotReplied(postId, comment.id)) {
        replyToComment(postId, comment.id, errorMessage);
      }
      return;
    }

    // --- ОБРАБОТКА ВАЛИДНОЙ СТАВКИ ---
    const bids = getSheetData("Bids");
    const oldLeaderBid = bids.find(b => 
      b.data.lot_id === currentLot.lot_id && 
      extractIdFromFormula(b.data.post_id) === String(postId) && 
      b.data.status === "лидер"
    );
    
    if (oldLeaderBid) updateBidStatus(oldLeaderBid.data.bid_id, "перебита");

    appendRow("Bids", {
      bid_id: Utilities.getUuid(),
      lot_id: currentLot.lot_id,
      post_id: postId,
      user_id: userId,
      bid_amount: bid,
      timestamp: commentDate,
      comment_id: comment.id,
      status: "лидер"
    });
    
    updateLot(currentLot.lot_id, { current_price: bid, leader_id: userId });

    // ЛОГИКА АНТИ-СНАЙПЕРА (ОТ ВРЕМЕНИ КОММЕНТАРИЯ)
    if (getSetting('test_mode_enabled') !== 'ВКЛ') {
      const AUCTION_EXTENSION_DURATION_MINUTES = 10;
      const originalDeadline = parseRussianDate(currentLot.deadline);
      const timeUntilDeadline = (originalDeadline.getTime() - commentDate.getTime()) / (1000 * 60);
      
      if (timeUntilDeadline <= 10) {
        const newDeadline = new Date(commentDate.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);
        updateLot(currentLot.lot_id, { deadline: newDeadline });
        logInfo(`🔥 АНТИ-СНАЙПЕР: Дедлайн сдвинут до ${newDeadline.toLocaleString()}`);
      }
    }

    // ОТВЕТ ПЕРЕБИТОМУ (ТОЛЬКО КОММЕНТАРИЙ)
    if (oldLeaderBid) {
      const outbidMsg = buildOutbidMessage({ lot_name: currentLot.name, new_bid: bid });
      if (!checkIfBotReplied(postId, oldLeaderBid.data.comment_id)) {
        const res = replyToComment(postId, oldLeaderBid.data.comment_id, outbidMsg);
        if (res && !res.error) updateBidStatus(oldLeaderBid.data.bid_id, "уведомлен");
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function validateBid(bid, lot, commentDate) {
  const checkTime = commentDate || new Date();
  const deadlineDate = parseRussianDate(lot.deadline);
  
  // САМАЯ ГЛАВНАЯ ПРОВЕРКА: ЕСЛИ ВРЕМЯ КОММЕНТАРИЯ > ДЕДЛАЙНА
  if (deadlineDate && checkTime > deadlineDate) {
    return { isValid: false, reason: buildAuctionFinishedMessage({ lot_name: lot.name }) };
  }
  
  const settings = getSettings();
  if (settings.max_bid && bid > settings.max_bid) {
    return { isValid: false, reason: buildMaxBidExceededMessage({ your_bid: bid, max_bid: settings.max_bid }) };
  }
  
  const currentPrice = Number(lot.current_price || 0);
  const startPrice = Number(lot.start_price || 0);
  const hasLeader = !!lot.leader_id && lot.leader_id !== "";

  if (!hasLeader) {
    if (bid < startPrice) return { isValid: false, reason: `Первая ставка не может быть меньше ${startPrice}₽.` };
  } else {
    const minInc = Number(settings.min_bid_increment || 50);
    if (bid < currentPrice + minInc) return { isValid: false, reason: buildLowBidMessage({ your_bid: bid, lot_name: lot.name, current_bid: currentPrice }) };
  }

  if (getSetting('bid_step_enabled') === 'ВКЛ') {
    const step = Number(settings.bid_step || 50);
    if ((bid - startPrice) % step !== 0) return { isValid: false, reason: buildInvalidStepMessage({ your_bid: bid, bid_step: step, example_bid: currentPrice + step, example_bid2: currentPrice + step * 2 }) };
  }
  
  return { isValid: true, reason: null };
}

function enhancedValidateBid(bid, lot, userId, commentDate) {
  const standard = validateBid(bid, lot, commentDate);
  if (!standard.isValid) return standard;
  if (getSetting('subscription_check_enabled') === 'ВКЛ' && !checkUserSubscription(userId)) {
    return { isValid: false, reason: buildSubscriptionRequiredMessage({ lot_name: lot.name }) };
  }
  return { isValid: true, reason: null };
}

// ... (остальные функции finalizeAuction, sendAllSummaries и т.д. остаются без изменений) ...
