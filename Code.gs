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
    // Детальный лог только в режиме отладки
    logDebug('📨 doPost called', {
      hasPostData: !!e.postData,
      contentLength: e.postData ? e.postData.length : 0,
      contents: e.postData ? e.postData.contents.substring(0, 500) : 'none' 
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
    .addSubMenu(ui.createMenu('🔬 ТЕСТЫ')
      .addItem('🧪 Запустить все тесты', 'runAllTests')
      .addItem('📋 Запустить интеграционные тесты', 'runIntegrationTests')
      .addItem('🔄 Тест полного цикла', 'testCompleteAuctionWorkflow')
      .addItem('🔑 Проверить права токенов (Full)', 'testFullPermissions'))
    .addSubMenu(ui.createMenu('🔧 СЕРВИС')
      .addItem('⚙️ Проверить и исправить настройки', 'checkAndFixSettings')
      .addItem('🔍 Проверить функцию валидации', 'testValidateBidFunction')
      .addItem('👤 Диагностика владельцев токенов', 'identifyTokenOwner'))
    .addSubMenu(ui.createMenu('📊 МОНИТОРИНГ')
      .addItem('🔍 Проверить здоровье системы', 'systemHealthCheck')
      .addItem('🔧 Авто-ремонт системы', 'autoRepairSystem')
      .addItem('📈 Непрерывный мониторинг', 'continuousMonitoring'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🤖 СИМУЛЯТОР')
      .addItem('▶️ Запустить один цикл симуляции (ТЕСТ)', 'runSingleSimulation')
      .addItem('⏰ Включить ежечасный запуск', 'setupHourlySimulation')      .addItem('🛑 Остановить ежечасный запуск', 'stopSimulation')
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
    const url = props.getProperty('WEB_APP_URL');

    if (!groupIdRaw) throw new Error("Введите ID или ссылку на группу (Шаг 1).");
    if (!userToken) throw new Error("Нужен Admin Token (Шаг 2).");
    if (!vkToken) throw new Error("Нужен Group Token (Шаг 3).");

    // Сбрасываем кэш, чтобы новые токены подхватились мгновенно
    props.setProperty('USER_TOKEN', userToken);
    props.setProperty('VK_TOKEN', vkToken);
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
function routeEvent(payload) {
  switch (payload.type) {
    case "wall_post_new": handleWallPostNew(payload); break;
    case "wall_reply_new": handleWallReplyNew(payload); break;
    case "wall_reply_edit": handleWallReplyEdit(payload); break;
    case "wall_reply_delete": handleWallReplyDelete(payload); break;
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
    const text = (comment.text || "").trim();
    const isStrictBid = /^\d+(?:\s*₽)?$/.test(text);
    
    if (!isStrictBid) {
      logDebug("🚫 Ignored self-reply (text)", { text: text });
      return; 
    }
    logDebug("✅ Accepted self-reply (strict bid)", { text: text });
  }
  // ----------------------------------------------------

  const lot = findLotByPostId(postKey);
  if (!lot) {
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
    logInfo("⚠️ Lot found but NOT ACTIVE", { status: lot.status, lot_id: lot.lot_id });
    return;
  }

  const bid = parseBid(comment.text || "");
  const userId = String(comment.from_id);
  
  if (!bid) {
    logDebug("⚠️ Comment text parsed as NO BID", { text: comment.text });
    return;
  }

  logDebug(`✅ Bid parsed: ${bid}`, { lot_id: lot.lot_id, current_price: lot.current_price });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey); // Re-fetch lot inside lock
    
    // Use enhanced validation
    const validationResult = enhancedValidateBid(bid, currentLot, userId);
    
    if (!validationResult.isValid) {
      logDebug(`🚫 Bid INVALID: ${validationResult.reason}`, { bid: bid, lot_id: currentLot.lot_id });
      
      // Записываем любую некорректную ставку в таблицу для истории
      appendRow("Bids", {
        bid_id: Utilities.getUuid(),
        lot_id: currentLot.lot_id,
        user_id: userId,
        bid_amount: bid,
        timestamp: new Date(),
        comment_id: comment.id,
        status: "ошибка"
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
      const notification = { user_id: oldLeaderBid.data.user_id, type: "outbid", payload: { lot_id: currentLot.lot_id, lot_name: currentLot.name, new_bid: bid, post_id: postKey } };
      queueNotification(notification);
      
      const outbidCommentMessage = `Ваша ставка перебита! Новая ставка: ${bid}₽`;
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
  if (getSetting('require_subscription') === 'ВКЛ') {
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
  let template = settings.outbid_notification_template || "🔔 Ваша ставка перебита!\nЛот: {lot_name}\nНовая ставка: {new_bid}₽\nhttps://vk.com/wall{post_id}";
  return template
    .replace('{lot_name}', p.lot_name)
    .replace('{new_bid}', p.new_bid)
    .replace('{post_id}', p.post_id);
}

function buildWinnerMessage(p) { 
  const settings = getSettings();
  const props = PropertiesService.getScriptProperties().getProperties();
  const paymentPhone = props.PAYMENT_PHONE || '';
  const paymentBank = props.PAYMENT_BANK || '';

  let template = settings.order_summary_template || "🎉 Вы выиграли лот {lot_name} за {price}₽!\nНапишите \"АУКЦИОН\".";
  return template
    .replace('{lot_name}', p.lot_name)
    .replace('{price}', p.price)
    .replace('{PAYMENT_BANK}', paymentBank)
    .replace('{PAYMENT_PHONE}', paymentPhone);
}

function buildLowBidMessage(p) { 
  const settings = getSettings();
  let template = settings.low_bid_notification_template || "👋 Привет! Твоя ставка {your_bid}₽ по лоту «{lot_name}» чуть ниже текущей цены {current_bid}₽. Попробуй предложить больше, чтобы побороться за лот! 😉\nhttps://vk.com/wall{post_id}";
  return template
    .replace('{your_bid}', p.your_bid)
    .replace('{lot_name}', p.lot_name)
    .replace('{current_bid}', p.current_bid)
    .replace('{post_id}', p.post_id);
}

function buildSubscriptionRequiredMessage(p) { 
  const settings = getSettings();
  let template = settings.subscription_required_template || "📢 Для участия в аукционе требуется подписка на нашу группу!\nПодпишитесь, чтобы иметь возможность делать ставки.\nЛот: «{lot_name}»\nhttps://vk.com/wall{post_id}";
  return template
    .replace('{lot_name}', p.lot_name)
    .replace('{post_id}', p.post_id);
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
        // Находим комментарий победителя с его последней ставкой
        const bidsForWinner = getSheetData("Bids").filter(b => b.data.lot_id === lot.lot_id && b.data.user_id === lot.leader_id);
        if (bidsForWinner.length > 0) {
          // Находим последнюю ставку победителя
          const latestBid = bidsForWinner.reduce((latest, current) => 
            new Date(current.data.timestamp) > new Date(latest.data.timestamp) ? current : latest
          );
          
          if (latestBid && latestBid.data.comment_id) {
            // Отвечаем на комментарий победителя
            const today = new Date();
            const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
            const winnerComment = `Поздравляем с победой в аукционе за миниатюру! Напишите в сообщения группы "Аукцион (${formattedDate})", чтобы забрать свой лот`;
            replyToComment(postId, latestBid.data.comment_id, winnerComment);
          } else {
            // Если не знаем ID комментария победителя, публикуем под постом
            const today = new Date();
            const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
            postCommentToLot(postId, `Поздравляем с победой в аукционе за миниатюру! [id${lot.leader_id}|${getUserName(lot.leader_id)}] Напишите в сообщения группы "Аукцион (${formattedDate})", чтобы забрать свой лот`);
          }
        } else {
          // Если нет информации о ставках победителя, публикуем под постом
          const today = new Date();
          const formattedDate = `${("0" + today.getDate()).slice(-2)}.${("0" + (today.getMonth() + 1)).slice(-2)}.${today.getFullYear()}`;
          postCommentToLot(postId, `Поздравляем с победой в аукционе за миниатюру! [id${lot.leader_id}|${getUserName(lot.leader_id)}] Напишите в сообщения группы "Аукцион (${formattedDate})", чтобы забрать свой лот`);
        }
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
  
  // Setup monitoring and maintenance triggers
  setupPeriodicMonitoring();
  setupDailyMaintenance();
}
function buildPostKey(ownerId, postId) { return `${ownerId}_${postId}`; }
function parsePostKey(postKey) {
  const parts = String(postKey).split("_");
  return parts.length === 2 ? { ownerId: Number(parts[0]), postId: Number(parts[1]) } : { ownerId: null, postId: Number(postKey) };
}

/**
 * Sets up periodic monitoring triggers
 */
function setupPeriodicMonitoring() {
  try {
    // Get all current triggers
    const triggers = ScriptApp.getProjectTriggers();
    
    // Remove existing monitoring triggers to avoid duplicates
    triggers.forEach(trigger => {
      const handler = trigger.getHandlerFunction();
      if (handler === 'periodicSystemCheck') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    // Create new trigger to run every 10 minutes
    ScriptApp.newTrigger('periodicSystemCheck')
      .timeBased()
      .everyMinutes(10)
      .create();
    
    Logger.log('Настроен периодический мониторинг (каждые 10 минут)');
    Monitoring.recordEvent('PERIODIC_MONITORING_SETUP', {
      frequency: 'every 10 minutes',
      timestamp: new Date()
    });
    
  } catch (error) {
    Logger.log(`Ошибка при настройке периодического мониторинга: ${error.message}`);
    Monitoring.recordEvent('PERIODIC_MONITORING_SETUP_ERROR', {
      error: error.message
    });
  }
}

/**
 * Sets up daily maintenance trigger
 */
function setupDailyMaintenance() {
  try {
    // Get all current triggers
    const triggers = ScriptApp.getProjectTriggers();
    
    // Remove existing maintenance triggers to avoid duplicates
    triggers.forEach(trigger => {
      const handler = trigger.getHandlerFunction();
      if (handler === 'dailyMaintenance') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    // Create new trigger to run daily at 2 AM
    ScriptApp.newTrigger('dailyMaintenance')
      .timeBased()
      .everyDays(1)
      .atHour(2)
      .create();
    
    Logger.log('Настроено ежедневное обслуживание (каждый день в 2:00)');
    Monitoring.recordEvent('DAILY_MAINTENANCE_SETUP', {
      frequency: 'daily at 2 AM',
      timestamp: new Date()
    });
    
  } catch (error) {
    Logger.log(`Ошибка при настройке ежедневного обслуживания: ${error.message}`);
    Monitoring.recordEvent('DAILY_MAINTENANCE_SETUP_ERROR', {
      error: error.message
    });
  }
}

/**
 * Function to be called periodically to monitor system health
 * This can be set up as a time-based trigger
 */
function periodicSystemCheck() {
  try {
    // Perform continuous monitoring
    const stats = continuousMonitoring();
    
    // Perform a light health check
    const healthResults = [];
    
    // Check if critical queues are too full
    const eventQueueSize = getSheetData("EventQueue").filter(e => e.data.status === "pending").length;
    const notificationQueueSize = getSheetData("NotificationQueue").filter(n => n.data.status === "pending").length;
    
    if (eventQueueSize > 50) {
      Monitoring.recordEvent('ALERT_HIGH_EVENT_QUEUE', { count: eventQueueSize });
    }
    
    if (notificationQueueSize > 100) {
      Monitoring.recordEvent('ALERT_HIGH_NOTIFICATION_QUEUE', { count: notificationQueueSize });
    }
    
    // Log successful periodic check
    Monitoring.recordEvent('PERIODIC_CHECK_COMPLETED', {
      timestamp: new Date(),
      eventQueuePending: eventQueueSize,
      notificationQueuePending: notificationQueueSize,
      stats: stats
    });
    
  } catch (error) {
    Monitoring.recordEvent('PERIODIC_CHECK_ERROR', {
      error: error.message,
      stack: error.stack
    });
    Logger.log(`Ошибка в периодической проверке: ${error.message}`);
  }
}

/**
 * Function to run maintenance tasks
 * This can be scheduled to run daily
 */
function dailyMaintenance() {
  try {
    // Clean up old logs (older than 30 days)
    cleanupOldLogs();
    
    // Clean up old statistics (older than 90 days)
    cleanupOldStats();
    
    // Check system health
    const results = systemHealthCheck();
    
    // Log maintenance completion
    Monitoring.recordEvent('DAILY_MAINTENANCE_COMPLETED', {
      timestamp: new Date(),
      checksPerformed: results.length,
      issuesFound: results.filter(r => !r.passed).length
    });
    
  } catch (error) {
    Monitoring.recordEvent('DAILY_MAINTENANCE_ERROR', {
      error: error.message,
      stack: error.stack
    });
    Logger.log(`Ошибка в ежедневном обслуживании: ${error.message}`);
  }
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
 */
function cleanupOldStats() {
  try {
    const daysToKeep = 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const statsSheet = getSheet("Statistics");
    const values = statsSheet.getDataRange().getValues();
    
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
      statsSheet.deleteRow(rowIndex);
    }
    
    if (rowsToDelete.length > 0) {
      Monitoring.recordEvent('STATS_CLEANUP_PERFORMED', {
        rowsDeleted: rowsToDelete.length,
        cutoffDate: cutoffDate
      });
    }
    
  } catch (error) {
    Monitoring.recordEvent('STATS_CLEANUP_ERROR', {
      error: error.message
    });
    Logger.log(`Ошибка при очистке статистики: ${error.message}`);
  }
}

// Вспомогательная функция для тестового фреймворка
function getSetting(key) {
  const settings = getSettings();
  if (key === 'DEBUG_VK_API') {
    const debugProp = PropertiesService.getScriptProperties().getProperty('DEBUG_VK_API');
    return debugProp === 'TRUE' || debugProp === true;
  }
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
      winnersCount: getSheetData("Winners").length,
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
    const requiredSheets = ['Config', 'Bids', 'Winners', 'Settings', 'Statistics', 'EventQueue', 'NotificationQueue', 'Logs'];
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
      { func: 'processEventQueue', type: 'time' },
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
  try {
    const rows = getSheetData("EventQueue");
    const now = new Date();
    const stuckEvents = [];
    
    for (const row of rows) {
      if (row.data.status === "pending") {
        // Check if the event has been pending for more than 10 minutes
        const receivedTime = new Date(row.data.receivedAt);
        const timeDiff = (now - receivedTime) / (1000 * 60); // Difference in minutes
        
        if (timeDiff > 10) {
          stuckEvents.push({
            eventId: row.data.eventId,
            receivedAt: row.data.receivedAt,
            timePending: timeDiff
          });
        }
      }
    }
    
    if (stuckEvents.length > 0) {
      return { 
        testName: 'Проверка застрявших событий', 
        passed: false, 
        error: `Найдено ${stuckEvents.length} застрявших событий`,
        action: 'cleanupStuckEvents',
        data: stuckEvents
      };
    }
    
    return { testName: 'Проверка застрявших событий', passed: true };
  } catch (error) {
    return { testName: 'Проверка застрявших событий', passed: false, error: error.message };
  }
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
function processEventQueue() {
  const rows = getSheetData("EventQueue");
  let processed = 0;
  
  for (const row of rows) {
    if (processed >= 50) break; // Увеличили до 50 за один проход
    
    // Делаем проверку регистра-независимой и убираем пробелы
    const currentStatus = String(row.data.status || "").toLowerCase().trim();
    if (currentStatus !== "pending") continue;
    
    try {
      const payload = JSON.parse(row.data.payload);
      routeEvent(payload);
      
      // Update status to processed
      updateRow("EventQueue", row.rowIndex, { 
        status: "processed", 
        receivedAt: row.data.receivedAt // Keep original timestamp
      });
      
      processed++;
      Monitoring.recordEvent('EVENT_PROCESSED', { eventId: row.data.eventId, eventType: payload.type });
    } catch (error) {
      logError('processEventQueue', error, row.data.payload);
      // Update status to failed
      updateRow("EventQueue", row.rowIndex, { 
        status: "failed", 
        receivedAt: row.data.receivedAt 
      });
      Monitoring.recordEvent('EVENT_PROCESSING_FAILED', { 
        eventId: row.data.eventId, 
        error: error.message,
        payload: row.data.payload.substring(0, 200)
      });
    }
  }
}