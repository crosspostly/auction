function doGet(e) {
  // Этот тест - главный способ проверить, что скрипт развернут правильно.
  // Откройте URL веб-приложения в режиме инкогнито.
  // Если вы видите этот текст - значит, URL рабочий и доступ есть у всех ("Anyone").
  // Если видите страницу входа Google - значит, доступ НЕ "Anyone".
  return ContentService.createTextOutput("Сервер жив. Настройки доступа верные.").setMimeType(ContentService.MimeType.TEXT);
}
/**
 * Handles incoming POST requests from the VK Callback API.
 * Immediately returns a response to VK to prevent timeouts and queues the event for processing.
 */
function doPost(e) {
  try {
    // Debug log as requested by the user
    logInfo('📨 doPost called', {
      hasPostData: !!e.postData,
      contentLength: e.postData ? e.postData.length : 0,
      contents: e.postData ? e.postData.contents.substring(0, 500) : 'none' // Log only first 500 chars
    });

    const data = JSON.parse(e.postData.contents);

    // For confirmation requests, reply immediately with the confirmation code.
        if (data.type === 'confirmation') {
          const groupId = String(data.group_id);
          const cache = CacheService.getScriptCache();
          const codeFromCache = cache.get("CONFIRM_" + groupId);
          const codeFromProps = PropertiesService.getScriptProperties().getProperty("CONFIRMATION_CODE");
          const codeToReturn = codeFromCache || codeFromProps;

          logInfo("❗ Confirmation Handshake Attempt", {
            "1_RAW_REQUEST_FROM_VK": e.postData.contents,
            "2_PARSED_GROUP_ID": groupId,
            "3_CODE_FOUND_IN_CACHE": codeFromCache || "null",
            "4_CODE_FOUND_IN_PROPS": codeFromProps || "null",
            "5_FINAL_CODE_TO_RETURN": codeToReturn || "null or empty"
          });

          return ContentService.createTextOutput(String(codeToReturn || "").trim()).setMimeType(ContentService.MimeType.TEXT);
        }

    // For all other events, enqueue them and immediately return "ok".
    if (data.type) {
      enqueueEvent(e.postData.contents);
    }
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    logError('doPost_critical', error, e.postData ? e.postData.contents : 'no post data');
    // Always return "ok" even on error, so VK doesn't disable the server.
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  }
}

function onOpen() {

  const ui = SpreadsheetApp.getUi();

  ui.createMenu('VK Auction')

    .addItem('🚀 Мастер настройки', 'runSetupWizard')

    .addItem('🔐 Настройки авторизации', 'showAuthSettings')

    .addSeparator()

    .addItem('📖 Открыть инструкцию', 'showInstructions')

    .addSeparator()

    .addSubMenu(ui.createMenu('🛠️ Вид таблицы')

      .addItem('👁️ Показать всё', 'showAllSheets')

      .addItem('🙈 Скрыть системное', 'hideSystemSheets'))

        .addSubMenu(ui.createMenu('⚠️ Ручное управление')

          .addItem('🏁 Завершить аукцион', 'finalizeAuction')

          .addItem('📨 Отправить очередь', 'processNotificationQueue')

          .addItem('🔄 Сбросить триггеры', 'setupTriggers'))

        .addSeparator()

        .addSubMenu(ui.createMenu('🤖 СИМУЛЯТОР')

          .addItem('▶️ Запустить один цикл симуляции', 'runSingleSimulation')

          .addItem('⏰ Включить ежечасный запуск (макс. 5)', 'setupHourlySimulation')

          .addItem('🛑 Остановить ежечасный запуск', 'stopSimulation')

          .addItem('🗑️ Сбросить счетчик постов', 'resetSimulationCounter'))

        .addToUi();

    }

function showAllSheets() { toggleSystemSheets(false); }
function hideSystemSheets() { toggleSystemSheets(true); }

function runSetupWizard() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Мастер настройки', 'Создать листы, заполнить настройки и включить триггеры?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  try {
    setupSheets();
    createDemoData();
    setupTriggers();
    logInfo("Мастер настройки выполнен");
    ui.alert('✅ Готово!');
  } catch (e) { logError("setup_wizard", e); ui.alert('❌ Ошибка: ' + e.message); }
}

function showInstructions() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Instructions').setTitle('Инструкция')); }
function showAuthSettings() { SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutputFromFile('Login').setWidth(350).setHeight(300), 'Вход'); }
function openSettingsDialog() { SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutputFromFile('AuthSettings').setWidth(450).setHeight(650), 'Настройки'); }

function getAuthStatus() {
  const props = PropertiesService.getScriptProperties();
  const blockedUntil = Number(props.getProperty('AUTH_BLOCKED_UNTIL') || 0);
  if (blockedUntil > new Date().getTime()) return { isBlocked: true, waitHours: ((blockedUntil - new Date().getTime()) / (60 * 60 * 1000)).toFixed(1) + ' ч.' };
  return { isBlocked: false, hasPassword: !!props.getProperty('ADMIN_PASSWORD') };
}

function verifyPassword(pass) {
  const props = PropertiesService.getScriptProperties();
  if (pass === props.getProperty('ADMIN_PASSWORD')) { props.deleteProperty('AUTH_ATTEMPTS'); return { success: true }; }
  const attempts = Number(props.getProperty('AUTH_ATTEMPTS') || 0) + 1;
  if (attempts >= 5) { props.setProperty('AUTH_BLOCKED_UNTIL', String(new Date().getTime() + 6 * 60 * 60 * 1000)); props.setProperty('AUTH_ATTEMPTS', '0'); return { success: false, message: '⛔ Блокировка 6 ч.', blocked: true }; }
  props.setProperty('AUTH_ATTEMPTS', String(attempts)); return { success: false, message: `Неверно. Попыток: ${5 - attempts}` };
}

function setPassword(pass) { PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', pass); return true; }

function saveAuthSettings(form) {
  const props = PropertiesService.getScriptProperties();
  const updates = {};
  if (form.vk_token) updates.VK_TOKEN = form.vk_token;
  if (form.group_id) updates.GROUP_ID = String(form.group_id).replace('-', '');
  if (form.web_app_url) updates.WEB_APP_URL = form.web_app_url;
  if (form.payment_phone) updates.PAYMENT_PHONE = form.payment_phone;
  if (form.payment_bank) updates.PAYMENT_BANK = form.payment_bank;
  if (form.admin_password) updates.ADMIN_PASSWORD = form.admin_password;
  props.setProperties(updates);
  CacheService.getScriptCache().remove('settings');
  logInfo("Настройки обновлены");
  return 'Настройки сохранены!';
}

function getPublicAuthSettings() {

  const props = PropertiesService.getScriptProperties().getProperties();

  return { group_id: props.GROUP_ID || '', web_app_url: props.WEB_APP_URL || '', payment_phone: props.PAYMENT_PHONE || '', payment_bank: props.PAYMENT_BANK || '' };

}

function connectBotToVk(formUrl) {
  try {
    // Теперь setupCallbackServerAutomatic получает URL из формы (или дефолта)
    const result = setupCallbackServerAutomatic(formUrl);
    logInfo("Бот подключен к ВК", result);
    return `✅ Успешно!`;
  } catch (e) { logError("connect_vk", e); throw new Error(e.message); }
}

function diagnosticTest() {

  const ui = SpreadsheetApp.getUi();

  try {

    const groupId = getVkGroupId();

    const groupInfoResponse = callVk("groups.getById", { group_id: groupId });

    const groupInfo = groupInfoResponse ? groupInfoResponse.response : null;

    const mockEvent = { postData: { contents: JSON.stringify({ type: 'confirmation', group_id: groupId }) } };

    const response = doPost(mockEvent);

    const code = response.getContent();

    ui.alert('Диагностика', `✅ ВК: "${groupInfo ? groupInfo[0].name : 'НЕ НАЙДЕНО'}"\n🤖 Код Handshake: "${code}"\n🚀 Сигнал отправлен в Журнал.`, ui.ButtonSet.OK);

    handleWallPostNew({ type: "wall_post_new", object: { id: 999, owner_id: -groupId, text: "#аукцион\nТест\n№777\nСтарт 777" } });

  } catch (e) { ui.alert('❌ Ошибка: ' + e.message); }

}

function routeEvent(payload) {
  switch (payload.type) {
    case "wall_post_new": handleWallPostNew(payload); break;
    case "wall_reply_new": handleWallReplyNew(payload); break;
    case "message_new": handleMessageNew(payload); break;
  }
}

function handleWallPostNew(payload) {

  const text = payload.object && payload.object.text ? String(payload.object.text) : "";

  if (!/#аукцион/i.test(text)) return;

  const lot = parseLotFromPost(text);

  if (!lot) { 

    Monitoring.recordEvent('LOT_PARSE_FAILED', { text: text.substring(0, 100) });

    logInfo("Пост не распаршен", text.substring(0, 50)); 

    return; 

  }

  const newLotData = { lot_id: String(lot.lot_id), post_id: `${payload.object.owner_id}_${payload.object.id}`, name: lot.name, start_price: lot.start_price, current_price: lot.start_price, leader_id: "", status: "active", created_at: new Date(), deadline: lot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000), bid_step: lot.bidStep || 0 };

  upsertLot(newLotData);

  Monitoring.recordEvent('LOT_CREATED', newLotData);

  logInfo(`Лот №${lot.lot_id} добавлен`);

}

function parseLotFromPost(text) {

  try {

    // 1. Check for the main keyword

    if (!/#аукцион/i.test(text)) return null;

    // 2. Find Lot Number (more flexible)

            const lotNumberMatch = text.match(/(?:[#аукцион\w@]+\s*)?(?:№|No\.|Number)\s*([a-zA-Z0-9_]+)/i);

            if (!lotNumberMatch) return null;

            const lotId = lotNumberMatch[1];

            let name = "Лот №" + lotId; // Default name

            let startPrice = 0;

            let bidStep = 0; // New variable for bid step

            let deadline = null;

            const lines = text.split('\n').map(l => l.trim()).filter(l => l);

            for (const line of lines) {

              // 3. Find Lot Name

              const nameMatch = line.match(/^(?:Лот|🎁Лот)\s*[-—]?\s*(.+)/i);

              if (nameMatch) {

                name = nameMatch[1].trim();

                                continue;

                              }

                              // 5. Find Deadline

                              const deadlineMatch = line.match(/(?:Дедлайн|Дата окончания аукциона)\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*в\s*(\d{1,2}:\d{2})\s*по МСК/i);

                              if (deadlineMatch) {

                                const [day, month, year] = deadlineMatch[1].split('.').map(Number);

                                const [hours, minutes] = deadlineMatch[2].split(':').map(Number);

                                // Note: Months are 0-indexed in JavaScript Date objects, so we subtract 1 from the month.

                                deadline = new Date(year, month - 1, day, hours, minutes);

                                continue;

                              }

              // 4. Find Start Price and Step (more flexible)

              const priceMatch = line.match(/^(?:👀Старт|Старт)\s*(\d+)\s*р(?:\s+и\s+шаг\s*[-—]?\s*(\d+)\s*р?)?/i);

              if (priceMatch) {

                startPrice = Number(priceMatch[1]);

                if (priceMatch[2]) {

                  bidStep = Number(priceMatch[2]);

                }

                continue;

              }

        continue;

      }

    // 5. Find Deadline (already robust)

    deadline = parseDeadline(text);

    const parsedLot = {

      lot_id: lotId,

      name: name.substring(0, 150), // Increased length

      start_price: startPrice,

      deadline: deadline

    };

    Monitoring.recordEvent('LOT_PARSE_SUCCESS', { raw_text_preview: text.substring(0,100), parsed: parsedLot });

    return parsedLot;

  } catch (e) {

    Monitoring.recordEvent('LOT_PARSE_CRITICAL_ERROR', { error: e.message, text: text.substring(0,200) });

    return null;

  }

}

function parseDeadline(text) {
  const dateMatch = text.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!dateMatch) return null;
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  let year = dateMatch[3] ? Number(dateMatch[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const timeMatch = text.match(/(\d{1,2})[:.](\d{2})/);
  return new Date(year, month, day, timeMatch ? Number(timeMatch[1]) : 21, timeMatch ? Number(timeMatch[2]) : 0);
}

function handleWallReplyNew(payload) {

  const comment = payload.object || {};

  const postKey = `${comment.owner_id}_${comment.post_id}`;

  const lot = findLotByPostId(postKey);

  if (!lot || lot.status !== "active") return;

  const bid = parseBid(comment.text || "");

  const userId = String(comment.from_id);

  Monitoring.recordEvent('BID_RECEIVED', { lot_id: lot.lot_id, user_id: userId, raw_text: comment.text, parsed_bid: bid });

  if (!bid) {
    logInfo("Комментарий не распознан как ставка", { lot_id: lot.lot_id, user_id: userId, raw_text: comment.text });
    return;
  }

  const lock = LockService.getScriptLock();

  try {

    lock.waitLock(5000);

    const currentLot = findLotByPostId(postKey); // Re-fetch lot inside lock

    if (!currentLot || currentLot.status !== "active") return;

    const validationResult = validateBid(bid, currentLot);

    Monitoring.recordEvent('BID_VALIDATED', { lot_id: currentLot.lot_id, user_id: userId, bid: bid, ...validationResult });

    if (!validationResult.isValid) {
      if (validationResult.reason === `Ставка должна быть выше ${currentLot.current_price}` || validationResult.reason === `Ставка должна быть выше ${currentLot.start_price}`) {
        const notification = {
          user_id: userId,
          type: "low_bid",
          payload: {
            lot_id: currentLot.lot_id,
            lot_name: currentLot.name,
            current_bid: currentLot.current_price,
            your_bid: bid,
            post_id: postKey
          }
        };
        queueNotification(notification);
        Monitoring.recordEvent('LOW_BID_NOTIFICATION_QUEUED', notification);
      }
      return;
    }
    // Записываем ставку в лист "Ставки" до обновления "Лотов"
    appendRow("Bids", {
      bid_id: Utilities.getUuid(),
      lot_id: currentLot.lot_id,
      user_id: userId,
      bid_amount: bid,
      timestamp: new Date(),
      comment_id: comment.id // Сохраняем ID комментария VK
    });
    Monitoring.recordEvent('BID_RECORDED', { lot_id: currentLot.lot_id, user_id: userId, bid_amount: bid, comment_id: comment.id });
    updateLot(currentLot.lot_id, { current_price: bid, leader_id: userId });

    Monitoring.recordEvent('LEADER_UPDATED', { lot_id: currentLot.lot_id, new_leader_id: userId, new_price: bid });

        logInfo(`Ставка ${bid} лот ${currentLot.lot_id}`);

        const AUCTION_EXTENSION_WINDOW_MINUTES = 10; // Окно продления (в минутах)

        const AUCTION_EXTENSION_DURATION_MINUTES = 10; // Длительность продления (в минутах)

        if (currentLot.deadline) {

          const now = new Date();

          const deadlineTime = new Date(currentLot.deadline);

          const timeUntilDeadline = (deadlineTime.getTime() - now.getTime()) / (1000 * 60); // Минуты

          if (timeUntilDeadline <= AUCTION_EXTENSION_WINDOW_MINUTES && timeUntilDeadline > 0) {

            // Продлеваем дедлайн

            const newDeadline = new Date(deadlineTime.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);

            updateLot(currentLot.lot_id, { deadline: newDeadline });

            Monitoring.recordEvent('AUCTION_EXTENDED', { lot_id: currentLot.lot_id, old_deadline: deadlineTime.toISOString(), new_deadline: newDeadline.toISOString(), reason: 'bid_before_deadline' });

            logInfo(`Аукцион лота ${currentLot.lot_id} продлен до ${newDeadline.toLocaleString()}`);

          }

        }

        // Notify previous leader if they were outbid

    if (currentLot.leader_id && String(currentLot.leader_id) !== userId) {

      const notification = { user_id: currentLot.leader_id, type: "outbid", payload: { lot_id: currentLot.lot_id, lot_name: currentLot.name, new_bid: bid, post_id: postKey } };

      queueNotification(notification);

            Monitoring.recordEvent('OUTBID_NOTIFICATION_QUEUED', notification);

            // Отправляем комментарий под постом о перебитой ставке

            const outbidCommentMessage = `[id${currentLot.leader_id}|${getUserName(currentLot.leader_id)}], Ваша ставка перебита! Новая ставка: ${bid}₽`;

            postCommentToLot(parsePostKey(postKey).postId, outbidCommentMessage);

          }

  } finally {

    lock.releaseLock();

  }

}

function parseBid(text) {

  const match = String(text).match(/(?:^|\s)(\d+)(?:\s*₽)?(?:$|\s)/);

  return match ? Number(match[1]) : null;

}

function validateBid(bid, lot) {

  if (lot.deadline && new Date() > new Date(lot.deadline)) {

    return { isValid: false, reason: "Аукцион завершен" };

  }

    const settings = getSettings();

    if (settings.max_bid && bid > settings.max_bid) {

      return { isValid: false, reason: `Ставка превышает максимально допустимую (${settings.max_bid})` };

    }

    const currentPrice = Number(lot.current_price || lot.start_price || 0);

  if (bid <= currentPrice) {

    return { isValid: false, reason: `Ставка должна быть выше ${currentPrice}` };

  }

  if (settings.bid_step_enabled && (bid - Number(lot.start_price)) % Number(settings.bid_step || 50) !== 0) {

    return { isValid: false, reason: `Ставка не кратна шагу ${settings.bid_step}` };

  }

  return { isValid: true, reason: null };

}

function processNotificationQueue() {
  const rows = getSheetData("NotificationQueue");
  let sent = 0;
  for (const row of rows) {
    if (sent >= 20) break;
    if (row.data.status !== "pending") continue;
    try { sendNotification(row.data); updateNotificationStatus(row.data.queue_id, "sent", new Date()); sent++; Utilities.sleep(350); } 
    catch (error) { updateNotificationStatus(row.data.queue_id, "failed", new Date()); }
  }
}

function sendNotification(queueRow) {
  const payload = JSON.parse(queueRow.payload);
    if (queueRow.type === "outbid") sendMessage(queueRow.user_id, buildOutbidMessage(payload));
    else if (queueRow.type === "winner") sendMessage(queueRow.user_id, buildWinnerMessage(payload));
    else if (queueRow.type === "low_bid") sendMessage(queueRow.user_id, buildLowBidMessage(payload));
}

function buildOutbidMessage(p) { return `🔔 Ваша ставка перебита!\nЛот: ${p.lot_name}\nНовая ставка: ${p.new_bid}₽\nhttps://vk.com/wall${p.post_id}`; }
function buildWinnerMessage(p) { return `🎉 Вы выиграли лот ${p.lot_name} за ${p.price}₽!\nНапишите "АУКЦИОН".`; }
function buildLowBidMessage(p) { return `👋 Привет! Твоя ставка ${p.your_bid}₽ по лоту «${p.lot_name}» чуть ниже текущей цены ${p.current_bid}₽. Попробуй предложить больше, чтобы побороться за лот! 😉\nhttps://vk.com/wall${p.post_id}`; }

function finalizeAuction() {

  const activeLots = getSheetData("Config").filter(row => row.data.status === "active");

    Monitoring.recordEvent('AUCTION_FINALIZATION_STARTED', { active_lots_count: activeLots.length });

    const allWinnersData = []; // Объявляем массив для сбора данных о победителях

    activeLots.forEach(row => {

      const lot = row.data;

      const postId = parsePostKey(lot.post_id).postId;

      if (!lot.leader_id) { 

        updateLot(lot.lot_id, { status: "unsold" }); 
        postCommentToLot(postId, "❌ Лот не продан"); 
        Monitoring.recordEvent('LOT_UNSOLD', { lot_id: lot.lot_id });
      }
      else {
        const winnerData = { lot_id: lot.lot_id, name: lot.name, price: lot.current_price, winner_id: lot.leader_id, winner_name: getUserName(lot.leader_id), won_at: new Date(), status: "pending_contact" };
        allWinnersData.push(winnerData); // Добавляем данные победителя в массив
        const notification = { user_id: lot.leader_id, type: "winner", payload: { lot_id: lot.lot_id, lot_name: lot.name, price: lot.current_price } };
        queueNotification(notification);
        const today = new Date();
        const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
        postCommentToLot(postId, `Поздравляем с победой в аукционе за миниатюру! [id${lot.leader_id}|${getUserName(lot.leader_id)}] Напишите в сообщения группы "Аукцион (${formattedDate})", чтобы забрать свой лот`);
        updateLot(lot.lot_id, { status: "sold" });
        Monitoring.recordEvent('WINNER_DECLARED', winnerData);
      }
    });

    // Отправляем отчет администраторам после обработки всех лотов
    if (allWinnersData.length > 0) {
      sendAdminReport(allWinnersData);

        }

      }

      /**

       * Отправляет отчет о победителях администраторам группы.

       * @param {Array<Object>} winners Массив объектов победителей.

       */

      function sendAdminReport(winners) {
        const settings = getSettings();
        const adminIdsString = settings.ADMIN_IDS;
        if (!adminIdsString || adminIdsString.trim() === "") {
          logInfo("Отчет администраторам не отправлен: ADMIN_IDS не указаны в настройках.");
          return;
        }
        const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
        if (adminIds.length === 0) {
          logInfo("Отчет администраторам не отправлен: ADMIN_IDS пусты после парсинга.");
          return;
        }
        // Группируем победителей по пользователю
        const winnersGroupedByUser = winners.reduce((acc, winner) => {
          if (!acc[winner.winner_id]) {
            acc[winner.winner_id] = {
              name: winner.winner_name,
              lots: []
            };
          }
          acc[winner.winner_id].lots.push({
            lot_id: winner.lot_id,
            name: winner.name,
            price: winner.price
          });
          return acc;
        }, {});
        let reportMessage = `🏁 *Отчет о завершении аукциона от ${new Date().toLocaleString()}* 🏁\n\n`;
        if (Object.keys(winnersGroupedByUser).length === 0) {
          reportMessage += "К сожалению, в этом аукционе победителей нет.\n";
        } else {
          for (const userId in winnersGroupedByUser) {
            const winner = winnersGroupedByUser[userId];
            reportMessage += `👤 *${winner.name}* ([id${userId}|${winner.name}])\n`;
            winner.lots.forEach(lot => {
              reportMessage += `  - Лот №${lot.lot_id}: «${lot.name}» - *${lot.price}₽*\n`;
            });
            reportMessage += "\n";
          }
        }
        reportMessage += "----------------------------------------\n";
        reportMessage += `Общее количество проданных лотов: ${winners.length}\n`;
        reportMessage += `Общая сумма продаж: ${winners.reduce((sum, w) => sum + w.price, 0)}₽\n`;
        // Отправляем каждому администратору
        adminIds.forEach(adminId => {
          try {
            sendMessage(adminId, reportMessage); // Предполагается наличие функции sendMessage(userId, message)
            logInfo(`Отчет администратору ${adminId} отправлен.`);
          } catch (e) {
            logError('sendAdminReport_send_failed', e, { adminId: adminId, report: reportMessage });
          }
        });
        Monitoring.recordEvent('ADMIN_REPORT_SENT', { recipient_ids: adminIds, report_summary: reportMessage.substring(0, 200) });
      }

      function setupSheets() { Object.keys(SHEETS).forEach(name => getSheet(name)); }
/**
 * Deletes all existing triggers and creates new ones for the script.
 * Includes a trigger for the new event queue processing.
 */
function setupTriggers() {
  // Delete all existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Trigger for processing the notification queue every minute
  ScriptApp.newTrigger("processNotificationQueue").timeBased().everyMinutes(1).create();

  // Trigger for processing the new event queue every minute
  ScriptApp.newTrigger("processEventQueue").timeBased().everyMinutes(1).create();

  // Trigger for finalizing the auction on a schedule
  ScriptApp.newTrigger("finalizeAuction").timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(21).create();
}
function buildPostKey(ownerId, postId) { return `${ownerId}_${postId}`; }
function parsePostKey(postKey) {
  const parts = String(postKey).split("_");
  return parts.length === 2 ? { ownerId: Number(parts[0]), postId: Number(parts[1]) } : { ownerId: null, postId: Number(postKey) };
}

// Вспомогательная функция для тестового фреймворка
function getSetting(key) {
  const settings = getSettings();
  return settings[key];
}

// Тестовая функция для VK API
function testVkApiConnection() {
  const ui = SpreadsheetApp.getUi();
  const results = [];
  try {
    // Получаем настройки
    const settings = getSettings();
    const groupId = getVkGroupId();
    const webAppUrl = settings.WEB_APP_URL || ScriptApp.getService().getUrl();
    // 1. Проверка информации о группе
    let groupInfo;
    try {
      groupInfo = callVk('groups.getById', { group_id: groupId });
      if (groupInfo && groupInfo.response && groupInfo.response.length > 0) {
        results.push('✅ Группа: ' + groupInfo.response[0].name);
      } else if (groupInfo && groupInfo.response && groupInfo.response.length === 0) {
        results.push('❌ Группа с ID ' + groupId + ' не найдена.');
      } else if (groupInfo && groupInfo.error) {
        results.push('❌ Ошибка группы: ' + groupInfo.error.error_msg);
      } else {
        results.push('❌ Нет ответа от VK API при запросе информации о группе.');
      }
    } catch (e) {
      results.push('❌ Исключение при проверке группы: ' + e.message);
      logError('testVkApiConnection_groupInfo', e);
    }
    // 2. Проверка Callback серверов
    results.push('\n--- Проверка Callback Сервера ---');
    results.push('ℹ️ URL в настройках: ' + webAppUrl);
    let servers;
    try {
      servers = callVk('groups.getCallbackServers', { group_id: groupId });
      if (servers && servers.response && servers.response.items) {
        results.push('📡 Всего серверов в ВК: ' + servers.response.count);
        const myServer = servers.response.items.find(s => s.url === webAppUrl);
        if (myServer) {
          results.push('✅ Ваш сервер НАЙДЕН в списке VK!');
          results.push('  Статус: ' + myServer.status);
        } else {
          results.push('❌ ВНИМАНИЕ: URL из настроек НЕ НАЙДЕН среди серверов ВК!');
        }
      } else {
        results.push('⚠️ Не удалось получить список серверов от ВК.');
      }
    } catch (e) {
      results.push('❌ Исключение при проверке серверов: ' + e.message);
      logError('testVkApiConnection_servers', e);
    }
    // 3. Проверка токена
    results.push('\n--- Проверка токена ---');
    if (settings.VK_TOKEN) {
      results.push('✅ Токен установлен');
    } else {
      results.push('❌ Токен НЕ установлен');
    }
    ui.alert('Результаты тестирования:\n\n' + results.join('\n'));
  } catch (e) {
    ui.alert('❌ Критическая ошибка теста:\n' + e.message + '\n\n' + results.join('\n'));
    logError('testVkApiConnection', e, results);
  }
}
