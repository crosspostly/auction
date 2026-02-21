import re

def replace_function(content, func_name, new_code):
    pattern = rf"function\s+{func_name}\s*\("
    match = re.search(pattern, content)
    if not match:
        return content
    
    start_pos = match.start()
    bracket_count = 0
    in_func = False
    end_pos = -1
    
    for i in range(start_pos, len(content)):
        if content[i] == '{':
            bracket_count += 1
            in_func = True
        elif content[i] == '}':
            bracket_count -= 1
            if in_func and bracket_count == 0:
                end_pos = i + 1
                break
    
    if end_pos != -1:
        return content[:start_pos] + new_code + content[end_pos:]
    return content

with open("Code.gs", "r", encoding="utf-8") as f:
    code = f.read()

new_handleWallReplyNew = """function handleWallReplyNew(payload) {
  const comment = payload.object || {};
  const commentDate = new Date(comment.date * 1000); 

  if (comment.from_id < 0) return; 

  const cache = CacheService.getScriptCache();
  const cacheKey = "REPLY_PROCESSED_" + comment.id;
  if (cache.get(cacheKey)) return;
  cache.put(cacheKey, "true", 300); 

  if (isBidExists(comment.id)) return;

  const ownerId = payload.group_id || getVkGroupId(); 
  const postKey = `-${ownerId}_${comment.post_id}`; 
  
  const lot = findLotByPostId(postKey);
  if (!lot) return;

  if (lot.status !== "active" && lot.status !== "Активен") {
    Monitoring.recordEvent('HANDLE_WALL_REPLY_LOT_INACTIVE', { lot_id: lot.lot_id, status: lot.status });
    return;
  }

  const bid = parseBid(comment.text || "");
  const userId = String(comment.from_id);
  if (!bid) return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey); 
    
    const validationResult = enhancedValidateBid(bid, currentLot, userId, commentDate);
    const postId = parsePostKey(postKey).postId;

    if (!validationResult.isValid) {
      const errorMessage = `Ставка ${bid}₽ не принята. ${validationResult.reason}`;
      try {
        if (!checkIfBotReplied(postId, comment.id)) {
          replyToComment(postId, comment.id, errorMessage);
        }
      } catch (e) {
        logError("reply_invalid_bid", e);
      }
      return;
    }

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
    
    const isTestMode = getSetting('test_mode_enabled') === 'ВКЛ';
    if (!isTestMode) {
      const AUCTION_EXTENSION_DURATION_MINUTES = 10;
      if (currentLot.deadline) {
        const originalDeadline = parseRussianDate(currentLot.deadline);
        const timeUntilDeadline = (originalDeadline.getTime() - commentDate.getTime()) / (1000 * 60);
        if (timeUntilDeadline <= 10) {
          const newDeadline = new Date(commentDate.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);
          updateLot(currentLot.lot_id, { deadline: newDeadline });
          logInfo(`🔥 АНТИ-СНАЙПЕР: Дедлайн сдвинут до ${newDeadline.toLocaleString()}`);
        }
      }
    }

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
}"""

new_validateBid = """function validateBid(bid, lot, commentDate) {
  const checkTime = commentDate || new Date(); 
  const deadlineDate = parseRussianDate(lot.deadline);
  
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
}"""

new_enhancedValidateBid = """function enhancedValidateBid(bid, lot, userId, commentDate) {
  const standard = validateBid(bid, lot, commentDate);
  if (!standard.isValid) return standard;
  if (getSetting('subscription_check_enabled') === 'ВКЛ' && !checkUserSubscription(userId)) {
    return { isValid: false, reason: buildSubscriptionRequiredMessage({ lot_name: lot.name }) };
  }
  return { isValid: true, reason: null };
}"""

new_setupTriggers = """function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("periodicSystemCheck").timeBased().everyMinutes(10).create();
  setupDailyMaintenance();
}"""

new_finalizeAuction = """function finalizeAuction() {
  const activeLots = getSheetData("Config").filter(row => (row.data.status === "active" || row.data.status === "Активен") && parseRussianDate(row.data.deadline) < new Date());
  const allWinnersDataForReport = [];
  const allUsers = getSheetData("Users");

  activeLots.forEach(row => {
    const currentLotRow = getSheetData("Config").find(r => r.data.lot_id === row.data.lot_id);
    if (!currentLotRow || (currentLotRow.data.status !== "active" && currentLotRow.data.status !== "Активен")) return;

    const lot = currentLotRow.data;
    const postId = parsePostKey(lot.post_id).postId;
    
    if (!lot.leader_id) {
      updateLot(lot.lot_id, { status: "Не продан" });
      postCommentToLot(postId, buildUnsoldLotCommentMessage());
    } else {
      const winnerId = String(lot.leader_id);
      const winnerName = getUserName(winnerId);

      appendRow("Orders", {
        order_id: `${lot.lot_id}-${winnerId}`,
        lot_id: lot.lot_id,
        lot_name: lot.name,
        post_id: lot.post_id,
        user_id: winnerId,
        win_date: new Date(),
        win_price: lot.current_price,
        status: 'Ожидает оплаты'
      });

      const existingUser = allUsers.find(u => String(u.data.user_id) === winnerId);
      if (existingUser) {
        updateRow("Users", existingUser.rowIndex, {
          last_win_date: new Date(),
          total_lots_won: (Number(existingUser.data.total_lots_won) || 0) + 1
        });
      } else {
        appendRow("Users", {
          user_id: winnerId, user_name: winnerName, first_win_date: new Date(),
          last_win_date: new Date(), total_lots_won: 1, total_lots_paid: 0,
          shipping_status: 'Готов к отправке'
        });
      }
      
      updateLot(lot.lot_id, { status: "Продан" });

      const bidsForWinner = getSheetData("Bids").filter(b => b.data.lot_id === lot.lot_id && b.data.user_id === lot.leader_id);
      if (bidsForWinner.length > 0) {
        const latestBid = bidsForWinner.reduce((latest, current) => new Date(current.data.timestamp) > new Date(latest.data.timestamp) ? current : latest);
        if (latestBid && latestBid.data.comment_id) {
          const formattedDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
          const winnerComment = buildWinnerCommentMessage({ date: formattedDate, user_id: lot.leader_id, user_name: winnerName });
          if (!checkIfBotReplied(postId, latestBid.data.comment_id)) {
            replyToComment(postId, latestBid.data.comment_id, winnerComment);
          }
        }
      }

      allWinnersDataForReport.push({ 
          lot_id: lot.lot_id, name: lot.name, price: lot.current_price, 
          winner_id: winnerId, winner_name: winnerName, attachment_id: lot.attachment_id 
      });
    }
    Utilities.sleep(1000);
  });

  sendAllSummaries();
}"""

new_sendAllSummaries = """function sendAllSummaries() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const dateKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const propKey = "SUMMARY_SENT_" + dateKey;
  if (props.getProperty(propKey) === "true") return;
  const allLots = getSheetData("Config");
  const activeCount = allLots.filter(l => l.data.status === "active" || l.data.status === "Активен").length;
  if (activeCount > 0) return;
  const soldToday = allLots.filter(l => l.data.status === "Продан");
  if (soldToday.length === 0) return;
  const winnersMap = {};
  soldToday.forEach(lot => {
    const userId = String(lot.data.leader_id);
    if (!winnersMap[userId]) winnersMap[userId] = [];
    winnersMap[userId].push(lot.data);
  });
  const winnersListForReport = [];
  for (const userId in winnersMap) {
    const summary = buildUserOrderSummary(userId);
    if (!summary.startsWith("У вас нет")) sendMessage(userId, summary);
    winnersMap[userId].forEach(lot => {
      winnersListForReport.push({
        lot_id: lot.lot_id, name: lot.name, price: lot.current_price,
        winner_id: userId, winner_name: getUserName(userId), attachment_id: lot.attachment_id
      });
    });
    Utilities.sleep(500);
  }
  if (winnersListForReport.length > 0) sendAdminReport(winnersListForReport);
  props.setProperty(propKey, "true");
}"""

code = replace_function(code, "handleWallReplyNew", new_handleWallReplyNew)
code = replace_function(code, "validateBid", new_validateBid)
code = replace_function(code, "enhancedValidateBid", new_enhancedValidateBid)
code = replace_function(code, "setupTriggers", new_setupTriggers)
code = replace_function(code, "finalizeAuction", new_finalizeAuction)

if "function sendAllSummaries" not in code:
    code += "\\n\\n" + new_sendAllSummaries

with open("Code.gs", "w", encoding="utf-8") as f:
    f.write(code)
print("Merge complete.")
