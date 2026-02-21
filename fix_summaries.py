import re

with open("Code.gs", "r", encoding="utf-8") as f:
    content = f.read()

# Удаляем старые версии этих функций, если они вдруг затесались в середине
def remove_func(data, name):
    pattern = rf"function\s+{name}\s*\([^)]*\)\s*\{{"
    match = re.search(pattern, data)
    if not match: return data
    start = match.start()
    count = 0
    for i in range(start, len(data)):
        if data[i] == "{": count += 1
        elif data[i] == "}":
            count -= 1
            if count == 0:
                return data[:start] + data[i+1:]
    return data

content = remove_func(content, "sendAllSummaries")
content = remove_func(content, "sendAdminReport")

new_functions = """
/**
 * Отправляет сводки всем победителям (если включено) и отчет администраторам.
 * Вызывается, когда все лоты дня получили статус sold/unsold.
 */
function sendAllSummaries() {
  const settings = getSettings();
  const sendToWinners = (getSetting('send_winner_dm_enabled') === 'ВКЛ'); 
  
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const dateKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const propKey = "SUMMARY_SENT_" + dateKey;
  
  if (props.getProperty(propKey) === "true") return;

  const allLots = getSheetData("Config");
  const activeCount = allLots.filter(l => l.data.status === "active" || l.data.status === "Активен").length;
  
  if (activeCount > 0) {
    logDebug("Рассылка отложена: еще есть активные лоты (" + activeCount + ").");
    return;
  }

  const soldToday = allLots.filter(l => l.data.status === "Продан" || l.data.status === "sold");
  if (soldToday.length === 0) return;

  const winnersMap = {};
  soldToday.forEach(lot => {
    const userId = String(lot.data.leader_id);
    if (userId && userId !== "") {
      if (!winnersMap[userId]) winnersMap[userId] = [];
      winnersMap[userId].push(lot.data);
    }
  });

  const winnersListForReport = [];

  for (const userId in winnersMap) {
    if (sendToWinners) {
      const summary = buildUserOrderSummary(userId);
      if (!summary.startsWith("У вас нет")) {
        sendMessage(userId, summary);
        logInfo("✉️ Сводка отправлена победителю " + userId);
      }
    }
    
    winnersMap[userId].forEach(lot => {
      winnersListForReport.push({
        lot_id: lot.lot_id,
        name: lot.name,
        price: lot.current_price,
        winner_id: userId,
        winner_name: getUserName(userId),
        attachment_id: lot.attachment_id
      });
    });
    Utilities.sleep(500);
  }

  if (winnersListForReport.length > 0) {
    sendAdminReport(winnersListForReport);
  }

  props.setProperty(propKey, "true");
  logInfo("✅ Финальная рассылка аукциона завершена.");
}

/**
 * Отправляет консолидированный отчет администраторам.
 */
function sendAdminReport(winners) {
  const settings = getSettings();
  const parsedAdmins = parseAdminIds(settings.ADMIN_IDS);
  const adminIds = parsedAdmins.all;

  if (!adminIds || adminIds.length === 0) {
    logInfo("Отчет админам не отправлен: ADMIN_IDS пуст.");
    return;
  }

  let reportText = "🏆 ИТОГИ АУКЦИОНА 🏆

";
  winners.forEach((w, i) => {
    reportText += (i+1) + ". Лот №" + w.lot_id + ": " + w.name + "
";
    reportText += "💰 Цена: " + w.price + "₽
";
    reportText += "👤 Победитель: [id" + w.winner_id + "|" + w.winner_name + "]
";
    reportText += "-------------------
";
  });

  adminIds.forEach(adminId => {
    try {
      sendMessage(adminId, reportText);
    } catch (e) {
      logError("sendAdminReport_failed", e, { adminId: adminId });
    }
  });
}
"""

with open("Code.gs", "w", encoding="utf-8") as f:
    f.write(content.strip() + "
" + new_functions)
print("Merge complete.")
