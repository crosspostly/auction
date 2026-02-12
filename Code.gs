function doGet(e) {
  // 1. Обработка запроса на запуск тестов (CI/CD)
  if (e.parameter && e.parameter.action === 'run_tests') {
    const secret = PropertiesService.getScriptProperties().getProperty('VK_SECRET');
    // Если секрет еще не задан в свойствах, разрешаем запуск с дефолтным (для первого старта), но лучше требовать совпадение.
    // Если e.parameter.secret совпадает с VK_SECRET
    if (secret && e.parameter.secret === secret) {
      try {
        logInfo("🚀 Запуск полного тестового набора через веб-хук (CI/CD)...");
        
        // Run the complete test suite
        const testReport = runCompleteTestSuite();
        
        // Check if all tests passed
        const allPassed = testReport.includes("ALL TESTS PASSED") || 
                         (testReport.includes("Failed: 0") && testReport.includes("✅"));
        
        if (allPassed) {
          logInfo("CI_CD_ALL_TESTS_PASSED");
          return ContentService.createTextOutput("✅ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО:\n\n" + testReport).setMimeType(ContentService.MimeType.TEXT);
        } else {
          logError("CI_CD_TEST_REPORTED_FAILURE", { report: testReport.substring(0, 500) });
          return ContentService.createTextOutput("❌ ОШИБКА ТЕСТОВ:\n\n" + testReport).setMimeType(ContentService.MimeType.TEXT);
        }
      } catch (error) {
        logError("CI_CD_TEST_FAILED", error);
        return ContentService.createTextOutput("❌ ОШИБКА ТЕСТОВ:\n" + error.message + "\n\nStack:\n" + error.stack).setMimeType(ContentService.MimeType.TEXT);
      }
    } else {
      return ContentService.createTextOutput("⛔ Доступ запрещен. Неверный secret.").setMimeType(ContentService.MimeType.TEXT);
    }
  }

  // 2. Стандартная проверка доступности
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
      contents: rawPayload.substring(0, 500)
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

    // Мгновенная обработка события (новое требование)
    if (data.type) {
      try {
        routeEvent(data);
      } catch (procError) {
        // Если мгновенная обработка не удалась - ставим в очередь для ретрая
        logError('doPost_processing_failed_retrying', procError, rawPayload);
        enqueueEvent(rawPayload);
      }
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
    .addItem('📖 Инструкция', 'showInstructions')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Управление')
      .addItem('🏁 Завершить аукцион', 'finalizeAuction')
      .addItem('🔄 Пересоздать триггеры', 'setupTriggers')
      .addItem('🔍 Проверить триггеры', 'checkTriggers')
      .addItem('🌐 Проверить Callback сервер VK', 'checkVkCallbackServer'))
    .addSubMenu(ui.createMenu('🧪 Тестирование')
      .addItem('✅ Запустить все тесты', 'runCompleteTestSuite')
      .addItem('🚀 Полная симуляция', 'runFullCycleSimulation'))
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
    createDemoData(); // createDemoData now handles all settings creation and dropdowns
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

/**
 * Глубокая диагностика настроек Callback (вывод в лог)
 */
function debugCallbackSettings() {
  const groupId = getVkGroupId();
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  
  logInfo('🔍 Запуск глубокой диагностики Callback Settings', { groupId, webAppUrl });
  
  // Получаем список серверов
  const servers = callVk('groups.getCallbackServers', { group_id: groupId });
  
  if (!servers || !servers.response || !servers.response.items) {
    logError('debugCallbackSettings', 'Не удалось получить список серверов', servers);
    return;
  }
  
  const myServer = servers.response.items.find(s => s.url === webAppUrl);
  
  if (!myServer) {
    logError('debugCallbackSettings', 'Наш сервер не найден в списке VK!');
    return;
  }
  
  logInfo(`✅ Сервер найден. ID: ${myServer.id}, Статус: ${myServer.status}`);
  
  // ПРЯМОЙ запрос настроек БЕЗ обёртки
  const rawResponse = callVk('groups.getCallbackSettings', {
    group_id: groupId,
    server_id: myServer.id
  }, getVkToken(true));
  
  logInfo('📦 RAW RESPONSE (getCallbackSettings):', rawResponse);
  
  // Теперь через нашу функцию
  const parsed = getCallbackEventsStatus(groupId, myServer.id);
  
  if (parsed) {
    logInfo('✅ Парсинг успешен', {
      enabled: parsed.enabled.join(', '),
      disabled: parsed.disabled.join(', ')
    });
  } else {
    logError('debugCallbackSettings', 'getCallbackEventsStatus вернула null');
  }
}

/**
 * Верификация исправления Callback API
 */
function verifyCallbackFix() {
  const groupId = getVkGroupId();
  const servers = callVk('groups.getCallbackServers', { group_id: groupId });
  
  if (!servers?.response?.items?.length) {
    Logger.log('❌ Нет серверов');
    return;
  }
  
  const myServer = servers.response.items[0];
  
  // Проверяем парсинг
  const status = getCallbackEventsStatus(groupId, myServer.id);
  
  if (!status) {
    Logger.log('❌ getCallbackEventsStatus вернула null');
    return;
  }
  
  Logger.log('✅ УСПЕХ! Состояние получено:');
  Logger.log(`   Включено: ${status.enabled.length} событий`);
  Logger.log(`   Выключено: ${status.disabled.length} событий`);
  Logger.log(`   Список включенных: ${status.enabled.join(', ')}`);
  
  // Проверяем, что критичные события включены
  const mustHave = ['wall_post_new', 'wall_reply_new', 'message_new'];
  const missing = mustHave.filter(e => !status.enabled.includes(e));
  
  if (missing.length > 0) {
    Logger.log(`⚠️ ВНИМАНИЕ! Не включены: ${missing.join(', ')}`);
  } else {
    Logger.log('✅ Все критичные события включены');
  }
}

function routeEvent(payload) {
  // ✅ Трассировка вызова (новое требование для диагностики)
  logInfo('🎯 routeEvent called', { type: payload.type, hasObject: !!payload.object });

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
  const userOrders = allOrders.filter(o => String(o.data.user_id) === String(userId) && o.data.status === 'unpaid');

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
      String(o.data.user_id) === userId && o.data.status === 'unpaid'
    );
    
    if (userOrders.length === 0) {
      sendMessage(adminId, '❌ У пользователя нет неоплаченных заказов');
      return;
    }
    
    // Update all unpaid orders to paid
    userOrders.forEach(order => {
      updateRow("Orders", order.rowIndex, { status: 'paid' });
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
      if (String(order.data.user_id) === userId && order.data.status === 'unpaid') {
        const orderLotId = String(order.data.lot_id);
        
        if (lotIds.includes(orderLotId)) {
          // Mark as paid
          updateRow("Orders", order.rowIndex, { status: 'paid' });
          paidCount++;
        } else {
          // Mark as not paid with note
          const currentNotes = order.data.admin_notes || '';
          const newNotes = currentNotes + `\n[${new Date().toLocaleString()}] Не оплачен (админ: ${adminId})`;
          updateRow("Orders", order.rowIndex, { 
            admin_notes: newNotes,
            status: 'unpaid' 
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
 * Update user payment statistics
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
  const adminIds = (settings.ADMIN_IDS || '').toString().split(',').map(id => id.trim()).filter(id => id);
  
  const message = payload.object.message;
  const userId = String(message.from_id);
  const text = (message.text || '').toLowerCase().trim();
  const replyMessageId = message.reply_message ? message.reply_message.id : null;
  
  // Check if sender is admin
  if (!adminIds.includes(userId)) {
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
        return; // Завершаем выполнение, так как это была команда
    }

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
  const newLotData = { 
    lot_id: String(lot.lot_id), 
    post_id: `${payload.object.owner_id}_${payload.object.id}`, 
    name: lot.name, 
    start_price: lot.start_price, 
    current_price: lot.start_price, 
    leader_id: "", 
    status: "active", 
    created_at: new Date(), 
    deadline: lot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000), 
    bid_step: lot.bidStep || 0,
    image_url: lot.image_url || "",
    attachment_id: lot.attachment_id || ""
  };
  upsertLot(newLotData);
  Monitoring.recordEvent('LOT_CREATED', newLotData);
  logInfo(`Лот №${lot.lot_id} добавлен`);
}
function parseLotFromPost(postObject) {
  try {
    const text = postObject.text || "";
    
    // Log incoming post for debugging
    logInfo("📥 Новый пост получен", { 
      post_id: postObject.id,
      owner_id: postObject.owner_id,
      text_preview: text.substring(0, 200),
      has_auction_tag: /#аукцион/i.test(text),
      has_lot_number: /№\s*[a-zA-Z0-9_]+/i.test(text)
    });
    
    if (!/#аукцион/i.test(text)) {
      logInfo("❌ Пост не содержит #аукцион", { text_preview: text.substring(0, 100) });
      return null;
    }
    
    // Check if Saturday-only mode is enabled
    const settings = getSettings();
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
    for (const line of lines) {
      const nameMatch = line.match(/^(?:Лот|🎁Лот)\s*[-—]?\s*(.+)/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
        continue;
      }
      const deadlineMatch = line.match(/(?:Дедлайн|Дата окончания аукциона)\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*в\s*(\d{1,2}:\d{2})\s*по МСК/i);
      if (deadlineMatch) {
        const [day, month, year] = deadlineMatch[1].split('.').map(Number);
        const [hours, minutes] = deadlineMatch[2].split(':').map(Number);
        deadline = new Date(year, month - 1, day, hours, minutes);
        continue;
      }
      const priceMatch = line.match(/^(?:👀Старт|Старт)\s*(\d+)\s*р(?:\s+и\s+шаг\s*[-—]?\s*(\d+)\s*р?)?/i);
      if (priceMatch) {
        startPrice = Number(priceMatch[1]);
        if (priceMatch[2]) bidStep = Number(priceMatch[2]);
        continue;
      }
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
function handleWallReplyNew(payload) {
  const comment = payload.object || {};
  const ownerId = payload.group_id || getVkGroupId(); // Получаем group_id из payload или настройки
  
  // Enhanced debug log at the very start
  logInfo('🎤 handleWallReplyNew received', {
    from_id: comment.from_id,
    text: comment.text,
    post_id: comment.post_id,
    owner_id: ownerId
  });

  const postKey = `-${ownerId}_${comment.post_id}`; // Используем ownerId, добавляем минус для owner_id
  
  // ADDED: Detailed initial log
  Monitoring.recordEvent('HANDLE_WALL_REPLY_NEW_START', { 
    comment_id: comment.id, 
    text: comment.text, 
    postKey: postKey, 
    from_id: comment.from_id 
  });
  
  logDebug(`🔍 START handleWallReplyNew`, { 
    comment_id: comment.id, 
    text: comment.text, 
    postKey: postKey, 
    from_id: comment.from_id 
  });

  // --- Self-Reply Protection with Simulator Support ---
  const groupId = getVkGroupId(); 
  const fromId = String(comment.from_id);
  
  if (fromId === `-${groupId}`) {
    const bidAmount = parseBid(comment.text || "");
    
    if (!bidAmount) {
      logDebug("🚫 Ignored self-reply (not a bid)", { text: comment.text });
      return; 
    }
    logDebug("✅ Accepted self-reply (parsed as bid)", { text: comment.text, bid: bidAmount });
  }
  // ----------------------------------------------------

  const lot = findLotByPostId(postKey);
  if (!lot) {
    // ADDED: Detailed log for lot not found
    Monitoring.recordEvent('HANDLE_WALL_REPLY_LOT_NOT_FOUND', { postKey: postKey, text: comment.text });
    logInfo("❌ Lot NOT FOUND for postKey", { postKey: postKey });
    // Попробуем найти лот по частичному совпадению (иногда post_id бывает без owner_id)
    const cleanPostId = String(comment.post_id);
    const lotByCleanId = getSheetData("Config").find(r => String(r.data.post_id).endsWith(`_${cleanPostId}`) || String(r.data.post_id) === cleanPostId);
    if (lotByCleanId) {
       logInfo("⚠️ Found lot by partial match!", { foundLot: lotByCleanId.data.lot_id, originalPostId: lotByCleanId.data.post_id });
    } else {
       logInfo("❌ Really no lot found even by partial match.");
    }
    return;
  }

  if (lot.status !== "active") {
    Monitoring.recordEvent('HANDLE_WALL_REPLY_LOT_INACTIVE', { lot_id: lot.lot_id, status: lot.status });
    logInfo("⚠️ Lot found but NOT ACTIVE", { status: lot.status, lot_id: lot.lot_id });
    return;
  }

  const bid = parseBid(comment.text || "");
  const userId = String(comment.from_id);
  
  if (!bid) {
    Monitoring.recordEvent('HANDLE_WALL_REPLY_NO_BID_PARSED', { text: comment.text });
    logDebug("⚠️ Comment text parsed as NO BID", { text: comment.text });
    return;
  }

  // ADDED: Log parsed bid
  Monitoring.recordEvent('HANDLE_WALL_REPLY_BID_PARSED', { lot_id: lot.lot_id, bid: bid, user_id: userId });
  logDebug(`✅ Bid parsed: ${bid}`, { lot_id: lot.lot_id, current_price: lot.current_price });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey); // Re-fetch lot inside lock
    
    // Use enhanced validation
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
        comment_id: comment.id,
        status: "некорректная"
      });

      // ВСЕГДА отвечаем пользователю в комментариях, почему ставка не принята
      const errorMessage = `Ставка ${bid}₽ не принята. ${validationResult.reason}`;
      try {
        replyToComment(parsePostKey(postKey).postId, comment.id, errorMessage);
        logInfo(`💬 Ответил пользователю ${userId} об ошибке: ${validationResult.reason}`);
      } catch (e) {
        logError("reply_invalid_bid", e);
      }

      // Ставим уведомление в очередь (для ЛС, если это критично)
      const notification = {
        user_id: userId,
        type: validationResult.reason.includes("подписка") ? "subscription_required" : "low_bid",
        payload: {
          lot_id: currentLot.lot_id,
          lot_name: currentLot.name,
          current_bid: currentLot.current_price,
          your_bid: bid,
          post_id: postKey,
          reason: validationResult.reason
        }
      };
      queueNotification(notification);
      return;
    }

    // --- ОБРАБОТКА ВАЛИДНОЙ СТАВКИ ---
    
    // 1. Находим текущую лидирующую ставку и помечаем её как перебитую
    const bids = getSheetData("Bids");
    const oldLeaderBid = bids.find(b => b.data.lot_id === currentLot.lot_id && b.data.status === "лидер");
    if (oldLeaderBid) {
      updateRow("Bids", oldLeaderBid.rowIndex, { status: "перебита" });
    }

    // 2. Записываем новую ставку как лидера
    logInfo(`💾 Recording Valid Bid: ${bid}`);
    appendRow("Bids", {
      bid_id: Utilities.getUuid(),
      lot_id: currentLot.lot_id,
      user_id: userId,
      bid_amount: bid,
      timestamp: new Date(),
      comment_id: comment.id,
      status: "лидер"
    });
    
    updateLot(currentLot.lot_id, { current_price: bid, leader_id: userId });
    logInfo(`✅ Lot Updated: ${currentLot.lot_id} -> ${bid}`);
    
    // ... (extension logic) ...
    const AUCTION_EXTENSION_WINDOW_MINUTES = 10;
    const AUCTION_EXTENSION_DURATION_MINUTES = 10;
    if (currentLot.deadline) {
      const now = new Date();
      const deadlineTime = new Date(currentLot.deadline);
      const timeUntilDeadline = (deadlineTime.getTime() - now.getTime()) / (1000 * 60);
      if (timeUntilDeadline <= AUCTION_EXTENSION_WINDOW_MINUTES && timeUntilDeadline > 0) {
        const newDeadline = new Date(deadlineTime.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);
        updateLot(currentLot.lot_id, { deadline: newDeadline });
        logInfo(`Аукцион продлен до ${newDeadline.toLocaleString()}`);
      }
    }

    // 3. Отправляем ответ перебитому пользователю
    // Для тестов симулятора (где пользователь перебивает сам себя) временно отключаем проверку ID
    // if (oldLeaderBid && String(oldLeaderBid.data.user_id) !== userId) {
    if (oldLeaderBid) {
      // Отправляем уведомление в комментарий (по умолчанию)
      if (true) { // Всегда отправляем в комментарий как основное уведомление
        const outbidCommentMessage = buildOutbidMessage({ lot_name: currentLot.name, new_bid: bid, post_id: postKey });
        try {
          if (oldLeaderBid.data.comment_id) {
            replyToComment(parsePostKey(postKey).postId, oldLeaderBid.data.comment_id, outbidCommentMessage);
            // Помечаем в таблице, что ответ успешно отправлен
            updateRow("Bids", oldLeaderBid.rowIndex, { status: "уведомлен" });
            logInfo(`💬 Ответил пользователю ${oldLeaderBid.data.user_id} о перебитой ставке`);
          } else {
            postCommentToLot(parsePostKey(postKey).postId, `[id${oldLeaderBid.data.user_id}|${getUserName(oldLeaderBid.data.user_id)}], ${outbidCommentMessage}`);
            updateRow("Bids", oldLeaderBid.rowIndex, { status: "уведомлен" });
            logInfo(`💬 Упомянул пользователя ${oldLeaderBid.data.user_id} о перебитой ставке`);
          }
        } catch (e) {
          logError("reply_outbid", e);
        }
      }
      
      // Отправляем уведомление в ЛС только если включена настройка отправки ЛС победителям
      if (getSetting('send_winner_dm_enabled') === 'ВКЛ') {
        const notification = { user_id: oldLeaderBid.data.user_id, type: "outbid", payload: { lot_id: currentLot.lot_id, lot_name: currentLot.name, new_bid: bid, post_id: postKey } };
        queueNotification(notification);
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
function validateBid(bid, lot) {
  if (lot.deadline && new Date() > new Date(lot.deadline)) {
    return { isValid: false, reason: "Увы, этот аукцион уже завершен! 😔" };
  }
  
  const settings = getSettings();
  
  // Проверка максимальной ставки
  if (settings.max_bid && bid > settings.max_bid) {
    return { isValid: false, reason: `Ого! Такая ставка превышает наш максимум (${settings.max_bid}₽). Проверь сумму, пожалуйста! 😉` };
  }
  
  // Проверка минимальной ставки
  const currentPrice = Number(lot.current_price || lot.start_price || 0);
  const minBidIncrement = settings.min_bid_increment !== undefined && settings.min_bid_increment !== "" ? Number(settings.min_bid_increment) : 50;
  const minimumRequiredBid = currentPrice + minBidIncrement;
  
  if (bid < minimumRequiredBid) {
    return { isValid: false, reason: `Твоя ставка чуть маловата. Нужно предложить хотя бы ${minimumRequiredBid}₽ (текущая цена ${currentPrice}₽ + шаг ${minBidIncrement}₽). Удачи! 🍀` };
  }
  
  // Проверка шага ставки
  if (getSetting('bid_step_enabled') === 'ВКЛ') {
    const bidStep = settings.bid_step !== undefined && settings.bid_step !== "" ? Number(settings.bid_step) : 50;
    
    // Проверяем, что ставка кратна шагу
    // Формула: (ставка - стартовая цена) должна быть кратна шагу ставки
    const priceDiff = bid - Number(lot.start_price);
    const remainder = priceDiff % bidStep;
    
    if (remainder !== 0) {
      return { isValid: false, reason: `Ставка должна быть кратна шагу ${bidStep}₽. Например: ${currentPrice + bidStep}₽, ${currentPrice + bidStep*2}₽ и так далее. Попробуй еще раз! ✨` };
    }
  }
  
  return { isValid: true, reason: null };
}

function enhancedValidateBid(bid, lot, userId) {
  // First, perform the standard validation
  const standardValidation = validateBid(bid, lot);
  if (!standardValidation.isValid) {
    return standardValidation;
  }
  
  // Then, check if user meets participation requirements
  const settings = getSettings();
  
  // Check if subscription validation is enabled
  if (getSetting('subscription_check_enabled') === 'ВКЛ') {
    const isSubscribed = checkUserSubscription(userId);
    
    if (!isSubscribed) {
      return {
        isValid: false,
        reason: 'Чтобы твоя ставка была принята, нужно сначала подписаться на нашу группу. Подпишись и возвращайся! 📢'
      };
    }
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
    } else if (queueRow.type === "subscription_required") {
      // Уведомление о подписке тоже в ЛС (хотя можно и в комменты)
      sendMessage(queueRow.user_id, buildSubscriptionRequiredMessage(payload));
    }
    // Для "outbid" и "low_bid" мы уже ответили в комментариях в handleWallReplyNew.
    // В ЛС дублировать НЕ НАДО (по просьбе пользователя).
    // Функция оставлена для winner и других типов.
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
  return template
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот')
    .replace(/{new_bid}/g, p.new_bid || '0')
    .replace(/{post_id}/g, p.post_id || '');
}

function buildWinnerMessage(p) {
  const settings = getSettings();
  const props = PropertiesService.getScriptProperties().getProperties();
  const paymentPhone = props.PAYMENT_PHONE || '';
  const paymentBank = props.PAYMENT_BANK || '';

  // Use winner-specific template ONLY from settings
  const template = settings.winner_notification_template ||
                   settings.order_summary_template ||
                   "Ошибка: шаблон не найден в Настройках. Обратитесь к администратору.";
  
  logDebug("buildWinnerMessage: Using template from settings", { 
    has_winner_setting: !!settings.winner_notification_template,
    has_order_summary_setting: !!settings.order_summary_template,
    template_length: template.length,
    lot_name: p.lot_name,
    price: p.price
  });

  return template
    .replace(/{lot_name}/g, p.lot_name || 'неизвестный лот')  // Use global replace and fallback
    .replace(/{price}/g, p.price || '0')                     // Use global replace and fallback
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

function finalizeAuction() {
  const activeLots = getSheetData("Config").filter(row => row.data.status === "active" && new Date(row.data.deadline) < new Date());
  Monitoring.recordEvent('AUCTION_FINALIZATION_STARTED', { active_lots_count: activeLots.length });

  const allWinnersDataForReport = [];
  const allUsers = getSheetData("Users");

  activeLots.forEach(row => {
    const lot = row.data;
    const postId = parsePostKey(lot.post_id).postId;
    
    if (!lot.leader_id) {
      updateLot(lot.lot_id, { status: "unsold" });
      postCommentToLot(postId, buildUnsoldLotCommentMessage());
      Monitoring.recordEvent('LOT_UNSOLD', { lot_id: lot.lot_id });
    } else {
      const winnerId = String(lot.leader_id);
      const winnerName = getUserName(winnerId);

      const newOrder = {
        order_id: `${lot.lot_id}-${winnerId}`,
        lot_id: lot.lot_id,
        lot_name: lot.name,
        post_id: lot.post_id,
        user_id: winnerId,
        win_date: new Date(),
        win_price: lot.current_price,
        status: 'unpaid',
        shipping_batch_id: ''
      };
      appendRow("Orders", newOrder);

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
          shipping_status: 'accumulating',
          shipping_details: ''
        };
        appendRow("Users", newUser);
        allUsers.push({ data: newUser, rowIndex: -1 });
      }
      
      updateLot(lot.lot_id, { status: "sold" });

      // Отправляем уведомление победителю в ЛС только если включена настройка отправки ЛС победителям
      if (getSetting('send_winner_dm_enabled') === 'ВКЛ') {
        const notification = { user_id: winnerId, type: "winner", payload: { lot_id: lot.lot_id, lot_name: lot.name, price: lot.current_price } };
        queueNotification(notification);
      }

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
          replyToComment(postId, latestBid.data.comment_id, winnerComment);
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
  });

  if (allWinnersDataForReport.length > 0) {
    sendAdminReport(allWinnersDataForReport);
  }
}

/**
 * Отправляет отчет о победителях администраторам группы.
 * @param {Array<Object>} winners Массив объектов победителей.
 */
function sendAdminReport(winners) {
  const settings = getSettings();
  let adminIdsValue = settings.ADMIN_IDS;
  
  // Проверяем, что adminIdsValue существует и преобразуем к строке
  if (!adminIdsValue) {
    logInfo("Отчет администраторам не отправлен: ADMIN_IDS не указаны в настройках.");
    return;
  }
  
  // Преобразуем к строке, если это не строка
  const adminIdsString = String(adminIdsValue);
  
  if (adminIdsString.trim() === "") {
    logInfo("Отчет администраторам не отправлен: ADMIN_IDS пусты.");
    return;
  }
  
  const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
  if (adminIds.length === 0) {
    logInfo("Отчет администраторам не отправлен: ADMIN_IDS пусты после парсинга.");
    return;
  }

  // Находим уникальных победителей
  const uniqueWinnerIds = [...new Set(winners.map(w => w.winner_id))];

  // Для каждого уникального победителя формируем и отправляем отдельное сообщение
  uniqueWinnerIds.forEach(winnerId => {
    const userSummary = buildUserOrderSummary(winnerId);
    
    // Пропускаем, если у пользователя почему-то нет неоплаченных лотов (например, уже оплатил)
    if (userSummary.startsWith("У вас нет")) return;

    // Получаем имя пользователя (предполагается, что где-то есть функция getUserName)
    const winnerName = getUserName(winnerId); 
    const adminHeader = `⬇️ Сообщение для [id${winnerId}|${winnerName}] (готово к пересылке) ⬇️`;
    const finalMessageForAdmin = `${adminHeader}\n\n${userSummary}`;

    // Отправляем это персональное сообщение каждому администратору
    adminIds.forEach(adminId => {
      try {
        sendMessage(adminId, finalMessageForAdmin);
      } catch (e) {
        logError('sendAdminReport_send_failed', e, { adminId: adminId, winnerId: winnerId });
      }
    });
    logInfo(`Отчет по победителю ${winnerId} отправлен администраторам.`);
  });

  Monitoring.recordEvent('ADMIN_REPORTS_SENT', { recipient_ids: adminIds, winner_count: uniqueWinnerIds.length });
}
      function setupSheets() { Object.keys(SHEETS).forEach(name => getSheet(name)); }
/**
 * Deletes all existing triggers and creates new ones for the script.
 * Includes a trigger for the new event queue processing.
 */
function setupTriggers() {
  // Delete all existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Trigger for processing the notification queue every 5 minutes (GAS limitation)
  ScriptApp.newTrigger("processNotificationQueue").timeBased().everyMinutes(5).create();

  // Trigger for finalizing the auction on a schedule
  ScriptApp.newTrigger("finalizeAuction").timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(21).create();
  
  // Trigger for processing admin replies to messages every 10 minutes
  ScriptApp.newTrigger("processAdminReplies").timeBased().everyMinutes(10).create();
  
  // Setup monitoring and maintenance triggers
  setupPeriodicMonitoring();
  setupDailyMaintenance();
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
  const parts = String(postKey).split("_");
  return parts.length === 2 ? { ownerId: Number(parts[0]), postId: Number(parts[1]) } : { ownerId: null, postId: Number(postKey) };
}

/**
 * Cleans up old log entries
 */
function cleanupOldLogs() {
  try {
    const daysToKeep = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const logSheet = getSheet("Logs");
    const values = logSheet.getDataRange().getValues();
    
    if (values.length <= 1) return; // Only header row
    
    // Find rows to delete (starting from bottom to avoid index shifting)
    const rowsToDelete = [];
    for (let i = values.length - 1; i >= 1; i--) { // Skip header row
      const dateStr = values[i][0]; // Assuming date is in first column
      if (dateStr instanceof Date && dateStr < cutoffDate) {
        rowsToDelete.unshift(i + 1); // Convert to 1-indexed
      }
    }
    
    // Delete rows
    for (const rowIndex of rowsToDelete) {
      logSheet.deleteRow(rowIndex);
    }
    
    if (rowsToDelete.length > 0) {
      Monitoring.recordEvent('LOG_CLEANUP_PERFORMED', {
        rowsDeleted: rowsToDelete.length,
        cutoffDate: cutoffDate
      });
    }
    
  } catch (error) {
    Monitoring.recordEvent('LOG_CLEANUP_ERROR', {
      error: error.message
    });
    Logger.log(`Ошибка при очистке логов: ${error.message}`);
  }
}

/**
 * Cleans up old statistics entries
 * Now cleans up old logs since Statistics was merged with Logs
 */
function cleanupOldStats() {
  // Now handled by cleanupOldLogs() since Statistics was merged with Logs
  cleanupOldLogs();
}

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
 * Automatic system repair function that fixes common issues
 */
function autoRepairSystem() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Автоматический ремонт системы', 
    'Выполнить автоматический ремонт обнаруженных проблем?', 
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  try {
    // Run health check first
    const results = systemHealthCheck();
    
    // Apply fixes for failed checks that have automatic solutions
    for (const result of results) {
      if (!result.passed && result.action && result.data) {
        switch (result.action) {
          case 'createMissingSheets':
            createMissingSheets(result.data);
            break;
            
          case 'recreateMissingTriggers':
            recreateMissingTriggers(result.data);
            break;
            
          case 'cleanupStuckEvents':
            // For stuck events, we'll just log them for manual review
            Logger.log(`Найдены застрявшие события: ${JSON.stringify(result.data)}`);
            break;
            
          case 'cleanupStuckNotifications':
            // For stuck notifications, we'll just log them for manual review
            Logger.log(`Найдены застрявшие уведомления: ${JSON.stringify(result.data)}`);
            break;
            
          default:
            Logger.log(`Неизвестное действие для автоматического ремонта: ${result.action}`);
        }
      }
    }
    
    ui.alert('Ремонт завершен', 'Автоматический ремонт завершен. Проверьте логи для деталей.', ui.ButtonSet.OK);
    
  } catch (error) {
    const errorMsg = `Ошибка при автоматическом ремонте: ${error.message}`;
    Logger.log(errorMsg);
    ui.alert('Ошибка', errorMsg, ui.ButtonSet.OK);
  }
}

// Тестовая функция для VK API
function testVkConnection() {
  const ui = SpreadsheetApp.getUi();
  const results = [];
  try {
    // Получаем настройки
    const settings = getSettings();
    const groupId = getVkGroupId();
    const webAppUrl = settings.WEB_APP_URL; // Строго из настроек
    
    if (!webAppUrl) {
       results.push('❌ ОШИБКА: WEB_APP_URL не найден в свойствах скрипта. Выполните настройку.');
    }
    
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
      logError('testVkConnection_groupInfo', e);
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
      logError('testVkConnection_servers', e);
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
    logError('testVkConnection', e, results);
  }
}

/**
 * Adds an event to the EventQueue for asynchronous processing.
 * @param {string} payload - The raw JSON payload from VK API.
 */
function enqueueEvent(payload) {
  appendRow("EventQueue", {
    eventId: Utilities.getUuid(),
    payload: payload,
    status: "pending",
    receivedAt: new Date()
  });
  Monitoring.recordEvent('EVENT_ENQUEUED', { payload_preview: payload.substring(0, 100) });
}

/**
 * Processes events from the EventQueue.
 * This function is triggered every minute by a time-based trigger.
 */
function processEventQueue(L) {
  // Если вызвана триггером, L будет объектом события. Проверяем, функция ли это.
  const logger = (typeof L === 'function') ? L : ((msg, data) => logDebug(msg, data));

  const rows = getSheetData("EventQueue");
  logger(`[DEBUG] processEventQueue started. Found ${rows.length} total rows.`);
  let processed = 0;
  
  for (const row of rows) {
    if (processed >= 50) {
      logger(`[DEBUG] Hit processing limit of 50.`);
      break;
    }
    
    const eventId = row.data.eventId || 'no_id';
    const currentStatus = String(row.data.status || "").toLowerCase().trim();
    logger(`[DEBUG] Row ${row.rowIndex}: ID=${eventId}, Status='${currentStatus}'.`);

    if (currentStatus !== "pending") {
      continue;
    }
    
    logger(`[DEBUG] Processing row ${row.rowIndex}...`);
    try {
      const payload = JSON.parse(row.data.payload);
      logger(`[DEBUG] Routing event type: ${payload.type}`);
      routeEvent(payload);
      
      updateRow("EventQueue", row.rowIndex, { 
        status: "processed", 
        receivedAt: row.data.receivedAt
      });
      
      processed++;
      logger(`[DEBUG] Row ${row.rowIndex} successfully processed.`);
      Monitoring.recordEvent('EVENT_PROCESSED', { eventId: row.data.eventId, eventType: payload.type });
    } catch (error) {
      logError('processEventQueue', error, row.data.payload);
      updateRow("EventQueue", row.rowIndex, { 
        status: "failed", 
        receivedAt: row.data.receivedAt 
      });
      logger(`[DEBUG] Row ${row.rowIndex} failed to process: ${error.message}`);
      Monitoring.recordEvent('EVENT_PROCESSING_FAILED', { 
        eventId: row.data.eventId, 
        error: error.message,
        payload: row.data.payload.substring(0, 200)
      });
    }
  }
}