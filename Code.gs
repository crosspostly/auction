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



/**

 * Adds a new event to the EventQueue sheet for asynchronous processing.

 * @param {string} payload The JSON string payload from the VK event.

 */

function enqueueEvent(payload) {

  try {

    appendRow("EventQueue", {

      eventId: Utilities.getUuid(),

      payload: payload,

      status: "pending",

      receivedAt: new Date()

    });

  } catch (e) {

    logError('enqueueEvent_failed', e, payload);

  }

}



/**

 * Processes events from the EventQueue sheet.

 * This function is meant to be run by a time-based trigger.

 */

function processEventQueue() {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {

    console.log("processEventQueue is already running.");

    return;

  }

  

  try {

    const events = getSheetData("EventQueue");

    const pendingEvents = events.filter(r => r.data.status === 'pending');



    for (const event of pendingEvents) {

      try {

        const payload = JSON.parse(event.data.payload);

        routeEvent(payload); // Process the event

        updateRow("EventQueue", event.rowIndex, { status: "processed" });

      } catch (e) {

        logError('processEvent_failed', e, event.data.payload);

        updateRow("EventQueue", event.rowIndex, { status: "failed" });

      }

    }

  } finally {

    lock.releaseLock();

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

    const groupInfo = callVkApi("groups.getById", { group_id: groupId });

    const mockEvent = { postData: { contents: JSON.stringify({ type: 'confirmation', group_id: groupId }) } };

    const response = doPost(mockEvent);

    const code = response.getContent();

    ui.alert('Диагностика', `✅ ВК: "${groupInfo.groups[0].name}"\n🤖 Код Handshake: "${code}"\n🚀 Сигнал отправлен в Журнал.`, ui.ButtonSet.OK);

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



  const newLotData = { lot_id: String(lot.lot_id), post_id: `${payload.object.owner_id}_${payload.object.id}`, name: lot.name, start_price: lot.start_price, current_price: lot.start_price, leader_id: "", status: "active", created_at: new Date(), deadline: lot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000) };



  upsertLot(newLotData);



  Monitoring.recordEvent('LOT_CREATED', newLotData);



  logInfo(`Лот №${lot.lot_id} добавлен`);



}







function parseLotFromPost(text) {



  const lotNumberMatch = text.match(/№\s*(\d+|TEST_\d+)/i); // Updated to support TEST_ format



  if (!lotNumberMatch) return null;



  const lotId = lotNumberMatch[1];



  const startPriceMatch = text.match(/(?:старт|цена)\s*[:\-\s]?\s*(\d+)/i);



  const startPrice = startPriceMatch ? Number(startPriceMatch[1]) : 0;



  let name = "Лот №" + lotId;



  const lines = text.split('\n').map(l => l.trim()).filter(l => l);



  if (lines.length > 1) {



    const potentialName = lines.find(line => !line.includes('#') && !line.match(/№\d+|TEST_\d+/) && !line.match(/(?:старт|цена|шаг|дедлайн)/i));



    if (potentialName) name = potentialName;



  }



  return { lot_id: lotId, name: name.substring(0, 100), start_price: startPrice, deadline: parseDeadline(text) };



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







  if (!bid) return;



  



  const lock = LockService.getScriptLock();



  try {



    lock.waitLock(5000);



    const currentLot = findLotByPostId(postKey); // Re-fetch lot inside lock



    if (!currentLot || currentLot.status !== "active") return;



    



    const validationResult = validateBid(bid, currentLot);



    Monitoring.recordEvent('BID_VALIDATED', { lot_id: currentLot.lot_id, user_id: userId, bid: bid, ...validationResult });







    if (!validationResult.isValid) {



      return;



    }







    updateLot(currentLot.lot_id, { current_price: bid, leader_id: userId });



    Monitoring.recordEvent('LEADER_UPDATED', { lot_id: currentLot.lot_id, new_leader_id: userId, new_price: bid });



    logInfo(`Ставка ${bid} лот ${currentLot.lot_id}`);



    



    // Notify previous leader if they were outbid



    if (currentLot.leader_id && String(currentLot.leader_id) !== userId) {



      const notification = { user_id: currentLot.leader_id, type: "outbid", payload: { lot_id: currentLot.lot_id, lot_name: currentLot.name, new_bid: bid, post_id: postKey } };



      queueNotification(notification);



      Monitoring.recordEvent('OUTBID_NOTIFICATION_QUEUED', notification);



    }



  } finally {



    lock.releaseLock();



  }



}



function parseBid(text) {

  const match = String(text).match(/(\d+)\s*₽?/);

  return match ? Number(match[1]) : null;

}



function validateBid(bid, lot) {



  if (lot.deadline && new Date() > new Date(lot.deadline)) {



    return { isValid: false, reason: "Аукцион завершен" };



  }



  const settings = getSettings();



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

}



function buildOutbidMessage(p) { return `🔔 Ваша ставка перебита!\nЛот: ${p.lot_name}\nНовая ставка: ${p.new_bid}₽\nhttps://vk.com/wall${p.post_id}`; }

function buildWinnerMessage(p) { return `🎉 Вы выиграли лот ${p.lot_name} за ${p.price}₽!\nНапишите "АУКЦИОН".`; }



function finalizeAuction() {



  const activeLots = getSheetData("Config").filter(row => row.data.status === "active");



  Monitoring.recordEvent('AUCTION_FINALIZATION_STARTED', { active_lots_count: activeLots.length });



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



      const notification = { user_id: lot.leader_id, type: "winner", payload: { lot_id: lot.lot_id, lot_name: lot.name, price: lot.current_price } };



      queueNotification(notification);



      postCommentToLot(postId, `✅ Победитель: [id${lot.leader_id}|${getUserName(lot.leader_id)}] со ставкой ${lot.current_price}₽`);



      updateLot(lot.lot_id, { status: "sold" });



      Monitoring.recordEvent('WINNER_DECLARED', winnerData);



    }



  });



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

    CacheService.getScriptCache().remove('settings');

    const settings = getSettings();

    const groupId = settings['GROUP_ID'];

    const webAppUrl = settings['WEB_APP_URL'];



    if (!groupId) {

      ui.alert('❌ GROUP_ID не настроен');

      return;

    }

    if (!webAppUrl) {

      results.push('⚠️ WEB_APP_URL не настроен в таблице. Это может быть причиной проблем.');

    }



    // 1. Проверка информации о группе

    const groupInfo = callVk('groups.getById', { group_id: groupId });

    if (groupInfo && groupInfo.response && groupInfo.response.length > 0) {

      results.push('✅ Группа: ' + groupInfo.response[0].name);

    } else if (groupInfo && groupInfo.response && groupInfo.response.length === 0) {

      results.push('❌ Группа с ID ' + groupId + ' не найдена или токен не имеет к ней доступа.');

    } else if (groupInfo && groupInfo.error) {

      results.push('❌ Ошибка группы: ' + groupInfo.error.error_msg);

    } else {

      results.push('❌ Нет ответа от VK API при запросе информации о группе.');

    }



    // 2. Проверка Callback серверов

    results.push('\n--- Проверка Callback Сервера ---');

    results.push('ℹ️ URL в настройках: ' + webAppUrl);

    const servers = callVk('groups.getCallbackServers', { group_id: groupId });

    if (servers && servers.response && servers.response.items) {

      results.push('📡 Всего серверов в ВК: ' + servers.response.count);

      const myServer = servers.response.items.find(s => s.url === webAppUrl);

      if (myServer) {

        results.push('✅ Ваш сервер НАЙДЕН в списке VK!');

        results.push('  URL: ' + myServer.url);

        results.push('  Статус: ' + myServer.status);

      } else {

        results.push('❌ ВНИМАНИЕ: URL из настроек НЕ НАЙДЕН среди серверов, зарегистрированных в ВК!');

      }

    } else {

      results.push('⚠️ Не удалось получить список серверов от ВК.');

    }



    // 3. Проверка кодов и ключей

    results.push('\n--- Проверка Ключей ---');

    const confirmation = settings['CONFIRMATION_STRING'] || PropertiesService.getScriptProperties().getProperty("CONFIRMATION_CODE");

    if (confirmation) {

      results.push('✅ Код подтверждения (confirmation code) есть.');

    } else {

      results.push('⚠️ Код подтверждения (confirmation code) не настроен!');

    }

    

    const secret = settings['VK_SECRET'];

    if (secret) {

      results.push('✅ Секретный ключ (secret key) есть.');

    } else {

      results.push('⚠️ Секретный ключ (secret key) не настроен!');

    }



    // 4. Симуляция ответа сервера

    const testPayload = { type: 'confirmation', group_id: Number(groupId) };

    const mockRequest = { postData: { contents: JSON.stringify(testPayload) } };

    const response = doPost(mockRequest);

    const responseText = response.getContent();

    if (responseText === confirmation) {

      results.push('✅ Локальная проверка: doPost отвечает правильно.');

    } else {

      results.push('❌ Локальная проверка: doPost вернул неверный код!');

    }

    

    ui.alert('Результаты тестирования:\n\n' + results.join('\n'));

  } catch (e) {

    ui.alert('❌ Критическая ошибка теста:\n' + e.message + '\n\n' + results.join('\n'));

    logError('testVkApiConnection', e, results);

  }

}
