function doGet(e) {
  return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
    const data = JSON.parse(e.postData.contents);
    
    if (data.type === 'confirmation') {
      const groupId = String(data.group_id);
      const cache = CacheService.getScriptCache();
      const code = cache.get("CONFIRM_" + groupId) || PropertiesService.getScriptProperties().getProperty("CONFIRMATION_CODE");
      return ContentService.createTextOutput(String(code || "").trim()).setMimeType(ContentService.MimeType.TEXT);
    }
    
    const response = ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
    logIncoming(e.postData.contents);
    routeEvent(data);
    
    return response;
  } catch (error) {
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  }
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('VK Auction')
    .addItem('🚀 Мастер настройки', 'runSetupWizard')
    .addItem('🔐 Настройки авторизации', 'showAuthSettings')
    .addItem('🔍 Проверить соединение', 'diagnosticTest')
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
  const defaultUrl = "https://script.google.com/macros/s/AKfycbwm3U_WM7LbZmODcXFiJPLdBz117fvGKZskaea0j9K5s_2tKptMncPhSAOnmlMoR3DG/exec";
  return { group_id: props.GROUP_ID || '', web_app_url: props.WEB_APP_URL || defaultUrl, payment_phone: props.PAYMENT_PHONE || '', payment_bank: props.PAYMENT_BANK || '' };
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
  if (!lot) { logInfo("Пост не распаршен", text.substring(0, 50)); return; }
  upsertLot({ lot_id: String(lot.lot_id), post_id: `${payload.object.owner_id}_${payload.object.id}`, name: lot.name, start_price: lot.start_price, current_price: lot.start_price, leader_id: "", status: "active", created_at: new Date(), deadline: lot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000) });
  logInfo(`Лот №${lot.lot_id} добавлен`);
}

function parseLotFromPost(text) {
  const lotNumberMatch = text.match(/№\s*(\d+)/i);
  if (!lotNumberMatch) return null;
  const lotId = lotNumberMatch[1];
  const startPriceMatch = text.match(/(?:старт|цена)\s*[:\-\s]?\s*(\d+)/i);
  const startPrice = startPriceMatch ? Number(startPriceMatch[1]) : 0;
  let name = "Лот №" + lotId;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length > 1) {
    const potentialName = lines.find(line => !line.includes('#') && !line.match(/№\d+/) && !line.match(/(?:старт|цена|шаг|дедлайн)/i));
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
  if (!bid) return;
  const userId = String(comment.from_id);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const currentLot = findLotByPostId(postKey);
    if (!currentLot || currentLot.status !== "active" || !validateBid(bid, currentLot)) return;
    if (!checkCanWrite(userId)) replyToComment(comment.post_id, comment.id, `⚠️ [id${userId}|${getUserName(userId)}], откройте личку!`);
    recordBid({ bid_id: generateId(), lot_id: String(currentLot.lot_id), user_id: userId, bid_amount: bid, timestamp: comment.date ? new Date(comment.date * 1000) : new Date(), comment_id: String(comment.id) });
    updateLot(currentLot.lot_id, { current_price: bid, leader_id: userId });
    logInfo(`Ставка ${bid} лот ${currentLot.lot_id}`);
    if (currentLot.leader_id && String(currentLot.leader_id) !== userId) queueNotification({ user_id: currentLot.leader_id, type: "outbid", payload: { lot_id: currentLot.lot_id, lot_name: currentLot.name, previous_bid: currentLot.current_price, new_bid: bid, new_leader_id: userId, post_id: postKey } });
  } finally { lock.releaseLock(); }
}

function parseBid(text) {
  const match = String(text).match(/(\d+)\s*₽?/);
  return match ? Number(match[1]) : null;
}

function validateBid(bid, lot) {
  if (lot.deadline && new Date() > new Date(lot.deadline)) return false;
  const settings = getSettings();
  const currentPrice = Number(lot.current_price || lot.start_price || 0);
  if (bid <= currentPrice) return false;
  if (settings.bid_step_enabled && (bid - Number(lot.start_price)) % Number(settings.bid_step || 50) !== 0) return false;
  if (bid < currentPrice + Number(settings.min_bid_increment || 0)) return false;
  return true;
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
  activeLots.forEach(row => {
    const lot = row.data;
    const postId = parsePostKey(lot.post_id).postId;
    if (!lot.leader_id) { updateLotStatus(lot.lot_id, "unsold"); postCommentToLot(postId, "❌ Лот не продан"); }
    else {
      recordWinner({ lot_id: lot.lot_id, name: lot.name, price: lot.current_price, winner_id: lot.leader_id, winner_name: getUserName(lot.leader_id), won_at: new Date(), status: "pending_contact", delivery: "", paid: "", shipped: "" });
      queueNotification({ user_id: lot.leader_id, type: "winner", payload: { lot_id: lot.lot_id, lot_name: lot.name, price: lot.current_price } });
      postCommentToLot(postId, `✅ Победитель: ${getUserName(lot.leader_id)}`);
      updateLotStatus(lot.lot_id, "sold");
    }
  });
}

function setupSheets() { Object.keys(SHEETS).forEach(name => getSheet(name)); }
function setupTriggers() { ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); ScriptApp.newTrigger("processNotificationQueue").timeBased().everyMinutes(1).create(); ScriptApp.newTrigger("finalizeAuction").timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(21).create(); }
function buildPostKey(ownerId, postId) { return `${ownerId}_${postId}`; }
function parsePostKey(postKey) {
  const parts = String(postKey).split("_");
  return parts.length === 2 ? { ownerId: Number(parts[0]), postId: Number(parts[1]) } : { ownerId: null, postId: Number(postKey) };
}