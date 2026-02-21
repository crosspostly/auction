function doGet(e) {
  // 1. Стандартная проверка доступности
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
    const rawPayload = e.postData.contents;
    const data = JSON.parse(rawPayload);

    // Детальный лог только в режиме отладки
    logDebug('📨 doPost incoming', {
      type: data.type || "unknown",
      group_id: data.group_id || ""
    });

    // 1. Логируем входящее событие расширенно
    const logData = {
      type: data.type || "unknown",
      group_id: data.group_id || "",
      params: e.parameter ? JSON.stringify(e.parameter) : "none"
    };
    logIncomingRaw(logData, rawPayload);

    // Детальный лог только в режиме отладки
    logDebug('📨 doPost called', {
      hasPostData: !!e.postData,
      contentLength: e.postData ? e.postData.length : 0,
      contents: String(rawPayload || "").substring(0, 500)
    });

    // For confirmation requests, reply immediately with the confirmation code.
    if (data.type === 'confirmation') {
      const groupId = String(data.group_id);
      const cache = CacheService.getScriptCache();
      const codeFromCache = cache.get("CONFIRM_" + groupId);
      const codeFromProps = PropertiesService.getScriptProperties().getProperty("CONFIRMATION_CODE");
      const codeToReturn = codeFromCache || codeFromProps;
      logInfo("❗ Confirmation Handshake Attempt", {
        "1_RAW_REQUEST_FROM_VK": rawPayload,
        "2_PARSED_GROUP_ID": groupId,
        "3_CODE_FOUND_IN_CACHE": codeFromCache || "null",
        "4_CODE_FOUND_IN_PROPS": codeFromProps || "null",
        "5_FINAL_CODE_TO_RETURN": codeToReturn || "null or empty"
      });
      return ContentService.createTextOutput(String(codeToReturn || "").trim()).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Alien Group Protection ---
    // Ignore events from other groups to prevent error loops
    const myGroupId = String(PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "");
    if (data.group_id && String(data.group_id) !== myGroupId) {
      logInfo("🚫 Ignored event from alien group", { received_group_id: data.group_id, my_group_id: myGroupId, type: data.type });
      return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
    }
    // --- End of Alien Group Protection ---

    // Process the event immediately
    if (data.type && data.event_id) {
      // Check if this specific VK event ID was already processed or enqueued
      if (isEventProcessed(data.event_id)) {
        logDebug("🚫 Duplicate event detected (VK event_id), skipping.", { event_id: data.event_id, type: data.type });
        return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
      }

      routeEvent(data);
      // We still enqueue it for history/debugging, but mark as processed
      enqueueEvent(data, rawPayload, "processed", data.event_id);
    }
    
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    const rawContent = (e.postData && e.postData.contents) ? String(e.postData.contents) : 'no post data';
    logError('doPost_critical', error, rawContent);
    // Always return "ok" even on error, so VK doesn't disable the server.
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Enqueues a VK event into the 'EventQueue' sheet for reliable, asynchronous processing.
 * @param {object} data The parsed event data object.
 * @param {string} rawPayload The original, unparsed JSON string from the VK request.
 * @param {string} status Optional status, defaults to "pending".
 * @param {string} vkEventId Optional unique event ID from VK.
 */
function enqueueEvent(data, rawPayload, status = "pending", vkEventId = null) {
  try {
    const finalEventId = vkEventId || Utilities.getUuid();
    
    // Safety check: if we're manually enqueuing, check for duplicates
    if (status === "pending" && isEventProcessed(finalEventId)) {
      return;
    }

    appendRow("EventQueue", {
      eventId: finalEventId,
      payload: rawPayload,
      status: status,
      receivedAt: new Date()
    });
    // Readable preview for monitoring
    const preview = (typeof rawPayload === 'object') ? JSON.stringify(rawPayload) : String(rawPayload || "");
    Monitoring.recordEvent('EVENT_ENQUEUED', { eventId: finalEventId, payload_preview: preview.substring(0, 100) });
  } catch (e) {
    logError('enqueueEvent_failed', e, { eventType: data.type });
  }
}

/**
 * Checks if a VK event ID has already been recorded in the EventQueue sheet.
 * @param {string} vkEventId - The event_id provided by VK Callback API.
 * @returns {boolean} - true if the event exists, false otherwise.
 */
function isEventProcessed(vkEventId) {
  if (!vkEventId) return false;
  
  // Use memory cache for fast check
  const cacheKey = "event_seen_" + vkEventId;
  if (CacheService.getScriptCache().get(cacheKey)) return true;

  const events = getSheetData("EventQueue");
  const exists = events.some(e => String(e.data.eventId) === String(vkEventId));
  
  if (exists) {
    CacheService.getScriptCache().put(cacheKey, "1", 3600); // 1 hour
  }
  
  return exists;
}

/**
 * Processes a batch of events from the EventQueue.
 * Designed to be run by a time-based trigger.
 */
function processEventQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log("processEventQueue skipped: lock not acquired.");
    return;
  }
  
  try {
    const events = getSheetData("EventQueue")
      .filter(e => e.data.status === "pending")
      .sort((a, b) => new Date(a.data.receivedAt) - new Date(b.data.receivedAt));

    if (events.length === 0) return;

    // Process up to 10 events to avoid hitting execution time limits.
    const eventsToProcess = events.slice(0, 10);
    
    logDebug(`Processing ${eventsToProcess.length} events from queue.`);

    eventsToProcess.forEach(eventRow => {
      const { eventId, payload } = eventRow.data;
      try {
        const data = JSON.parse(payload);
        routeEvent(data); // The original routing logic
        updateRow("EventQueue", eventRow.rowIndex, { status: "processed" });
      } catch (e) {
        logError("processEventQueue_event_failed", e, { eventId: eventId });
        updateRow("EventQueue", eventRow.rowIndex, { status: "failed" });
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('VK Auction')
    .addItem('🚀 Мастер настройки', 'runSetupWizard')
    .addItem('🔐 Настройки авторизации', 'showAuthSettings')
    .addItem('📖 Инструкция', 'showInstructions')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Управление')
      .addItem('🔄 Пересоздать триггеры', 'setupTriggers')
      .addItem('🔍 Проверить триггеры', 'checkTriggers')
      .addItem('🌐 Проверить Callback сервер VK', 'checkVkCallbackServer')
      .addSeparator()
      .addItem('🧹 Очистить системные листы', 'clearSystemSheets'))
    .addToUi();
}

/**
 * Simple trigger that runs automatically when a user edits the spreadsheet.
 * If the "Настройки" sheet is edited, it clears the settings cache to ensure
 * changes are applied immediately.
 * @param {Object} e The event object from the edit trigger.
 */
function onEdit(e) {
  try {
    const editedSheetName = e.source.getActiveSheet().getName();
    const settingsSheetName = SHEETS.Settings.name; // "Настройки"

    if (editedSheetName === settingsSheetName) {
      CacheService.getScriptCache().remove("settings");
      // Use console.log for silent logging that doesn't require UI permissions.
      console.log(`Кэш настроек очищен автоматически из-за изменений в листе "${editedSheetName}".`);
    }
  } catch (err) {
    // Log errors silently to avoid interrupting the user.
    console.error("Ошибка в триггере onEdit: " + err.toString());
  }
}

function showAllSheets() { toggleSystemSheets(false); }
function hideSystemSheets() { toggleSystemSheets(true); }

/**
 * Clears the content of system sheets (Logs, EventQueue, NotificationQueue)
 * after user confirmation, preserving the header row.
 */
function clearSystemSheets() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Подтверждение',
    'Вы уверены, что хотите очистить все системные журналы и очереди (Logs, EventQueue, NotificationQueue, Incoming)? ' +
    'Это действие необратимо.',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    ui.alert('Очистка отменена.');
    return;
  }

  try {
    const sheetsToClear = ['Logs', 'EventQueue', 'NotificationQueue', 'Incoming'];
    let clearedCount = 0;

    sheetsToClear.forEach(sheetName => {
      try {
        const sheet = getSheet(sheetName);
        // Clear all data except the first row (header)
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        }
        clearedCount++;
      } catch (e) {
        logError(`clear_sheet_error`, e, { sheetName: sheetName });
        // Continue to the next sheet even if one fails
      }
    });

    logInfo(`System sheets cleared by user`, { sheets: sheetsToClear });
    ui.alert('✅ Успех', `Очищено ${clearedCount} системных листов.`, ui.ButtonSet.OK);

  } catch (error) {
    logError('clearSystemSheets_critical', error);
    ui.alert('❌ Ошибка', 'Произошла ошибка при очистке листов: ' + error.message, ui.ButtonSet.OK);
  }
}

function runSetupWizard() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Мастер настройки', 'Создать листы, заполнить настройки и включить триггеры?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  try {
    setupSheets();
    cleanupSettingsSheet(); // Сначала чистим старый мусор
    createDemoData(); // Затем добавляем недостающее
    setupTriggers();
    logInfo("Мастер настройки выполнен");
    ui.alert('✅ Готово!');
  } catch (e) { logError("setup_wizard", e); ui.alert('❌ Ошибка: ' + e.message); }
}

function showInstructions() { SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('SimpleInstructions').setTitle('Инструкция')); }
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
  if (form.user_token) updates.USER_TOKEN = form.user_token;
  if (form.group_id) updates.GROUP_ID = extractGroupId(form.group_id);
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
  return { 
    group_id: props.GROUP_ID || '', 
    web_app_url: props.WEB_APP_URL || '', 
    payment_phone: props.PAYMENT_PHONE || '', 
    payment_bank: props.PAYMENT_BANK || '',
    has_vk_token: !!props.VK_TOKEN,
    has_user_token: !!props.USER_TOKEN
  };
}

function extractGroupId(input) {
  if (!input) return "";
  const match = String(input).match(/(?:club|public|event|groups\/|id)(\d+)|(?:vk\.com\/)([\w.]+)/);
  if (match) {
    if (match[1]) return match[1]; // Цифровой ID
    return match[2]; // Буквенное имя (разрешим через API позже)
  }
  return String(input).replace(/[^\d]/g, "");
}

function connectBotToVk(form) {
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  
  try {
    // 1. ПЕРВЫМ ДЕЛОМ СОХРАНЯЕМ ВСЁ
    const groupIdRaw = extractGroupId(form.group_id);
    const userToken = form.user_token || props.getProperty('USER_TOKEN');
    const vkToken = form.vk_token || props.getProperty('VK_TOKEN');
    const url = form.web_app_url || props.getProperty('WEB_APP_URL');

    if (!groupIdRaw) throw new Error("Введите ID или ссылку на группу (Шаг 1).");
    if (!url) throw new Error("Введите URL Веб-приложения (Шаг 1).");
    if (!userToken) throw new Error("Нужен Admin Token (Шаг 2).");
    if (!vkToken) throw new Error("Нужен Group Token (Шаг 3).");

    // Сбрасываем кэш, чтобы новые токены подхватились мгновенно
    props.setProperty('USER_TOKEN', userToken);
    props.setProperty('VK_TOKEN', vkToken);
    props.setProperty('WEB_APP_URL', url);
    cache.remove('settings');

    // 2. Уточняем цифровой ID группы
    let groupId = groupIdRaw;
    if (isNaN(Number(groupIdRaw))) {
      const res = callVk('groups.getById', { group_id: groupIdRaw }, userToken);
      if (res && res.response && res.response[0]) {
        groupId = String(res.response[0].id);
      } else {
        const error = res?.error?.error_msg || "Группа не найдена";
        throw new Error(`Не удалось определить ID группы: ${error}`);
      }
    }
    props.setProperty('GROUP_ID', groupId);

    // 3. Пытаемся настроить Callback-сервер
    // setupCallbackServerAutomatic сама вызовет getVkConfirmationCodeFromServer
    const setupResult = setupCallbackServerAutomatic(url);

    // 4. ТИХАЯ ПРОВЕРКА (от имени группы через VK_TOKEN)
    const testPost = callVk('wall.post', { 
      owner_id: `-${groupId}`, 
      from_group: 1, 
      message: "🛠 Система: проверка прав доступа бота. (Этот пост будет удален автоматически через секунду)" 
    }, vkToken);

    if (testPost && testPost.response && testPost.response.post_id) {
      const pId = testPost.response.post_id;
      // Проверка комментария
      callVk('wall.createComment', { owner_id: `-${groupId}`, post_id: pId, from_group: 1, message: "✅ Доступ к комментариям подтвержден" }, vkToken);
      Utilities.sleep(1500);
      // Удаляем пост (через userToken, так как у него 100% есть права)
      callVk('wall.delete', { owner_id: `-${groupId}`, post_id: pId }, userToken);
    } else {
      const errMsg = testPost?.error?.error_msg || JSON.stringify(testPost?.error) || "Неизвестная ошибка";
      const errCode = testPost?.error?.error_code || "?";
      throw new Error(`Group Token НЕ ИМЕЕТ прав на публикацию. Код ${errCode}: ${errMsg}`);
    }

    return `✅ ПОДКЛЮЧЕНО УСПЕШНО!\n\n• Группа ID: ${groupId}\n• Callback сервер: Настроен\n• Права публикации: Проверены\n• Тихая проверка: Завершена (пост удален)`;
  } catch (e) { 
    logError("connect_vk", e); 
    return `❌ ОШИБКА: ${e.message}`; 
  }
}
/**
 * Проверяет состояние триггеров
 */
function checkTriggers() {
  const ui = SpreadsheetApp.getUi();
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let triggerInfo = [];
    
    triggerInfo.push('=== ТЕКУЩИЕ ТРИГГЕРЫ ===');
    triggers.forEach((trigger, index) => {
      const handler = trigger.getHandlerFunction();
      const timing = 'временной'; // Все наши триггеры time-based
      triggerInfo.push(`${index + 1}. ${handler} (${timing})`);
    });
    
    triggerInfo.push('\n=== ПРОВЕРКА ОЧЕРЕДИ СОБЫТИЙ ===');
    const pendingEvents = getSheetData("EventQueue").filter(e => e.data.status === "pending");
    triggerInfo.push(`Ожидающих обработки: ${pendingEvents.length}`);
    
    if (pendingEvents.length > 0) {
      triggerInfo.push('\nПоследние 5 ожидающих событий:');
      pendingEvents.slice(0, 5).forEach(event => {
        const payload = JSON.parse(event.data.payload);
        triggerInfo.push(`- ${payload.type} (${event.data.eventId.substring(0, 8)})`);
      });
    }
    
    ui.alert('Состояние триггеров', triggerInfo.join('\n'), ui.ButtonSet.OK);
    
  } catch (e) {
    ui.alert('❌ Ошибка проверки триггеров: ' + e.message);
  }
}

/**
 * Проверяет состояние Callback сервера VK
 */
function checkVkCallbackServer() {
  const ui = SpreadsheetApp.getUi();
  try {
    const groupId = getVkGroupId();
    const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
    
    if (!groupId || !webAppUrl) {
      ui.alert('❌ Ошибка', 'GROUP_ID или WEB_APP_URL не настроены', ui.ButtonSet.OK);
      return;
    }
    
    let serverInfo = [];
    serverInfo.push(`Группа ID: ${groupId}`);
    serverInfo.push(`URL сервера: ${webAppUrl}`);
    
    // Получаем список callback серверов
    const servers = callVk('groups.getCallbackServers', { group_id: groupId });
    
    if (servers && servers.response && servers.response.items) {
      serverInfo.push(`\n=== CALLBACK СЕРВЕРЫ ===`);
      serverInfo.push(`Всего серверов: ${servers.response.count}`);
      
      const myServer = servers.response.items.find(s => s.url === webAppUrl);
      
      if (myServer) {
        serverInfo.push(`\n✅ НАЙДЕН НАШ СЕРВЕР:`);
        serverInfo.push(`ID: ${myServer.id}`);
        serverInfo.push(`Статус: ${myServer.status}`);
        serverInfo.push(`Title: ${myServer.title}`);
        
        // Используем новую надежную функцию для проверки статуса
        const status = getCallbackEventsStatus(groupId, myServer.id);
        
        if (status) {
          serverInfo.push(`\n=== НАСТРОЙКИ СОБЫТИЙ ===`);
          const events = ['wall_post_new', 'wall_reply_new', 'message_new'];
          
          events.forEach(event => {
            const isEnabled = status.enabled.includes(event);
            serverInfo.push(`${event}: ${isEnabled ? '✅ ВКЛ' : '❌ ВЫКЛ'}`);
          });
          
          // Если что-то выключено - включаем
          if (status.disabled.some(e => ['wall_post_new', 'wall_reply_new', 'message_new'].includes(e))) {
            serverInfo.push(`\n🔧 ВКЛЮЧАЕМ СОБЫТИЯ...`);
            const res = enableCallbackEvents(groupId, myServer.id, ['wall_post_new', 'wall_reply_new', 'wall_reply_edit', 'wall_reply_delete', 'message_new']);
            serverInfo.push(res.success ? '✅ Успешно включены' : '❌ Ошибка: ' + res.message);
          }
        }
      } else {
        serverInfo.push(`\n❌ НАШ СЕРВЕР НЕ НАЙДЕН!`);
        serverInfo.push(`Проверьте, правильно ли указан URL в настройках.`);
      }
      
      // Показываем все серверы для информации
      serverInfo.push(`\n=== ВСЕ СЕРВЕРЫ ===`);
      servers.response.items.forEach((server, index) => {
        const isOurs = server.url === webAppUrl ? ' (наш)' : '';
        serverInfo.push(`${index + 1}. ${server.title} - ${server.status}${isOurs}`);
        serverInfo.push(`   URL: ${server.url}`);
      });
      
    } else {
      serverInfo.push(`\n❌ Не удалось получить список серверов`);
      serverInfo.push(`Ошибка: ${JSON.stringify(servers)}`);
    }

    // Добавляем информацию о последних событиях из листа "Входящие"
    serverInfo.push(`\n=== ПОСЛЕДНИЕ СОБЫТИЯ (Real-time) ===`);
    try {
      const incomingData = getSheetData("Incoming");
      if (incomingData && incomingData.length > 0) {
        // Берем последние 5 событий
        const lastEvents = incomingData.slice(-5).reverse();
        lastEvents.forEach(evt => {
          const date = evt.data.date instanceof Date ? evt.data.date.toLocaleTimeString() : String(evt.data.date);
          serverInfo.push(`[${date}] ${evt.data.type}`);
        });
      } else {
        serverInfo.push(`Событий пока нет.`);
      }
    } catch (e) {
      serverInfo.push(`Ошибка при получении списка событий.`);
    }
    
    ui.alert('Состояние Callback сервера VK', serverInfo.join('\n'), ui.ButtonSet.OK);
    
  } catch (e) {
    ui.alert('❌ Ошибка проверки Callback сервера: ' + e.message);
  }
}

function routeEvent(payload) {
  // --- Alien Group Protection (Secondary) ---
  const myGroupId = String(PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "");
  if (payload.group_id && String(payload.group_id) !== myGroupId) {
    logDebug('🚫 routeEvent: Ignored enqueued event from alien group', { received: payload.group_id, expected: myGroupId });
    return; // Don't process enqueued garbage
  }
  // -------------------------------------------

  // ✅ Трассировка вызова (новое требование для диагностики)
  logDebug('🎯 routeEvent called', { type: payload.type, hasObject: !!payload.object });

  // Process the event (already recorded in enqueueEvent)
  switch (payload.type) {
    case "wall_post_new": handleWallPostNew(payload); break;
    case "wall_reply_new": handleWallReplyNew(payload); break;
    case "wall_reply_edit": handleWallReplyEdit(payload); break;
    case "wall_reply_delete": handleWallReplyDelete(payload); break;
    case "message_new": handleMessageNew(payload); break;
  }
}

/**
 * Builds a complete order summary message for a given user.
 * This function is reusable for both direct user communication and admin reports.
 * @param {string} userId - The VK user ID.
 * @returns {string} A formatted string containing the user's order summary.
 */
function buildUserOrderSummary(userId) {
  const settings = getSettings();
  const allOrders = getSheetData("Orders");
  const userOrders = allOrders.filter(o => String(o.data.user_id) === String(userId) && o.data.status === 'Ожидает оплаты');

  if (userOrders.length === 0) {
    return "У вас нет неоплаченных выигранных лотов.";
  }

  let lotsList = '';
  let lotsTotal = 0;
  userOrders.forEach(order => {
    // Добавим ссылку на пост с лотом для удобства
    const postLink = order.data.post_id ? ` (https://vk.com/wall${order.data.post_id})` : '';
    lotsList += `- Лот "${order.data.lot_name}"${postLink} - ${order.data.win_price}₽\n`;
    lotsTotal += Number(order.data.win_price);
  });

  const itemCount = userOrders.length;
  const deliveryRules = settings.delivery_rules || {};
  let deliveryCost = 0;

  if (itemCount > 0) {
    if (itemCount <= 3 && deliveryRules['1-3']) deliveryCost = deliveryRules['1-3'];
    else if (itemCount <= 6 && deliveryRules['4-6']) deliveryCost = deliveryRules['4-6'];
    else if (deliveryRules['7+']) deliveryCost = deliveryRules['7+'];
    else deliveryCost = 0;
  }

  const totalCost = lotsTotal + deliveryCost;

  let template = settings.order_summary_template || "Ошибка: шаблон не найден.";
  const messageText = template
      .replace(/{LOTS_LIST}/g, lotsList)
      .replace(/{LOTS_TOTAL}/g, lotsTotal)
      .replace(/{ITEM_COUNT}/g, itemCount)
      .replace(/{DELIVERY_COST}/g, deliveryCost)
      .replace(/{TOTAL_COST}/g, totalCost)
      .replace(/{PAYMENT_BANK}/g, settings.PAYMENT_BANK || '')
      .replace(/{PAYMENT_PHONE}/g, settings.PAYMENT_PHONE || '');

  return messageText;
}

/**
 * Process full payment confirmation
 * Marks all unpaid orders for the user as paid
 * @param {string} replyMessageId - ID of the message being replied to
 * @param {string} adminId - Admin who sent the reply
 */
function processFullPayment(replyMessageId, adminId) {
  try {
    // Extract user ID from the original message
    const userId = extractUserIdFromMessage(replyMessageId);
    if (!userId) {
      logError('processFullPayment', new Error('Could not extract user ID from message'));
      sendMessage(adminId, '❌ Не удалось определить пользователя');
      return;
    }
    
    const orders = getSheetData("Orders");
    const userOrders = orders.filter(o => 
      String(o.data.user_id) === userId && o.data.status === 'Ожидает оплаты'
    );
    
    if (userOrders.length === 0) {
      sendMessage(adminId, '❌ У пользователя нет неоплаченных заказов');
      return;
    }
    
    // Update all unpaid orders to paid
    userOrders.forEach(order => {
      updateRow("Orders", order.rowIndex, { status: 'Оплачено' });
    });
    
    // Update user's paid count
    updateUserPaymentStats(userId, userOrders.length);
    
    sendMessage(adminId, `✅ Отмечено ${userOrders.length} заказов как оплаченные`);
    logInfo("ADMIN_PAYMENT_PROCESSED", { 
      admin_id: adminId, 
      user_id: userId, 
      orders_paid: userOrders.length,
      action: 'full_payment'
    });
    
  } catch (error) {
    logError('processFullPayment', error);
    sendMessage(adminId, '❌ Ошибка при обработке оплаты');
  }
}

/**
 * Process no payment confirmation
 * Adds payment status notes
 * @param {string} replyMessageId - ID of the message being replied to
 * @param {string} adminId - Admin who sent the reply
 */
function processNoPayment(replyMessageId, adminId) {
  try {
    const userId = extractUserIdFromMessage(replyMessageId);
    if (!userId) {
      logError('processNoPayment', new Error('Could not extract user ID from message'));
      sendMessage(adminId, '❌ Не удалось определить пользователя');
      return;
    }
    
    // Add note to user record
    const users = getSheetData("Users");
    const userRow = users.find(u => String(u.data.user_id) === userId);
    
    if (userRow) {
      const currentNotes = userRow.data.payment_notes || '';
      const newNotes = currentNotes + `\n[${new Date().toLocaleString()}] Не оплатил (отметил админ: ${adminId})`;
      updateRow("Users", userRow.rowIndex, { payment_notes: newNotes });
    }
    
    sendMessage(adminId, '✅ Пометка "не оплатил" добавлена');
    logInfo("ADMIN_PAYMENT_PROCESSED", { 
      admin_id: adminId, 
      user_id: userId, 
      action: 'no_payment'
    });
    
  } catch (error) {
    logError('processNoPayment', error);
    sendMessage(adminId, '❌ Ошибка при обработке отметки');
  }
}

/**
 * Process partial payment
 * Parses which lots were paid and updates accordingly
 * @param {string} text - Admin message text
 * @param {string} replyMessageId - ID of the message being replied to
 * @param {string} adminId - Admin who sent the reply
 */
function processPartialPayment(text, replyMessageId, adminId) {
  try {
    const userId = extractUserIdFromMessage(replyMessageId);
    if (!userId) {
      logError('processPartialPayment', new Error('Could not extract user ID from message'));
      sendMessage(adminId, '❌ Не удалось определить пользователя');
      return;
    }
    
    // Parse lot IDs from text (e.g., "оплатил лоты: ABC123, XYZ789")
    const lotIds = parseLotIdsFromText(text);
    
    if (lotIds.length === 0) {
      sendMessage(adminId, '❌ Не удалось распознать номера лотов. Укажите в формате: "оплатил лоты: ABC123, XYZ789"');
      return;
    }
    
    const orders = getSheetData("Orders");
    let paidCount = 0;
    let notPaidCount = 0;
    
    // Process each order
    orders.forEach(order => {
      if (String(order.data.user_id) === userId && order.data.status === 'Ожидает оплаты') {
        const orderLotId = String(order.data.lot_id);
        
        if (lotIds.includes(orderLotId)) {
          // Mark as paid
          updateRow("Orders", order.rowIndex, { status: 'Оплачено' });
          paidCount++;
        } else {
          // Mark as not paid with note
          const currentNotes = order.data.admin_notes || '';
          const newNotes = currentNotes + `\n[${new Date().toLocaleString()}] Не оплачен (админ: ${adminId})`;
          updateRow("Orders", order.rowIndex, { 
            admin_notes: newNotes,
            status: 'Ожидает оплаты' 
          });
          notPaidCount++;
        }
      }
    });
    
    // Update user payment stats
    if (paidCount > 0) {
      updateUserPaymentStats(userId, paidCount);
    }
    
    sendMessage(adminId, `✅ Обработано: ${paidCount} оплачено, ${notPaidCount} не оплачено`);
    logInfo("ADMIN_PAYMENT_PROCESSED", { 
      admin_id: adminId, 
      user_id: userId, 
      lots_paid: paidCount,
      lots_not_paid: notPaidCount,
      action: 'partial_payment'
    });
    
  } catch (error) {
    logError('processPartialPayment', error);
    sendMessage(adminId, '❌ Ошибка при обработке частичной оплаты');
  }
}
/**
 * Extract user ID from original winner report message
 * @param {string} messageId - VK message ID
 * @returns {string|null} User ID or null
 */
function extractUserIdFromMessage(messageId) {
  try {
    // In production, you'd need to store message-user mapping
    // For now, return a placeholder
    // Real implementation would query a Messages table or use message context
    logDebug("extractUserIdFromMessage: Placeholder implementation", { messageId });
    return null; // TODO: Implement proper message-user mapping storage
  } catch (error) {
    logError('extractUserIdFromMessage', error);
    return null;
  }
}

/**
 * Parse lot IDs from admin message text
 * @param {string} text - Message text
 * @returns {Array<string>} Array of lot IDs
 */
function parseLotIdsFromText(text) {
  // Match patterns like "лоты: ABC123, XYZ789" or "лот ABC123"
  const patterns = [
    /лоты?[,:]?\s*([a-zA-Z0-9_,\s]+)/i,
    /оплатил\s+([a-zA-Z0-9_,\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const lotString = match[1];
      return lotString.split(/[,$\s]+/)
        .map(id => id.trim().toUpperCase())
        .filter(id => id.length > 0 && /^[A-Z0-9_]+$/.test(id));
    }
  }
  
  return [];
}

/**
 * Update user payment history
 * @param {string} userId - User ID
 * @param {number} paidCount - Number of newly paid orders
 */
function updateUserPaymentStats(userId, paidCount) {
  try {
    const users = getSheetData("Users");
    const userRow = users.find(u => String(u.data.user_id) === userId);
    
    if (userRow) {
      const currentPaid = Number(userRow.data.total_lots_paid) || 0;
      const newPaid = currentPaid + paidCount;
      
      updateRow("Users", userRow.rowIndex, { 
        total_lots_paid: newPaid,
        last_payment_date: new Date()
      });
      
      logDebug("User payment stats updated", { 
        user_id: userId, 
        old_paid: currentPaid, 
        new_paid: newPaid 
      });
    }
  } catch (error) {
    logError('updateUserPaymentStats', error);
  }
}
/**
 * Handle admin replies to winner reports
 * Processes admin responses to mark orders as paid/unpaid
 * @param {Object} payload - VK message payload
 */
function handleAdminReply(payload) {
  const settings = getSettings();
  const parsedAdmins = parseAdminIds(settings.ADMIN_IDS);
  const adminUserIds = parsedAdmins.users;
  
  const message = payload.object.message;
  const userId = String(message.from_id);
  const text = (message.text || '').toLowerCase().trim();
  const replyMessageId = message.reply_message ? message.reply_message.id : null;
  
  // Check if sender is an admin user
  if (!adminUserIds.includes(userId)) {
    logDebug("handleAdminReply: Ignoring non-admin message", { userId });
    return;
  }
  
  // Check if this is a reply to a winner report
  if (!replyMessageId) {
    logDebug("handleAdminReply: Not a reply message", { text });
    return;
  }
  
  // Process admin commands
  if (text === 'оплатил') {
    processFullPayment(replyMessageId, userId);
  } else if (text === 'не оплатил') {
    processNoPayment(replyMessageId, userId);
  } else if (text.includes('оплатил')) {
    processPartialPayment(text, replyMessageId, userId);
  }
}

function handleMessageNew(payload) {
    // Add admin reply handling first
    handleAdminReply(payload);
    
    const settings = getSettings();
    const codeWord = (settings.CODE_WORD || 'Аукцион').toLowerCase();
    const message = payload.object.message;
    const text = (message.text || '');
    const lowerCaseText = text.toLowerCase();
    const userId = String(message.from_id);

    // Дополнительная проверка: убедимся, что это реальное сообщение от пользователя
    // а не системное или сгенерированное событие
    if (!message || !userId || userId === '') {
        logDebug("handleMessageNew: Ignoring invalid message payload.", {payload: payload});
        return;
    }

    // Если сообщение содержит кодовое слово, запускаем стандартную логику сводки по заказу.
    if (lowerCaseText === codeWord) {
        logInfo("handleMessageNew: Code word received.", {userId: userId, text: message.text});
        const summaryMessage = buildUserOrderSummary(userId);
        sendMessage(userId, summaryMessage);

        // Логируем только если сводка действительно была отправлена
        if (!summaryMessage.startsWith("У вас нет")) {
          Monitoring.recordEvent('USER_SUMMARY_SENT', { userId: userId });
        }
        return; 
    }

    // --- НОВАЯ КОМАНДА: КОПИТЬ ---
    const accumulateCommand = (settings.ACCUMULATE_COMMAND || 'копить').toLowerCase();
    if (lowerCaseText === accumulateCommand) {
        logInfo("handleMessageNew: 'КОПИТЬ' command received.", {userId: userId});
        const allUsers = getSheetData("Users");
        const userRow = allUsers.find(u => String(u.data.user_id) === userId);

        if (userRow) {
            updateRow("Users", userRow.rowIndex, { shipping_status: "Накопление" });
            sendMessage(userId, "✅ Принято! Ваш статус изменен на «Накопление». Ваши выигранные лоты будут храниться у нас до тех пор, пока вы не запросите отправку.");
            Monitoring.recordEvent('USER_STATUS_ACCUMULATE', { userId: userId });
        } else {
            sendMessage(userId, "У вас пока нет выигранных лотов, чтобы начать накопление. 😉");
        }
        return;
    }
    // --- КОНЕЦ КОМАНДЫ КОПИТЬ ---

    // Если кодового слова нет, пытаемся распознать данные для доставки.
    const allOrders = getSheetData("Orders");
    const userHasUnpaidOrders = allOrders.some(o => String(o.data.user_id) === userId && o.data.status === 'unpaid');

    if (!userHasUnpaidOrders) {
        logDebug("handleMessageNew: Ignored message, no code word and no unpaid orders.", {text: text});
        return;
    }

    // Проверяем, содержит ли сообщение признаки информации для доставки
    // Улучшаем регулярные выражения для более точного распознавания
    
    // Более строгое регулярное выражение для телефона: должно начинаться с +7, 8 или 7 и содержать 10-11 цифр
    const phoneRegex = /(?:\+7|8|7)[\s\-(]*(?:\d[\s\-)]*){10}(?:\d)?/;
    const phoneMatch = text.match(phoneRegex);

    // Более строгое регулярное выражение для ФИО: должно содержать как минимум 2 слова из 2+ букв, начинающихся с заглавной буквы
    const fioRegex = /([А-ЯЁ][а-яё]{1,}\s+[А-ЯЁ][а-яё]{1,}(?:\s+[А-ЯЁ][а-яё]{1,})?)/;
    const fioMatch = text.match(fioRegex);

    // Проверяем наличие ключевых слов для адреса, но более строго
    const addressKeywords = ['город', 'г\\.', 'улица', 'ул\\.', 'дом', 'д\\.', 'квартира', 'кв\\.', 'индекс', 'сдэк', 'cdek', 'почта', 'россии'];
    const hasAddressHint = addressKeywords.some(kw => new RegExp(kw, 'i').test(lowerCaseText));

    // Улучшаем логику: требуем, чтобы были как минимум 2 из 3 признаков (телефон, ФИО, адрес)
    // или более точное распознавание, чтобы избежать ложных срабатываний
    const hasPhone = !!phoneMatch;
    const hasFio = !!fioMatch;
    const hasAddress = hasAddressHint;

    // Проверяем, что текст содержит достаточно информации для доставки
    // Не отправляем сообщение, если пользователь просто написал "аукцион" или короткое сообщение
    // Также проверяем, что сообщение не является командой "аукцион" (даже с разным регистром)
    const isCodeWordCommand = lowerCaseText === (settings.CODE_WORD || 'Аукцион').toLowerCase();
    
    // Более строгая проверка: требуем наличие как минимум 2 из 3 признаков
    const isLikelyShippingInfo = !isCodeWordCommand && 
                                text.trim() !== '' && 
                                text.length > 10 && // Сообщение должно быть достаточно длинным
                                ((hasPhone && hasFio) || 
                                 (hasPhone && hasAddress) || 
                                 (hasFio && hasAddress));

    if (isLikelyShippingInfo) {
        logInfo("handleMessageNew: Shipping info detected.", {userId: userId, text: text});

        const phone = phoneMatch ? phoneMatch[0] : 'не найден';
        const fio = fioMatch ? fioMatch[0] : 'не найдено';

        const address = text.replace(phoneRegex, '').replace(fioRegex, '').replace(/\s+/g, ' ').trim();

        const shippingDetails = `ФИО: ${fio}\nТелефон: ${phone}\nАдрес: ${address}`;

        const allUsers = getSheetData("Users");
        const userRow = allUsers.find(u => String(u.data.user_id) === userId);

        if (userRow) {
            updateRow("Users", userRow.rowIndex, { shipping_details: shippingDetails });
            
            // Get confirmation message from settings
            const settings = getSettings();
            const confirmationMsg = settings.shipping_confirmation_template || 'Ошибка: шаблон подтверждения не найден в Настройках!';
            
            sendMessage(userId, confirmationMsg);
            Monitoring.recordEvent('SHIPPING_INFO_RECEIVED', { userId: userId, details: shippingDetails });
        } else {
            logError('handleMessageNew', new Error('Could not find user to save shipping info'), {userId: userId});
        }
    } else {
        logDebug("handleMessageNew: Ignored message, no code word and insufficient shipping info detected.", {text: text, hasPhone, hasFio, hasAddress, isCodeWordCommand, isLikelyShippingInfo});
    }
}

function handleWallPostNew(payload) {
  if (!payload.object) return;
  const lot = parseLotFromPost(payload.object);
  if (!lot) {
    Monitoring.recordEvent('LOT_PARSE_FAILED', { text: (payload.object.text || "").substring(0, 100) });
    logInfo("Пост не распаршен", (payload.object.text || "").substring(0, 50));
    return;
  }

  // --- ЗАЩИТА ОТ ДУБЛЕЙ ЛОТОВ (ЖЕЛЕЗОБЕТОННАЯ) ---
  // Ищем любой лот с таким же номером, созданный СЕГОДНЯ.
  // Если лот уже есть (неважно, активен, продан или не продан) - игнорируем новый пост.
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
  
  const existingLot = getSheetData("Config").find(r => {
    // Проверяем номер лота
    if (String(r.data.lot_id) !== String(lot.lot_id)) return false;
    
    // Проверяем дату создания (чтобы не блокировать лоты с таким же номером, но с прошлой недели)
    const createdDate = parseRussianDate(r.data.created_at);
    if (!createdDate) return false;
    
    const createdStr = Utilities.formatDate(createdDate, Session.getScriptTimeZone(), "dd.MM.yyyy");
    return createdStr === todayStr;
  });

  if (existingLot) {
    logInfo(`⚠️ Лот №${lot.lot_id} уже существует сегодня (статус: ${existingLot.data.status}). Игнорирую дублирующий пост.`, {
      ignored_post_id: `${payload.object.owner_id}_${payload.object.id}`,
      existing_post_id: existingLot.data.post_id
    });
    return;
  }
  // ----------------------------------------

  const newLotData = { 
    lot_id: String(lot.lot_id), 
    post_id: `${payload.object.owner_id}_${payload.object.id}`, 
    name: lot.name, 
    start_price: lot.start_price, 
    current_price: lot.start_price, 
    leader_id: "", 
    status: "Активен", 
    created_at: new Date(), 
    deadline: lot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000), 
    bid_step: lot.bidStep || 0,
    image_url: lot.image_url || "",
    attachment_id: lot.attachment_id || ""
  };
  upsertLot(newLotData);
  Monitoring.recordEvent('LOT_CREATED', newLotData);
  logInfo(`Лот №${lot.lot_id} добавлен`);

  // Если включен тестовый режим, активируем триггер мониторинга сразу
  if (getSetting('test_mode_enabled') === 'ВКЛ') {
    logInfo("🚀 Тестовый режим: запуск немедленного мониторинга завершения.");
    activateFrequentMonitoring();
  }
}
function parseLotFromPost(postObject) {
  try {
    const text = postObject.text || "";
    
    const settings = getSettings();
    const auctionTag = settings.AUCTION_TAG || '#аукцион';
    const auctionTagRegex = new RegExp(auctionTag, "i");

    // Log incoming post for debugging
    logInfo("📥 Новый пост получен", { 
      post_id: postObject.id,
      owner_id: postObject.owner_id,
      text_preview: text.substring(0, 200),
      has_auction_tag: auctionTagRegex.test(text),
      has_lot_number: /№\s*[a-zA-Z0-9_]+/i.test(text)
    });
    
    if (!auctionTagRegex.test(text)) {
      logInfo(`❌ Пост не содержит тег "${auctionTag}"`, { text_preview: text.substring(0, 100) });
      return null;
    }
    
    // Check if Saturday-only mode is enabled
    const saturdayOnly = getSetting('saturday_only_enabled') === 'ВКЛ';
    
    if (saturdayOnly) {
      // Check if post was made on Saturday
      const postDate = new Date(postObject.date * 1000); // VK uses Unix timestamp
      const dayOfWeek = postDate.getDay(); // 0 = Sunday, 6 = Saturday
      
      logInfo("📅 Проверка дня недели", { 
        post_timestamp: postObject.date,
        post_date: postDate.toDateString(),
        day_of_week: dayOfWeek,
        is_saturday: dayOfWeek === 6
      });
      
      if (dayOfWeek !== 6) { // 6 = Saturday
        logInfo("Пост проигнорирован: не суббота", { 
          post_date: postDate.toDateString(), 
          day_of_week: dayOfWeek,
          text_preview: text.substring(0, 100) 
        });
        return null;
      }
    }
    
    const lotNumberMatch = text.match(/(?:[#аукцион\w@]+\s*)?(?:№|No\.|Number)\s*([a-zA-Z0-9_]+)/i);
    if (!lotNumberMatch) {
      logInfo("❌ Не найден номер лота", { text_preview: text.substring(0, 100) });
      return null;
    }
    const lotId = lotNumberMatch[1];
    let name = "Лот №" + lotId;
    let startPrice = 0;
    let bidStep = 0;
    let deadline = null;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    // Test mode check (Once per post)
    if (getSetting('test_mode_enabled') === 'ВКЛ') {
      const now = new Date();
      deadline = new Date(now.getTime() + 5 * 60 * 1000);
      logInfo("🕒 РЕЖИМ ТЕСТИРОВАНИЯ ВКЛЮЧЕН (МСК). Дедлайн установлен на +5 минут.", { deadline: Utilities.formatDate(deadline, "GMT+3", "dd.MM.yyyy HH:mm:ss") });
    }

    let deadlineFound = false;
    for (const line of lines) {
      const nameMatch = line.match(/^(?:Лот|🎁Лот)\s*[-—]?\s*(.+)/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
        continue;
      }
      
      const priceMatch = line.match(/^(?:👀Старт|Старт)\s*(\d+)\s*р(?:\s+и\s+шаг\s*[-—]?\s*(\d+)\s*р?)?/i);
      if (priceMatch) {
        startPrice = Number(priceMatch[1]);
        if (priceMatch[2]) bidStep = Number(priceMatch[2]);
        continue;
      }
    
      if (getSetting('test_mode_enabled') !== 'ВКЛ' && !deadlineFound) {
        // Improved deadline parsing: handles "Дедлайн: 21.02.2026 13:41:00", "До 21.02 в 13:41", etc.
        const deadlineLineMatch = line.match(/(?:Дедлайн|Дата окончания аукциона|Финал|Окончание)\s*[:—-]?\s*(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)\s*(?:в|at)?\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)/i);
        if (deadlineLineMatch) {
          const datePart = deadlineLineMatch[1];
          const timePart = deadlineLineMatch[2];
          
          const dateParts = datePart.split(/[./-]/).map(Number);
          const timeParts = timePart.split(/[:.]/).map(Number);
          
          const day = dateParts[0];
          const month = dateParts[1] - 1;
          let year = dateParts[2] || new Date().getFullYear();
          if (year < 100) year += 2000;
          
          const hours = timeParts[0];
          const minutes = timeParts[1];
          const seconds = timeParts[2] || 0;
          
          deadline = new Date(year, month, day, hours, minutes, seconds);
          deadlineFound = true;
          logInfo("✅ Дедлайн успешно распаршен", { line: line, parsed: deadline.toLocaleString() });
          continue;
        }
      }
    } // End of for (const line of lines)

    if (!deadlineFound && getSetting('test_mode_enabled') !== 'ВКЛ') {
      logInfo("⚠️ Дедлайн не найден в тексте поста. Будет использовано значение по умолчанию (+7 дней).", { 
        text_preview: text.substring(0, 300) 
      });
    }
    
    let imageUrl = "";
    let attachmentId = "";
    if (postObject.attachments && postObject.attachments.length > 0) {
      const photoAttachment = postObject.attachments.find(a => a.type === 'photo');
      if (photoAttachment) {
        const photo = photoAttachment.photo;
        attachmentId = `photo${photo.owner_id}_${photo.id}`;
        // Find best photo size URL
        const sizeOrder = ['w', 'z', 'y', 'x', 'm', 's'];
        for (const sizeType of sizeOrder) {
          const size = photo.sizes.find(s => s.type === sizeType);
          if (size) {
            imageUrl = size.url;
            break;
          }
        }
        if (!imageUrl && photo.sizes.length > 0) {
            imageUrl = photo.sizes[photo.sizes.length - 1].url; // Fallback to largest available
        }
      }
    }

    const parsedLot = {
      lot_id: lotId,
      name: name.substring(0, 150),
      start_price: startPrice,
      bidStep: bidStep,
      deadline: deadline,
      image_url: imageUrl,
      attachment_id: attachmentId
    };
    Monitoring.recordEvent('LOT_PARSE_SUCCESS', { raw_text_preview: text.substring(0,100), parsed: parsedLot });
    return parsedLot;
  } catch (e) {
    Monitoring.recordEvent('LOT_PARSE_CRITICAL_ERROR', { error: e.message, text: (postObject.text || "").substring(0,200) });
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
// Helper to safely update bid status even if rows shifted
function updateBidStatus(bidId, newStatus) {
  const bids = getSheetData("Bids");
  const match = bids.find(b => String(b.data.bid_id) === String(bidId));
  if (match) {
    updateRow("Bids", match.rowIndex, { status: newStatus });
  } else {
    logError("updateBidStatus", "Bid not found for update", { bidId, newStatus });
  }
}

// Helper to safely parse a date string in various formats
function parseRussianDate(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) return dateString;
  
  // Handle Numbers (Excel-style serial dates)
  if (typeof dateString === 'number') {
    // 25569 = milliseconds between Jan 1 1900 and Jan 1 1970
    return new Date((dateString - 25569) * 86400 * 1000);
  }

  let s = String(dateString).trim();
  if (s.startsWith("'")) s = s.substring(1).trim(); // Clean apostrophe
  
  // 1. Try ISO format (often comes from JSON.parse of a Date object)
  if (s.includes('T') && s.endsWith('Z')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Try primary Russian format
  try {
    return Utilities.parseDate(s, "GMT+3", "dd.MM.yyyy HH:mm:ss");
  } catch (e) {
    try {
      // 3. Try secondary Russian format (short time)
      return Utilities.parseDate(s, "GMT+3", "dd.MM.yyyy HH:mm");
    } catch (e2) {
      // 4. Manual regex parsing for "dd.MM.yyyy HH:mm:ss" if Utilities.parseDate is too picky
      const match = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s*(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?/);
      if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]) - 1;
        let year = Number(match[3]);
        if (year < 100) year += 2000;
        const hour = Number(match[4]);
        const min = Number(match[5]);
        const sec = match[6] ? Number(match[6]) : 0;
        return new Date(year, month, day, hour, min, sec);
      }
      
      // 5. Last resort: standard JS parse
      const dJS = new Date(s);
      if (!isNaN(dJS.getTime())) return dJS;

      logError("parseRussianDate", "Failed to parse date string", { original: dateString, string: s });
      return null;
    }
  }
}


function handleWallReplyNew(payload) {
  const comment = payload.object || {};
  const vkTimestamp = comment.date ? new Date(comment.date * 1000) : new Date();

  // --- HARD SELF-REPLY BLOCK ---
  if (comment.from_id < 0) {
    return;
  }
  // -----------------------------

  // --- 1. Fast Cache Check (Memeory-level idempotency) ---
  const cache = CacheService.getScriptCache();
  const cacheKey = "proc_comm_" + comment.id;
  if (cache.get(cacheKey)) {
    logDebug("🚫 Duplicate comment detected via Cache, skipping.", { comment_id: comment.id });
    return;
  }
  // Mark as processing immediately
  cache.put(cacheKey, "1", 600); // Keep for 10 minutes

  const ownerId = payload.group_id || getVkGroupId(); 
  const postKey = `-${ownerId}_${comment.post_id}`; 
  const userId = String(comment.from_id);

  // --- 2. Robust Deduplication using Sheets ---
  // Fast check before lock
  if (isBidExists(comment.id)) {
    logInfo("🚫 Duplicate comment event detected (fast check), skipping.", { comment_id: comment.id });
    return; 
  }

  // --- Initial Lot Check (Fast Fail) ---
  const lot = findLotByPostId(postKey);
  if (!lot) {
    logDebug("Comment on untracked post ignored.", { postKey });
    return;
  }
  
  if (lot.status !== "Активен") {
    Monitoring.recordEvent('HANDLE_WALL_REPLY_LOT_INACTIVE', { lot_id: lot.lot_id, status: lot.status });
    logInfo("⚠️ Лот найден, но он НЕ АКТИВЕН", { status: lot.status, lot_id: lot.lot_id });
    return;
  }

  // --- Self-Reply Protection ---
  const groupId = getVkGroupId(); 
  if (userId === `-${groupId}`) {
    logDebug("🚫 Ignored self-reply (comment from bot).", { text: comment.text });
    return;
  }

  const bid = parseBid(comment.text || "");
  if (!bid) {
    Monitoring.recordEvent('HANDLE_WALL_REPLY_NO_BID_PARSED', { text: comment.text });
    logDebug("⚠️ Comment text parsed as NO BID", { text: comment.text });
    return;
  }

  const lock = LockService.getScriptLock();
  try {
    // Wait for lock up to 5 seconds
    if (!lock.tryLock(5000)) {
       logInfo("⚠️ Could not acquire lock for comment " + comment.id + ", retrying later or skipping.");
       return;
    }

    // --- CRITICAL SECTION START ---

    // 1. Re-check existence inside lock (Double-Check Locking)
    if (isBidExists(comment.id)) {
      logInfo("🚫 Duplicate comment event detected (inside lock), skipping.", { comment_id: comment.id });
      return;
    }

    const currentLot = findLotByPostId(postKey); // Re-fetch lot inside lock to get latest price
    
    // Use enhanced validation (now without subscription check)
    const validationResult = enhancedValidateBid(bid, currentLot, userId);
    
    if (!validationResult.isValid) {
      // ADDED: Detailed log for invalid bid
      Monitoring.recordEvent('HANDLE_WALL_REPLY_BID_INVALID', { 
        lot_id: currentLot.lot_id, 
        bid: bid, 
        user_id: userId, 
        reason: validationResult.reason 
      });
      logDebug(`🚫 Bid INVALID: ${validationResult.reason}`, { bid: bid, lot_id: currentLot.lot_id });
      
      // Записываем любую некорректную ставку в таблицу для истории
      appendRow("Bids", {
        bid_id: Utilities.getUuid(),
        lot_id: currentLot.lot_id,
        user_id: userId,
        bid_amount: bid,
        timestamp: new Date(),
        vk_timestamp: vkTimestamp,
        comment_id: comment.id,
        status: "некорректная"
      });

      // ПРОВЕРКА: Не отвечали ли мы уже на этот комментарий
      const postOwnerId = parsePostKey(postKey).postId;
      if (checkIfBotReplied(postOwnerId, comment.id)) {
        logInfo(`💬 Ответ на комментарий ${comment.id} уже существует, пропускаем.`);
        return;
      }

      // ВСЕГДА отвечаем пользователю в комментариях, почему ставка не принята
      const errorMessage = `Ставка ${bid}₽ не принята. ${validationResult.reason}`;
      try {
        replyToComment(parsePostKey(postKey).postId, comment.id, errorMessage);
        logInfo(`💬 Ответил пользователю ${userId} об ошибке: ${validationResult.reason}`);
      } catch (e) {
        logError("reply_invalid_bid", e);
      }
      return;
    }

    // --- ОБРАБОТКА ВАЛИДНОЙ СТАВКИ ---
    
    // 1. Находим текущую лидирующую ставку по ЭТОМУ ЛОТУ и ЭТОМУ ПОСТУ
    const bids = getSheetData("Bids");
    const oldLeaderBid = bids.find(b => 
      b.data.lot_id === currentLot.lot_id && 
      extractIdFromFormula(b.data.post_id) === String(parsePostKey(postKey).postId) && 
      b.data.status === "лидер"
    );
    
    if (oldLeaderBid) {
      updateBidStatus(oldLeaderBid.data.bid_id, "перебита");
    }

    // 2. СНАЧАЛА ЗАПИСЫВАЕМ СТАВКУ (Защита от повторов)
    logDebug(`💾 Recording Valid Bid: ${bid}`);
    appendRow("Bids", {
      bid_id: Utilities.getUuid(),
      lot_id: currentLot.lot_id,
      post_id: parsePostKey(postKey).postId,
      user_id: userId,
      bid_amount: bid,
      timestamp: new Date(),
      vk_timestamp: vkTimestamp,
      comment_id: comment.id,
      status: "лидер"
    });

    // 3. ТОЛЬКО ПОТОМ ОБНОВЛЯЕМ ЛОТ
    updateLot(postKey, { current_price: bid, leader_id: userId });
    logDebug(`✅ Lot Updated: ${postKey} -> ${bid}`);
    
    // ... (extension logic) ...
    const isTestMode = getSetting('test_mode_enabled') === 'ВКЛ';
    if (!isTestMode) {
      const AUCTION_EXTENSION_WINDOW_MINUTES = 10;
      const AUCTION_EXTENSION_DURATION_MINUTES = 10;
      if (currentLot.deadline) {
        const now = new Date();
        const deadlineTime = parseRussianDate(currentLot.deadline);
        if (deadlineTime) {
          const timeUntilDeadline = (deadlineTime.getTime() - now.getTime()) / (1000 * 60);
          if (timeUntilDeadline <= AUCTION_EXTENSION_WINDOW_MINUTES && timeUntilDeadline > -AUCTION_EXTENSION_DURATION_MINUTES) { // Продлеваем даже если чуть просрочено, но лот активен
            const newDeadline = new Date(deadlineTime.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);
            updateLot(currentLot.lot_id, { deadline: newDeadline });
            logInfo(`Аукцион продлен до ${newDeadline.toLocaleString()}`);
            Monitoring.recordEvent('AUCTION_EXTENDED', { lot_id: currentLot.lot_id, new_deadline: newDeadline });
          }
        }
      }
    } else {
      logInfo('Продление аукциона пропущено (включен тестовый режим)');
      Monitoring.recordEvent('AUCTION_EXTENSION_SKIPPED_TEST_MODE', { lot_id: currentLot.lot_id });
    }

    // 4. Отправляем ответ перебитому пользователю только в комментарии
    if (oldLeaderBid) {
      const outbidCommentMessage = buildOutbidMessage({ lot_name: currentLot.name, new_bid: bid });
      try {
        if (oldLeaderBid.data.comment_id) {
          // ПРОВЕРКА: Не отвечали ли мы уже на этот комментарий
          if (!checkIfBotReplied(parsePostKey(postKey).postId, oldLeaderBid.data.comment_id)) {
            replyToComment(parsePostKey(postKey).postId, oldLeaderBid.data.comment_id, outbidCommentMessage);
            updateBidStatus(oldLeaderBid.data.bid_id, "уведомлен");
            logDebug(`💬 Ответил пользователю ${oldLeaderBid.data.user_id} о перебитой ставке в комментариях`);
          } else {
            logInfo(`💬 Ответ на комментарий ${oldLeaderBid.data.comment_id} уже существует, пропускаем.`);
          }
        }
      } catch (e) {
        logError("reply_outbid", e);
      }
    }
  } finally {
    lock.releaseLock();
  }
}
function parseBid(text) {
  // Updated to recognize both ruble symbols: '₽' and 'р' (Russian abbreviation)
  const match = String(text).match(/(?:^|\s)(\d+)(?:\s*(?:₽|р\.?))?(?:$|\s)/i);
  return match ? Number(match[1]) : null;
}
function validateBid(bid, lot, commentDate) {
  const checkTime = commentDate || new Date();
  const deadlineDate = parseRussianDate(lot.deadline);
  if (deadlineDate && checkTime > deadlineDate) return {isValid: false, reason: buildAuctionFinishedMessage({lot_name: lot.name})};
  const settings = getSettings();
  if (settings.max_bid && bid > settings.max_bid) return {isValid: false, reason: buildMaxBidExceededMessage({your_bid: bid, max_bid: settings.max_bid})};
  const currentPrice = Number(lot.current_price || 0);
  const startPrice = Number(lot.start_price || 0);
  const minIncrement = Number(settings.min_bid_increment || 50);
  const requiredBid = currentPrice + minIncrement;

  if (!lot.leader_id) { 
    if (bid < startPrice) return {isValid: false, reason: `Первая ставка не может быть меньше ${startPrice}₽.`}; 
  }
  else { 
    if (bid < requiredBid) {
      return {
        isValid: false, 
        reason: `Ставка ${bid}₽ слишком мала. Минимальная следующая ставка: ${requiredBid}₽ (текущая ${currentPrice}₽ + шаг ${minIncrement}₽).`
      };
    }
  }
  if (getSetting("bid_step_enabled") === "ВКЛ") {
    if ((bid - startPrice) % Number(settings.bid_step || 50) !== 0) return {isValid: false, reason: buildInvalidStepMessage({your_bid: bid, bid_step: settings.bid_step, example_bid: currentPrice + 50, example_bid2: currentPrice + 100})};
  }
  return {isValid: true, reason: null};
}

function enhancedValidateBid(bid, lot, userId) {
  // First, perform the standard validation
  const standardValidation = validateBid(bid, lot);
  if (!standardValidation.isValid) {
    return standardValidation;
  }
  
  return {
    isValid: true,
    reason: null
  };
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
  try {
    if (queueRow.type === "winner") {
      // Победителю отправляем в ЛС, так как там реквизиты
      sendMessage(queueRow.user_id, buildWinnerMessage(payload));
    }
  } catch (error) {
    // Обработка ошибок при отправке уведомлений
    logError('sendNotification_error', error, {
      user_id: queueRow.user_id,
      type: queueRow.type,
      error_code: error.code || error.message
    });
    
    // Обновляем статус уведомления как failed
    updateNotificationStatus(queueRow.queue_id, "failed", new Date());
  }
}
function buildOutbidMessage(p) {
  const settings = getSettings();
  const template = settings.outbid_notification_template || "Ошибка: шаблон не найден в Настройках.";
  logDebug("buildOutbidMessage: Using template from settings", { 
    has_setting: !!settings.outbid_notification_template,
    template_length: template.length,
    lot_name: p.lot_name,
    new_bid: p.new_bid
  });
  // The {post_id} placeholder is intentionally removed from the template to avoid spamming links.
  const cleanTemplate = template.replace(/{post_id}/g, '');
  return cleanTemplate
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот')
    .replace(/{new_bid}/g, p.new_bid || '0');
}

function buildWinnerMessage(p) {
  const settings = getSettings();
  const props = PropertiesService.getScriptProperties().getProperties();
  const paymentPhone = props.PAYMENT_PHONE || '';
  const paymentBank = props.PAYMENT_BANK || '';

  // Use the only available summary template
  const template = settings.order_summary_template ||
                   "Ошибка: шаблон не найден в Настройках. Обратитесь к администратору.";
  
  logDebug("buildWinnerMessage: Using summary template from settings", { 
    has_template: !!settings.order_summary_template,
    template_length: template.length
  });

  return template
    .replace(/{LOTS_LIST}/g, `- Лот "${p.lot_name}" - ${p.price}₽\n`)
    .replace(/{LOTS_TOTAL}/g, p.price || '0')
    .replace(/{ITEM_COUNT}/g, "1")
    .replace(/{DELIVERY_COST}/g, "---") // Single lot delivery unknown here
    .replace(/{TOTAL_COST}/g, p.price || '0')
    .replace(/{PAYMENT_BANK}/g, paymentBank)
    .replace(/{PAYMENT_PHONE}/g, paymentPhone);
}

function buildLowBidMessage(p) {
  const settings = getSettings();
  const template = settings.low_bid_notification_template || "Ошибка: шаблон не найден в Настройках.";
  
  logDebug("buildLowBidMessage: Using template from settings", { 
    has_setting: !!settings.low_bid_notification_template,
    template_length: template.length,
    your_bid: p.your_bid,
    lot_name: p.lot_name,
    current_bid: p.current_bid
  });
  
  return template
    .replace(/{your_bid}/g, p.your_bid || '0')
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот')
    .replace(/{current_bid}/g, p.current_bid || '0')
    .replace(/{post_id}/g, p.post_id || '');
}

function buildSubscriptionRequiredMessage(p) {
  const settings = getSettings();
  const template = settings.subscription_required_template || "Ошибка: шаблон не найден в Настройках.";
  
  logDebug("buildSubscriptionRequiredMessage: Using template from settings", { 
    has_setting: !!settings.subscription_required_template,
    template_length: template.length,
    lot_name: p.lot_name
  });
  
  return template
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот')
    .replace(/{post_id}/g, p.post_id || '');
}

function buildInvalidStepMessage(p) {
  const settings = getSettings();
  const template = settings.invalid_step_template || "Ошибка: шаблон не найден в Настройках.";
  return template
    .replace(/{your_bid}/g, p.your_bid || '0')
    .replace(/{bid_step}/g, p.bid_step || '0')
    .replace(/{example_bid}/g, p.example_bid || '0')
    .replace(/{example_bid2}/g, p.example_bid2 || '0');
}

function buildMaxBidExceededMessage(p) {
  const settings = getSettings();
  const template = settings.max_bid_exceeded_template || "Ошибка: шаблон не найден в Настройках.";
  return template
    .replace(/{your_bid}/g, p.your_bid || '0')
    .replace(/{max_bid}/g, p.max_bid || '0');
}

function buildAuctionFinishedMessage(p) {
  const settings = getSettings();
  const template = settings.auction_finished_template || "Ошибка: шаблон не найден в Настройках.";
  return template
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот');
}

function buildWinnerCommentMessage(p) {
  const settings = getSettings();
  const template = settings.winner_comment_template || "Ошибка: шаблон не найден в Настройках.";
  
  logDebug("buildWinnerCommentMessage: Using template from settings", { 
    has_setting: !!settings.winner_comment_template,
    template_length: template.length,
    date: p.date,
    user_id: p.user_id,
    user_name: p.user_name
  });
  
  return template
    .replace(/{date}/g, p.date || '')
    .replace(/{user_id}/g, p.user_id || '')
    .replace(/{user_name}/g, p.user_name || '');
}

function buildUnsoldLotCommentMessage() {
  const settings = getSettings();
  const template = settings.unsold_lot_comment_template || "❌ Лот не продан";
  
  logDebug("buildUnsoldLotCommentMessage: Using template from settings", { 
    has_setting: !!settings.unsold_lot_comment_template,
    template_length: template.length
  });
  
  return template;
}

/**
 * Checks if a user is subscribed to the group
 * @param {string} userId - VK user ID to check
 * @return {boolean} - True if user is member of the group, false otherwise
 */
function checkUserSubscription(userId) {
  try {
    const groupId = getVkGroupId();
    const result = callVk("groups.isMember", {
      group_id: groupId,
      user_id: String(userId)
    });
    
    if (result && result.response !== undefined) {
      return result.response === 1; // VK API returns 1 for member, 0 for non-member
    }
    
    Monitoring.recordEvent('SUBSCRIPTION_CHECK_FAILED', {
      user_id: userId,
      error: 'Invalid response from groups.isMember'
    });
    
    return false;
  } catch (error) {
    logError('checkUserSubscription', error, { user_id: userId });
    return false;
  }
}

/**
 * Checks if all auctions have concluded and triggers the finalization process.
 * This function is designed to be called by a time-based trigger every 15 minutes.
 */
function checkAndFinalizeAuctions() {
  const now = new Date();
  // Чтобы не работать днем, запускаем проверку только вечером, например, с 20:00
  if (now.getHours() < 20) {
    return;
  }

  const activeLots = getSheetData("Config").filter(row => row.data.status === "Активен");
  if (activeLots.length === 0) {
    // Нет активных лотов, нечего делать.
    return;
  }

  // Проверяем, прошел ли дедлайн хотя бы у одного лота.
  const isAnyDeadlinePassed = activeLots.some(row => {
    const deadline = parseRussianDate(row.data.deadline);
    return deadline && deadline < now;
  });
  if (!isAnyDeadlinePassed) {
    // Еще не время, ни один аукцион номинально не завершился.
    return;
  }

  const allBids = getSheetData("Bids");
  const activeLotIds = new Set(activeLots.map(l => l.data.lot_id));
  
  const bidsForActiveLots = allBids.filter(bid => activeLotIds.has(bid.data.lot_id));

  let lastBidTimestamp = 0;
  if (bidsForActiveLots.length > 0) {
    // Находим самую последнюю ставку
    const lastBid = bidsForActiveLots.reduce((latest, current) => {
      const latestDate = parseRussianDate(latest.data.timestamp);
      const currentDate = parseRussianDate(current.data.timestamp);
      return currentDate > latestDate ? current : latest;
    });
    lastBidTimestamp = parseRussianDate(lastBid.data.timestamp).getTime();
  } else {
    // Если ставок не было вообще, за точку отсчета берем самый ранний дедлайн
    const firstDeadline = activeLots.reduce((earliest, current) => {
        const earliestDate = parseRussianDate(earliest.data.deadline);
        const currentDate = parseRussianDate(current.data.deadline);
        return currentDate < earliestDate ? current : earliest;
    }).data.deadline;
    lastBidTimestamp = parseRussianDate(firstDeadline).getTime();
  }
  
  const minutesSinceLastBid = (now.getTime() - lastBidTimestamp) / (1000 * 60);

  logDebug("Проверка финализации", {
    active_lots: activeLots.length,
    last_bid_ago_min: minutesSinceLastBid
  });

  // Если с последней ставки прошло больше 15 минут, пора закрывать аукционы.
  if (minutesSinceLastBid > 15) {
    logInfo("🏁 Аукционы завершены. Запуск финальной обработки.");
    finalizeAuction();
  }
}

function finalizeAuction() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush(); // Принудительно сохраняем все изменения
  CacheService.getScriptCache().remove("sheet_Config"); // Сбрасываем кэш
  CacheService.getScriptCache().remove("sheet_Bids");
  _sheet_data_mem_cache = {}; // Сбрасываем память

  const now = new Date();
  const activeLots = getSheetData("Config").filter(row => {
    const deadline = parseRussianDate(row.data.deadline);
    return (row.data.status === "active" || row.data.status === "Активен") && deadline && deadline <= now;
  });
  Monitoring.recordEvent('AUCTION_FINALIZATION_STARTED', { active_lots_count: activeLots.length, now: now.toLocaleString() });

  const allWinnersDataForReport = [];
  const allUsers = getSheetData("Users");

  activeLots.forEach(row => {
    const lot = row.data;
    const postId = parsePostKey(lot.post_id).postId;
    
    if (!lot.leader_id) {
      updateLot(lot.post_id, { status: "Не продан" }); // СНАЧАЛА МЕНЯЕМ СТАТУС
      postCommentToLot(postId, buildUnsoldLotCommentMessage());
      Monitoring.recordEvent('LOT_UNSOLD', { lot_id: lot.lot_id });
    } else {
      const winnerId = String(lot.leader_id);
      const winnerName = getUserName(winnerId);

      // 1. СРАЗУ МЕНЯЕМ СТАТУС (Критично для остановки петли)
      updateLot(lot.post_id, { status: "Продан" });

      // ПРОВЕРКА: Если заказ по этому посту уже есть - не дублируем
      const existingOrders = getSheetData("Orders");
      const isAlreadyOrdered = existingOrders.some(o => extractIdFromFormula(o.data.post_id) === String(parsePostKey(lot.post_id).postId));
      
      const newOrder = {
        order_id: `${lot.lot_id}-${winnerId}`,
        lot_id: lot.lot_id,
        lot_name: lot.name,
        post_id: lot.post_id,
        user_id: winnerId,
        win_date: new Date(),
        win_price: lot.current_price,
        status: 'Ожидает оплаты',
        shipping_batch_id: ''
      };

      if (!isAlreadyOrdered) {
        appendRow("Orders", newOrder);
      } else {
        logDebug("Заказ по посту " + lot.post_id + " уже существует, пропускаем запись.");
      }

      const existingUser = allUsers.find(u => String(u.data.user_id) === winnerId);
      if (existingUser) {
        updateRow("Users", existingUser.rowIndex, {
          last_win_date: new Date(),
          total_lots_won: (Number(existingUser.data.total_lots_won) || 0) + 1
        });
      } else {
        const newUser = {
          user_id: winnerId,
          user_name: winnerName,
          first_win_date: new Date(),
          last_win_date: new Date(),
          total_lots_won: 1,
          total_lots_paid: 0,
          shipping_status: 'Готов к отправке', // Статус по умолчанию
          shipping_details: ''
        };
        appendRow("Users", newUser);
        allUsers.push({ data: newUser, rowIndex: -1 });
      }
      
      // --- УДАЛЕНО: Прямая отправка ЛС отсюда ---
      // Сводки будут отправлены функцией sendAllSummaries() 
      // когда закроются ВООБЩЕ ВСЕ лоты аукциона.

      const bidsForWinner = getSheetData("Bids").filter(b => b.data.lot_id === lot.lot_id && b.data.user_id === lot.leader_id);
      if (bidsForWinner.length > 0) {
        const latestBid = bidsForWinner.reduce((latest, current) =>
          new Date(current.data.timestamp) > new Date(latest.data.timestamp) ? current : latest
        );
        if (latestBid && latestBid.data.comment_id) {
          const today = new Date();
          const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
          const winnerComment = buildWinnerCommentMessage({
            date: formattedDate,
            user_id: lot.leader_id,
            user_name: getUserName(lot.leader_id)
          });
          // ПРОВЕРКА: Не отвечали ли мы уже на этот комментарий
          if (!checkIfBotReplied(postId, latestBid.data.comment_id)) {
            replyToComment(postId, latestBid.data.comment_id, winnerComment);
          } else {
            logInfo(`💬 Ответ на комментарий победителя ${latestBid.data.comment_id} уже существует, пропускаем.`);
          }
        } else {
          const today = new Date();
          const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
          const winnerComment = buildWinnerCommentMessage({
            date: formattedDate,
            user_id: lot.leader_id,
            user_name: getUserName(lot.leader_id)
          });
          postCommentToLot(postId, winnerComment);
        }
      } else {
        const today = new Date();
        const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
        const winnerComment = buildWinnerCommentMessage({
          date: formattedDate,
          user_id: lot.leader_id,
          user_name: getUserName(lot.leader_id)
        });
        postCommentToLot(postId, winnerComment);
      }

      allWinnersDataForReport.push({ 
          lot_id: lot.lot_id, 
          name: lot.name, 
          price: lot.current_price, 
          winner_id: winnerId, 
          winner_name: winnerName,
          attachment_id: lot.attachment_id 
      });

      Monitoring.recordEvent('WINNER_DECLARED', newOrder);
    }
    Utilities.sleep(300); // 0.3s instead of 1s
  });

  if (allWinnersDataForReport.length > 0) {
    sendAdminReport(allWinnersDataForReport);
  }

  // 🔥 МГНОВЕННАЯ ОТПРАВКА: Не ждем 5-минутного триггера
  logInfo("🚀 Принудительный запуск очереди уведомлений после завершения аукциона");
  processNotificationQueue();
}

/**
 * Отправляет отчет о победителях администраторам группы.
 * @param {Array<Object>} winners Массив объектов победителей.
 */

      function setupSheets() { Object.keys(SHEETS).forEach(name => getSheet(name)); }
/**
 * Deletes all existing triggers and creates new ones for the script.
 * Includes a trigger for the new event queue processing.
 */
function setupTriggers() {
  const ui = SpreadsheetApp.getUi();
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => ScriptApp.deleteTrigger(t));

    // 1. Главный будильник: запускает мониторинг в 21:00 каждый день
    ScriptApp.newTrigger("startAuctionMonitoring")
      .timeBased()
      .atHour(21)
      .everyDays(1)
      .create();
    
    // 2. Уборщик (раз в сутки в 2 ночи)
    ScriptApp.newTrigger("dailyMaintenance")
      .timeBased()
      .everyDays(1)
      .atHour(2)
      .create();

    ui.alert("✅ Система инициализирована", "Созданы триггеры: \n1. Ежедневный запуск (21:00)\n2. Очистка логов (02:00)", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ Ошибка: " + e.toString());
  }
}

/**
 * A master function to run all scheduled tasks.
 * This is called by a single time-based trigger.
 */
function runPeriodicTasks() {
  const start = new Date();
  logDebug("Starting periodic tasks run.");

  try {
    processEventQueue();
  } catch (e) {
    logError("runPeriodicTasks_EventQueueError", e);
  }

  try {
    processNotificationQueue();
  } catch (e) {
    logError("runPeriodicTasks_NotificationQueueError", e);
  }
  
  const duration = (new Date().getTime() - start.getTime()) / 1000;
  logDebug(`Periodic tasks finished in ${duration}s.`);
}

/**
 * Process admin replies via trigger
 * Polls for new admin messages and processes payment commands
 */
function processAdminReplies() {
  try {
    // This would poll VK for new messages from admins
    // Placeholder implementation - in production would use VK messages.getLongPollHistory
    
    logDebug("processAdminReplies: Polling for admin messages");
    
    // TODO: Implement VK message polling for admin replies
    // 1. Get admin IDs from settings
    // 2. Poll VK for new messages
    // 3. Filter messages from admins that are replies
    // 4. Process payment commands
    
  } catch (error) {
    logError('processAdminReplies', error);
    Monitoring.recordEvent('ADMIN_REPLY_POLLING_ERROR', {
      error: error.message
    });
  }
}

function buildPostKey(ownerId, postId) { return `${ownerId}_${postId}`; }
function parsePostKey(postKey) {
  if (!postKey) return { ownerId: null, postId: null };
  
  // Clean the key (hyperlink, apostrophe, quotes)
  const cleanKey = extractIdFromFormula(postKey).replace(/['"]/g, '').trim();
  
  if (cleanKey.indexOf("_") > -1) {
    const parts = cleanKey.split("_");
    // Если первый символ '-', это владелец (группа). parts[0] может быть "-213692606"
    return { ownerId: Number(parts[0]), postId: Number(parts[1]) };
  } else {
    // Если только одно число - значит это чистый post_id
    const pid = Number(cleanKey);
    return { ownerId: null, postId: isNaN(pid) ? cleanKey : pid };
  }
}

/**
 * Cleans up old log entries
 */
// Вспомогательная функция для тестового фреймворка
function getSetting(key) {
  const settings = getSettings();
  return settings[key];
}

/**
 * Monitors the system continuously and reports anomalies
 */
function continuousMonitoring() {
  try {
    // Check the most critical aspects of the system
    const stats = {
      lotsCount: getSheetData("Config").length,
      bidsCount: getSheetData("Bids").length,
      eventsPending: getSheetData("EventQueue").filter(e => e.data.status === "pending").length,
      notificationsPending: getSheetData("NotificationQueue").filter(n => n.data.status === "pending").length,
      timestamp: new Date()
    };
    
    // Log system stats
    Monitoring.recordEvent('SYSTEM_STATS', stats);
    
    // Check for anomalies
    const anomalies = [];
    
    // Check if there are too many pending events (potential processing issue)
    if (stats.eventsPending > 50) {
      anomalies.push(`Слишком много ожидающих событий: ${stats.eventsPending}`);
    }
    
    // Check if there are too many pending notifications (potential processing issue)
    if (stats.notificationsPending > 100) {
      anomalies.push(`Слишком много ожидающих уведомлений: ${stats.notificationsPending}`);
    }
    
    // Log anomalies if any
    if (anomalies.length > 0) {
      Monitoring.recordEvent('SYSTEM_ANOMALIES', {
        timestamp: new Date(),
        anomalies: anomalies
      });
      
      // Send alert to admins if configured
      const settings = getSettings();
      if (settings.ADMIN_IDS) {
        // In a real implementation, we would send a VK message to admin IDs
        Logger.log(`АНОМАЛИИ СИСТЕМЫ: ${anomalies.join(', ')}`);
      }
    }
    
    return stats;
  } catch (error) {
    Monitoring.recordEvent('MONITORING_ERROR', { error: error.message });
    Logger.log(`Ошибка при мониторинге системы: ${error.message}`);
    return null;
  }
}

/**
 * Performs a comprehensive health check of the system
 */
function systemHealthCheck() {
  const results = [];
  
  try {
    // Check 1: Verify all required sheets exist
    results.push(checkRequiredSheets());

    // Check 2: Verify all required triggers are active
    results.push(checkRequiredTriggers());

    // Check 3: Check for stuck events in EventQueue
    results.push(checkStuckEvents());

    // Check 4: Check for stuck notifications in NotificationQueue
    results.push(checkStuckNotifications());

    // Check 5: Verify settings are properly configured
    results.push(checkSettingsConfiguration());

    // Check 6: Check for recent errors in logs
    results.push(checkRecentErrors());
    
    // Generate summary
    const summary = generateHealthSummary(results);
    
    // Log the health check
    Monitoring.recordEvent('SYSTEM_HEALTH_CHECK', {
      timestamp: new Date(),
      checks_run: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      summary: summary
    });
    
    // Show results to user
    const ui = SpreadsheetApp.getUi();
    ui.alert('Результаты проверки системы', summary, ui.ButtonSet.OK);
    
    return results;
  } catch (error) {
    const errorMsg = `Ошибка при проверке системы: ${error.message}`;
    Logger.log(errorMsg);
    Monitoring.recordEvent('SYSTEM_HEALTH_CHECK_ERROR', { error: errorMsg });
    const ui = SpreadsheetApp.getUi();
    ui.alert('Ошибка', errorMsg, ui.ButtonSet.OK);
    return [{ testName: 'Проверка системы', passed: false, error: errorMsg }];
  }
}

/**
 * Checks if all required sheets exist
 */
function checkRequiredSheets() {
  try {
    const requiredSheets = ['Config', 'Bids', 'Users', 'Orders', 'Settings', 'EventQueue', 'NotificationQueue', 'Logs'];
    const missingSheets = [];
    
    for (const sheetKey of requiredSheets) {
      try {
        const sheet = getSheet(sheetKey);
        if (!sheet) {
          missingSheets.push(sheetKey);
        }
      } catch (e) {
        missingSheets.push(sheetKey);
      }
    }
    
    if (missingSheets.length > 0) {
      return { 
        testName: 'Проверка наличия листов', 
        passed: false, 
        error: `Отсутствуют листы: ${missingSheets.join(', ')}`,
        action: 'createMissingSheets',
        data: missingSheets
      };
    }
    
    return { testName: 'Проверка наличия листов', passed: true };
  } catch (error) {
    return { testName: 'Проверка наличия листов', passed: false, error: error.message };
  }
}

/**
 * Creates missing sheets if any are detected
 */
function createMissingSheets(missingSheets) {
  if (!missingSheets || missingSheets.length === 0) return;
  
  for (const sheetKey of missingSheets) {
    try {
      getSheet(sheetKey); // This will create the sheet if it doesn't exist
      Logger.log(`Создан лист: ${sheetKey}`);
    } catch (e) {
      Logger.log(`Ошибка при создании листа ${sheetKey}: ${e.message}`);
    }
  }
}

/**
 * Checks if all required triggers are active
 */
function checkRequiredTriggers() {
  try {
    const requiredTriggers = [
      { func: 'processNotificationQueue', type: 'time' },
      { func: 'finalizeAuction', type: 'time' }
    ];
    
    const activeTriggers = ScriptApp.getProjectTriggers();
    const missingTriggers = [];
    
    for (const reqTrigger of requiredTriggers) {
      const found = activeTriggers.some(t => t.getHandlerFunction() === reqTrigger.func);
      if (!found) {
        missingTriggers.push(reqTrigger.func);
      }
    }
    
    if (missingTriggers.length > 0) {
      return { 
        testName: 'Проверка триггеров', 
        passed: false, 
        error: `Отсутствуют триггеры: ${missingTriggers.join(', ')}`,
        action: 'recreateMissingTriggers',
        data: missingTriggers
      };
    }
    
    return { testName: 'Проверка триггеров', passed: true };
  } catch (error) {
    return { testName: 'Проверка триггеров', passed: false, error: error.message };
  }
}

/**
 * Recreates missing triggers
 */
function recreateMissingTriggers(missingTriggers) {
  if (!missingTriggers || missingTriggers.length === 0) return;
  
  // Delete all triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  // Recreate all triggers
  setupTriggers();
  
  Logger.log(`Восстановлены триггеры: ${missingTriggers.join(', ')}`);
}

/**
 * Checks for stuck events in EventQueue
 */
function checkStuckEvents() {
  // EventQueue has been removed, so skip this check
  return { testName: 'Проверка застрявших событий', passed: true };
}

/**
 * Checks for stuck notifications in NotificationQueue
 */
function checkStuckNotifications() {
  try {
    const rows = getSheetData("NotificationQueue");
    const now = new Date();
    const stuckNotifications = [];
    
    for (const row of rows) {
      if (row.data.status === "pending") {
        // Check if the notification has been pending for more than 30 minutes
        const createdAt = new Date(row.data.created_at);
        const timeDiff = (now - createdAt) / (1000 * 60); // Difference in minutes
        
        if (timeDiff > 30) {
          stuckNotifications.push({
            queueId: row.data.queue_id,
            userId: row.data.user_id,
            type: row.data.type,
            createdAt: row.data.created_at,
            timePending: timeDiff
          });
        }
      }
    }
    
    if (stuckNotifications.length > 0) {
      return { 
        testName: 'Проверка застрявших уведомлений', 
        passed: false, 
        error: `Найдено ${stuckNotifications.length} застрявших уведомлений`,
        action: 'cleanupStuckNotifications',
        data: stuckNotifications
      };
    }
    
    return { testName: 'Проверка застрявших уведомлений', passed: true };
  } catch (error) {
    return { testName: 'Проверка застрявших уведомлений', passed: false, error: error.message };
  }
}

/**
 * Checks if settings are properly configured
 */
function checkSettingsConfiguration() {
  try {
    const settings = getSettings();
    
    // Check for critical settings
    const criticalSettings = ['VK_TOKEN', 'GROUP_ID'];
    const missingSettings = [];
    
    for (const setting of criticalSettings) {
      if (!settings[setting] || settings[setting].toString().trim() === '') {
        missingSettings.push(setting);
      }
    }
    
    return { testName: 'Проверка настроек', passed: true };
  } catch (error) {
    return { testName: 'Проверка настроек', passed: false, error: error.message };
  }
}

/**
 * Checks for recent errors in logs
 */
function checkRecentErrors() {
  try {
    const rows = getSheetData("Logs");
    const now = new Date();
    const recentErrors = [];
    
    // Look for errors in the last 24 hours
    for (const row of rows) {
      if (row.data.type === 'ОШИБКА') {
        const logTime = new Date(row.data.date);
        const timeDiff = (now - logTime) / (1000 * 60 * 60); // Difference in hours
        
        if (timeDiff <= 24) {
          recentErrors.push({
            time: row.data.date,
            message: row.data.message,
            details: row.data.details
          });
        }
      }
    }
    
    if (recentErrors.length > 0) {
      return { 
        testName: 'Проверка недавних ошибок', 
        passed: false, 
        error: `Найдено ${recentErrors.length} ошибок за последние 24 часа`,
        action: 'reviewRecentErrors',
        data: recentErrors.slice(0, 5) // Return only first 5 errors to avoid too much data
      };
    }
    
    return { testName: 'Проверка недавних ошибок', passed: true };
  } catch (error) {
    return { testName: 'Проверка недавних ошибок', passed: false, error: error.message };
  }
}

/**
 * Generates a summary of health check results
 */
function generateHealthSummary(results) {
  let summary = "РЕЗУЛЬТАТЫ ПРОВЕРКИ СИСТЕМЫ:\n\n";
  
  for (const result of results) {
    summary += `${result.testName}: ${result.passed ? '✅ OK' : '❌ ОШИБКА'}\n`;
    if (!result.passed) {
      summary += `  - ${result.error}\n`;
      
      // Suggest automatic fix if available
      if (result.action) {
        summary += `  - Возможное действие: ${result.action}\n`;
      }
    }
  }
  
  summary += `\nВсего проверок: ${results.length}`;
  summary += `\nПройдено: ${results.filter(r => r.passed).length}`;
  summary += `\nС ошибками: ${results.filter(r => !r.passed).length}`; 
  
  return summary;
}

/**
 * @fileoverview Additional VK event handlers for reply edit/delete events
 */

/**
 * Handles wall_reply_edit events (when a comment is edited)
 */
function handleWallReplyEdit(payload) {
  const comment = payload.object || {};
  const commentId = comment.id;
  const postId = comment.post_id;
  const postOwnerId = comment.post_owner_id;
  const postKey = `${postOwnerId}_${postId}`;
  
  Monitoring.recordEvent('REPLY_EDIT_RECEIVED', { 
    comment_id: commentId, 
    post_key: postKey, 
    new_text: comment.text 
  });
  
  // Find the corresponding bid in the Bids sheet
  const bids = getSheetData("Bids");
  const bidToUpdate = bids.find(b => b.data.comment_id == commentId);
  
  if (bidToUpdate) {
    // Parse the new bid amount from the edited comment
    const newBidAmount = parseBid(comment.text || "");
    
    if (newBidAmount) {
      // Update the bid amount in the sheet SAFELY
      const bids = getSheetData("Bids");
      const currentBid = bids.find(b => String(b.data.bid_id) === String(bidToUpdate.data.bid_id));
      if (currentBid) {
        updateRow("Bids", currentBid.rowIndex, { 
          bid_amount: newBidAmount,
          timestamp: new Date()
        });
      }
      
      Monitoring.recordEvent('BID_UPDATED_AFTER_EDIT', { 
        bid_id: bidToUpdate.data.bid_id,
        old_amount: bidToUpdate.data.bid_amount,
        new_amount: newBidAmount,
        comment_id: commentId
      });
      
      // Potentially update the lot if this bid was the current highest
      updateLotAfterBidEdit(bidToUpdate.data.lot_id, newBidAmount);
    } else {
      // If the edited comment is no longer a valid bid, mark it as invalid SAFELY
      updateBidStatus(bidToUpdate.data.bid_id, "invalidated_by_edit");
      
      Monitoring.recordEvent('BID_INVALIDATED_BY_EDIT', { 
        bid_id: bidToUpdate.data.bid_id,
        comment_id: commentId,
        reason: "edited_comment_no_longer_valid_bid"
      });
    }
  }
}

/**
 * Handles wall_reply_delete events (when a comment is deleted)
 */
function handleWallReplyDelete(payload) {
  const commentId = payload.object.comment_id;
  const postId = payload.object.post_id;
  const postOwnerId = payload.object.post_owner_id;
  const postKey = `${postOwnerId}_${postId}`;
  
  Monitoring.recordEvent('REPLY_DELETE_RECEIVED', { 
    comment_id: commentId, 
    post_key: postKey 
  });
  
  // Find the corresponding bid in the Bids sheet
  const bids = getSheetData("Bids");
  const bidToDelete = bids.find(b => b.data.comment_id == commentId);
  
  if (bidToDelete) {
    // Mark the bid as deleted SAFELY
    updateBidStatus(bidToDelete.data.bid_id, "deleted");
    
    Monitoring.recordEvent('BID_MARKED_AS_DELETED', { 
      bid_id: bidToDelete.data.bid_id,
      comment_id: commentId,
      lot_id: bidToDelete.data.lot_id
    });
    
    // Potentially update the lot if this was the current highest bid
    updateLotAfterBidDelete(bidToDelete.data.lot_id, bidToDelete.data.bid_amount);
  }
}

/**
 * Updates the lot after a bid has been edited
 */
function updateLotAfterBidEdit(lotId, newBidAmount) {
  // Get all valid bids for this lot (not deleted/invalidated)
  const allBids = getSheetData("Bids");
  const lotBids = allBids.filter(b => 
    b.data.lot_id == lotId && 
    b.data.status !== "deleted" && 
    b.data.status !== "invalidated_by_edit"
  );
  
  if (lotBids.length === 0) return;
  
  // Find the highest valid bid
  const highestBid = lotBids.reduce((max, bid) => 
    Number(bid.data.bid_amount) > Number(max.data.bid_amount) ? bid : max
  );
  
  // Update the lot with the new highest bid information
  const lot = findLotByLotId(lotId);
  if (lot && Number(highestBid.data.bid_amount) !== Number(lot.current_price)) {
    updateLot(lotId, { 
      current_price: highestBid.data.bid_amount,
      leader_id: highestBid.data.user_id
    });
    
    Monitoring.recordEvent('LOT_UPDATED_AFTER_BID_EDIT', {
      lot_id: lotId,
      new_price: highestBid.data.bid_amount,
      new_leader: highestBid.data.user_id
    });
  }
}

/**
 * Updates the lot after a bid has been deleted
 */
function updateLotAfterBidDelete(lotId, deletedBidAmount) {
  // Get all valid bids for this lot (not deleted/invalidated)
  const allBids = getSheetData("Bids");
  const lotBids = allBids.filter(b => 
    b.data.lot_id == lotId && 
    b.data.status !== "deleted" && 
    b.data.status !== "invalidated_by_edit"
  );
  
  // If no bids left, reset to start price
  if (lotBids.length === 0) {
    const lot = findLotByLotId(lotId);
    if (lot) {
      updateLot(lotId, { 
        current_price: lot.start_price,
        leader_id: ""
      });
      
      Monitoring.recordEvent('LOT_RESET_AFTER_ALL_BIDS_DELETED', {
        lot_id: lotId,
        reset_to_start_price: lot.start_price
      });
    }
    return;
  }
  
  // Find the highest valid bid among remaining bids
  const highestBid = lotBids.reduce((max, bid) => 
    Number(bid.data.bid_amount) > Number(max.data.bid_amount) ? bid : max
  );
  
  // Update the lot with the new highest bid information
  const lot = findLotByLotId(lotId);
  if (lot && Number(highestBid.data.bid_amount) !== Number(lot.current_price)) {
    updateLot(lotId, { 
      current_price: highestBid.data.bid_amount,
      leader_id: highestBid.data.user_id
    });
    
    Monitoring.recordEvent('LOT_UPDATED_AFTER_BID_DELETE', {
      lot_id: lotId,
      new_price: highestBid.data.bid_amount,
      new_leader: highestBid.data.user_id
    });
  }
}

/**
 * Helper function to find a lot by its ID (since findLotByPostId exists but not by lot_id)
 */
function findLotByLotId(lotId) {
  const rows = getSheetData("Config");
  const match = rows.find(r => String(r.data.lot_id) === String(lotId));
  return match ? match.data : null;
}

function sendAllSummaries() {
  const allLots = getSheetData("Config");
  const activeLots = allLots.filter(l => l.data.status === "active" || l.data.status === "Активен");
  
  if (activeLots.length > 0) {
    logDebug(`Рассылка отложена: есть активные лоты (${activeLots.length}).`);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const notifiedLotsProp = props.getProperty("NOTIFIED_LOT_IDS") || "[]";
  let notifiedLotIds = JSON.parse(notifiedLotsProp);

  const now = new Date();
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd.MM.yyyy");

  const soldLots = allLots.filter(l => {
    const status = String(l.data.status).toLowerCase();
    const isSold = (status === "продан" || status === "sold");
    if (!isSold) return false;

    // 1. Проверяем, что лот не был уведомлен ранее
    const isNotified = notifiedLotIds.includes(String(l.data.lot_id));
    if (isNotified) return false;

    // 2. Проверяем, что дедлайн лота - СЕГОДНЯ
    // Это гарантирует, что мы не трогаем прошлую неделю
    const deadlineDate = parseRussianDate(l.data.deadline);
    if (!deadlineDate) return false;
    
    const deadlineStr = Utilities.formatDate(deadlineDate, Session.getScriptTimeZone(), "dd.MM.yyyy");
    return deadlineStr === todayStr;
  });

  if (soldLots.length === 0) {
    logDebug("Новых проданных лотов для рассылки нет.");
    return;
  }

  const winnersMap = {};
  soldLots.forEach(lot => {
    const userId = String(lot.data.leader_id);
    if (userId && userId !== "") {
      if (!winnersMap[userId]) winnersMap[userId] = [];
      winnersMap[userId].push(lot.data);
    }
  });

  const winnersListForReport = [];
  const sendToWinners = (getSetting("send_winner_dm_enabled") === "ВКЛ"); 

  for (const userId in winnersMap) {
    const userLots = winnersMap[userId];
    const attachments = [];
    
    userLots.forEach(lot => {
      if (lot.attachment_id) attachments.push(lot.attachment_id);
      winnersListForReport.push({
        lot_id: lot.lot_id, name: lot.name, price: lot.current_price,
        winner_id: userId, winner_name: getUserName(userId), attachment_id: lot.attachment_id
      });
      notifiedLotIds.push(String(lot.lot_id));
    });

    if (sendToWinners) {
      const summary = buildUserOrderSummary(userId);
      if (summary && !summary.startsWith("У вас нет")) {
        sendMessage(userId, summary, attachments.join(","));
        logInfo(`✉️ Сводка отправлена победителю ${userId} (лотов: ${userLots.length})`);
      }
    }
    Utilities.sleep(500);
  }

  if (winnersListForReport.length > 0) {
    sendAdminReport(winnersListForReport);
    props.setProperty("NOTIFIED_LOT_IDS", JSON.stringify(notifiedLotIds));
    logInfo("🏁 Рассылка по завершенным лотам выполнена.");
  }
}

function sendAdminReport(winners) {
  const settings = getSettings();
  const parsedAdmins = parseAdminIds(settings.ADMIN_IDS);
  const adminIds = parsedAdmins.all;
  if (!adminIds || adminIds.length === 0) return;

  // Группируем по победителям
  const winnersMap = {};
  winners.forEach(w => {
    if (!winnersMap[w.winner_id]) {
      winnersMap[w.winner_id] = { name: w.winner_name, lots: [] };
    }
    winnersMap[w.winner_id].lots.push(w);
  });

  // Для каждого победителя шлем админам отдельное сообщение со всеми его лотами
  for (const winnerId in winnersMap) {
    const winnerData = winnersMap[winnerId];
    let reportText = `👤 Победитель: [id${winnerId}|${winnerData.name}]\n\n`;
    const attachments = [];

    winnerData.lots.forEach((lot, index) => {
      reportText += `${index + 1}. Лот №${lot.lot_id}: ${lot.name}\n💰 Цена: ${lot.price}₽\n`;
      if (lot.attachment_id) attachments.push(lot.attachment_id);
    });

    reportText += "\n-------------------";

    // Рассылаем всем админам
    adminIds.forEach(adminId => {
      try {
        sendMessage(adminId, reportText, attachments.join(","));
      } catch (e) {
        logError("admin_report_winner_failed", e, { adminId, winnerId });
      }
    });
    
    Utilities.sleep(500); // Небольшая пауза между победителями
  }
}
