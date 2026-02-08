function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (error) {
    logError("webhook_parse", error, e && e.postData ? e.postData.contents : "");
    return ContentService.createTextOutput("ok");
  }

  if (payload.type === "confirmation") {
    const settings = getSettings();
    const confirmation = settings.confirmation_code || PropertiesService.getScriptProperties().getProperty("VK_CONFIRMATION_CODE") || "";
    return ContentService.createTextOutput(confirmation);
  }

  if (!isValidSecret(payload)) {
    logError("webhook_secret", new Error("Invalid callback secret"), payload);
    return ContentService.createTextOutput("forbidden");
  }

  safeExecute(function () {
    routeEvent(payload);
  }, "webhook_route", payload);

  return ContentService.createTextOutput("ok");
}

function isValidSecret(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("VK_SECRET") || "";
  if (!secret) {
    return true;
  }
  return payload.secret === secret;
}

function routeEvent(payload) {
  switch (payload.type) {
    case "wall_post_new":
      handleWallPostNew(payload);
      break;
    case "wall_reply_new":
      handleWallReplyNew(payload);
      break;
    case "message_new":
      handleMessageNew(payload);
      break;
    default:
      break;
  }
}

function handleWallPostNew(payload) {
  const text = payload.object && payload.object.text ? String(payload.object.text) : "";
  if (!/#аукцион/i.test(text)) {
    return;
  }
  const lot = parseLotFromPost(text);
  if (!lot) {
    logError("parse_lot", new Error("Unable to parse lot"), payload.object);
    return;
  }
  const postKey = buildPostKey(payload.object.owner_id, payload.object.id);
  upsertLot({
    lot_id: lot.lot_id,
    post_id: postKey,
    name: lot.name,
    start_price: lot.start_price,
    current_price: lot.start_price,
    leader_id: "",
    status: "active",
    created_at: new Date()
  });
}

function handleWallReplyNew(payload) {
  const comment = payload.object || {};
  const postKey = buildPostKey(comment.owner_id, comment.post_id);
  const lot = findLotByPostId(postKey);
  if (!lot || lot.status !== "active") {
    return;
  }
  const bid = parseBid(comment.text || "");
  if (!bid) {
    return;
  }
  const userId = comment.from_id;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey);
    if (!currentLot || currentLot.status !== "active") {
      return;
    }
    if (!validateBid(bid, currentLot)) {
      return;
    }
    const previousLeader = currentLot.leader_id;
    const previousPrice = Number(currentLot.current_price || currentLot.start_price || 0);
    recordBid({
      bid_id: generateId(),
      lot_id: currentLot.lot_id,
      user_id: userId,
      bid_amount: bid,
      timestamp: comment.date ? new Date(comment.date * 1000) : new Date(),
      comment_id: comment.id
    });
    updateLot(currentLot.lot_id, {
      current_price: bid,
      leader_id: userId
    });
    if (previousLeader && String(previousLeader) !== String(userId)) {
      queueNotification({
        user_id: previousLeader,
        type: "outbid",
        payload: {
          lot_id: currentLot.lot_id,
          lot_name: currentLot.name,
          previous_bid: previousPrice,
          new_bid: bid,
          new_leader_id: userId,
          post_id: postKey
        }
      });
    }
  } finally {
    lock.releaseLock();
  }
}

function handleMessageNew(payload) {
  const message = payload.object && payload.object.message ? payload.object.message : {};
  const text = message.text ? message.text.trim().toLowerCase() : "";
  if (!text) {
    return;
  }
  if (text.includes("копить")) {
    handleAccumulateCommand(message);
    return;
  }
  if (text.includes("аукцион")) {
    handleAuctionCommand(message);
  }
}

function handleAuctionCommand(message) {
  const userId = message.from_id;
  const winners = getSheetData("Winners");
  const userWins = winners.filter(row => {
    if (String(row.data.winner_id) !== String(userId)) {
      return false;
    }
    return ["pending_contact", "accumulating"].includes(String(row.data.status));
  });
  if (!userWins.length) {
    sendMessage(userId, "Вы не выиграли ни одного лота в последнем аукционе. 😔");
    return;
  }
  const settings = getSettings();
  const deliveryRaw = settings.delivery_rules || DEFAULT_SETTINGS.delivery_rules;
  let deliveryRules = deliveryRaw;
  if (typeof deliveryRaw === "string") {
    try {
      deliveryRules = JSON.parse(deliveryRaw);
    } catch (error) {
      deliveryRules = {};
    }
  }
  const itemCount = userWins.length;
  let deliveryCost = 0;
  if (itemCount <= 3) {
    deliveryCost = deliveryRules["1-3"] || 0;
  } else if (itemCount <= 6) {
    deliveryCost = deliveryRules["4-6"] || 0;
  } else {
    deliveryCost = deliveryRules["7+"] || 0;
  }
  const lotsTotalCost = userWins.reduce((sum, row) => sum + Number(row.data.price || 0), 0);
  const totalCost = lotsTotalCost + deliveryCost;
  const lotsList = userWins
    .map((row, index) => `${index + 1}. ${row.data.name} (#${row.data.lot_id}) — ${row.data.price}₽`)
    .join("\n");
  const template = settings.order_summary_template || DEFAULT_SETTINGS.order_summary_template;
  const messageText = template
    .replace("{LOTS_LIST}", lotsList)
    .replace("{LOTS_TOTAL}", lotsTotalCost)
    .replace("{DELIVERY_COST}", deliveryCost)
    .replace("{TOTAL_COST}", totalCost)
    .replace("{ITEM_COUNT}", itemCount)
    .replace("{PAYMENT_PHONE}", settings.payment_phone || "")
    .replace("{PAYMENT_BANK}", settings.payment_bank || "");
  sendMessage(userId, messageText);
  updateWinnersStatus(userId, "summary_sent");
}

function handleAccumulateCommand(message) {
  const userId = message.from_id;
  updateWinnersStatus(userId, "accumulating");
  sendMessage(
    userId,
    "✅ Отлично! Ваши фигурки отложены для накопления.\n\nПри следующем выигрыше доставка будет рассчитана сразу на все фигурки.\nКогда будете готовы оформить отправку — напишите снова \"АУКЦИОН\"."
  );
}

function parseLotFromPost(text) {
  const regex = /Лот\s+№?(\d+).*?\n.*?(\S.*?)\n.*?Цена:\s*(\d+)\s*₽/is;
  const match = regex.exec(text);
  if (!match) {
    return null;
  }
  return {
    lot_id: match[1],
    name: match[2].trim(),
    start_price: Number(match[3])
  };
}

function parseBid(text) {
  const match = String(text).match(/(\d+)\s*₽?/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function validateBid(bid, lot) {
  const settings = getSettings();
  const currentPrice = Number(lot.current_price || lot.start_price || 0);
  const startPrice = Number(lot.start_price || 0);
  if (bid <= currentPrice) {
    return false;
  }
  if (settings.bid_step_enabled) {
    const step = Number(settings.bid_step || 50);
    if (step > 0 && (bid - startPrice) % step !== 0) {
      return false;
    }
  }
  const minIncrement = Number(settings.min_bid_increment || 0);
  if (bid < currentPrice + minIncrement) {
    return false;
  }
  const maxBid = Number(settings.max_bid || 0);
  if (maxBid && bid > maxBid) {
    return false;
  }
  return true;
}

function processNotificationQueue() {
  const now = new Date();
  const rows = getSheetData("NotificationQueue");
  let sent = 0;
  const maxBatch = 20;
  for (const row of rows) {
    if (sent >= maxBatch) {
      break;
    }
    if (row.data.status !== "pending") {
      continue;
    }
    const sendAfter = row.data.send_after ? new Date(row.data.send_after) : null;
    if (sendAfter && sendAfter > now) {
      continue;
    }
    try {
      sendNotification(row.data);
      updateNotificationStatus(row.data.queue_id, "sent", new Date());
      sent += 1;
      Utilities.sleep(350);
    } catch (error) {
      updateNotificationStatus(row.data.queue_id, "failed", new Date());
      logError("notification_send", error, row.data);
    }
  }
}

function sendNotification(queueRow) {
  const payload = queueRow.payload ? JSON.parse(queueRow.payload) : {};
  switch (queueRow.type) {
    case "outbid":
      sendMessage(queueRow.user_id, buildOutbidMessage(payload));
      break;
    case "winner":
      sendMessage(queueRow.user_id, buildWinnerMessage(payload));
      break;
    default:
      break;
  }
}

function buildOutbidMessage(payload) {
  const leaderInfo = payload.new_leader_id ? getUsersInfo(payload.new_leader_id)[0] : null;
  const leaderName = leaderInfo ? `${leaderInfo.first_name} ${leaderInfo.last_name}` : "другой участник";
  const link = payload.post_id ? `https://vk.com/wall${payload.post_id}` : "";
  return `🔔 Ваша ставка перебита!\n\nЛот: ${payload.lot_name} (#${payload.lot_id})\nВаша ставка: ${payload.previous_bid}₽\nНовая ставка: ${payload.new_bid}₽ (от ${leaderName})\n\nСделайте новую ставку здесь: ${link}`;
}

function buildWinnerMessage(payload) {
  return `🎉 Поздравляем! Вы выиграли лот ${payload.lot_name} (#${payload.lot_id}) за ${payload.price}₽.\n\nНапишите "АУКЦИОН", чтобы получить сводку для оплаты.`;
}

function finalizeAuction() {
  const activeLots = getSheetData("Config").filter(row => row.data.status === "active");
  if (!activeLots.length) {
    return;
  }
  const existingWinners = getSheetData("Winners").reduce((acc, row) => {
    acc[String(row.data.lot_id)] = row.data;
    return acc;
  }, {});
  activeLots.forEach(row => {
    const lot = row.data;
    if (!lot.leader_id) {
      updateLotStatus(lot.lot_id, "unsold");
      safeExecute(function () {
        const postId = parsePostKey(lot.post_id).postId;
        postCommentToLot(postId, "❌ Лот не продан (не было ставок)");
      }, "finalize_comment", lot);
      return;
    }
    if (!existingWinners[String(lot.lot_id)]) {
      const winnerInfo = getUsersInfo(lot.leader_id)[0];
      const winnerName = winnerInfo ? `${winnerInfo.first_name} ${winnerInfo.last_name}` : "";
      recordWinner({
        lot_id: lot.lot_id,
        name: lot.name,
        price: lot.current_price,
        winner_id: lot.leader_id,
        winner_name: winnerName,
        won_at: new Date(),
        status: "pending_contact",
        delivery: "",
        paid: "",
        shipped: ""
      });
      queueNotification({
        user_id: lot.leader_id,
        type: "winner",
        payload: {
          lot_id: lot.lot_id,
          lot_name: lot.name,
          price: lot.current_price
        }
      });
      safeExecute(function () {
        const postId = parsePostKey(lot.post_id).postId;
        postCommentToLot(postId, `✅ Лот продан. Победитель: ${winnerName || "участник"}`);
      }, "finalize_comment", lot);
    }
    updateLotStatus(lot.lot_id, "sold");
  });
}

function setupSheets() {
  Object.keys(SHEETS).forEach(name => {
    getSheet(name);
  });
}

function setupTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("processNotificationQueue").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("finalizeAuction").timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(21).create();
}

function buildPostKey(ownerId, postId) {
  if (ownerId === undefined || ownerId === null) {
    return String(postId || "");
  }
  return `${ownerId}_${postId}`;
}

function parsePostKey(postKey) {
  const parts = String(postKey).split("_");
  if (parts.length === 2) {
    return { ownerId: Number(parts[0]), postId: Number(parts[1]) };
  }
  return { ownerId: null, postId: Number(postKey) };
}

function safeExecute(handler, source, payload) {
  try {
    handler();
  } catch (error) {
    logError(source, error, payload);
  }
}
