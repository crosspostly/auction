/**
 * @fileoverview Periodic monitoring functions with self-lifecycle management
 */

/**
 * ЗАПУСКАТЕЛЬ: Срабатывает в 21:00. Создает частый мониторинг, если есть активные лоты.
 */
function startAuctionMonitoring() {
  const now = new Date();
  const isSaturday = (now.getDay() === 6);
  const saturdayOnly = (getSetting('saturday_only_enabled') === 'ВКЛ');

  if (saturdayOnly && !isSaturday) {
    logInfo("📅 Режим 'Только суббота' активен. Сегодня не суббота, мониторинг не будет запущен.");
    return;
  }

  const allLots = getSheetData("Config");
  const hasActive = allLots.some(l => l.data.status === "active" || l.data.status === "Активен");

  if (hasActive) {
    deleteTriggerByName("periodicSystemCheck");
    ScriptApp.newTrigger("periodicSystemCheck").timeBased().everyMinutes(10).create();
    logInfo("🚀 Субботний финал начался! Мониторинг дедлайнов активирован.");
  } else {
    logDebug("Активных лотов для финализации не найдено.");
  }
}

/**
 * РАБОЧИЙ ЦИКЛ: Проверяет дедлайны и очередь.
 */
function periodicSystemCheck() {
  try {
    processEventQueue();

    const now = new Date();
    const expiredLots = getSheetData("Config").filter(row => 
      (row.data.status === "active" || row.data.status === "Активен") && 
      parseRussianDate(row.data.deadline) <= now
    );
    
    if (expiredLots.length > 0) {
      logInfo(`Найдено ${expiredLots.length} лотов с истекшим сроком. Финализируем...`);
      finalizeAuction();
    } else {
      // Даже если просроченных нет, вызываем для проверки, не пора ли удалять триггер
      sendAllSummaries();
    }

  } catch (error) {
    logError("periodicSystemCheck_error", error);
  }
}

/**
 * ВСПОМОГАТЕЛЬНАЯ: Удаление триггера по имени
 */
function deleteTriggerByName(name) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === name) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function dailyMaintenance() {
  try {
    cleanupOldLogs();
    systemHealthCheck();
    Monitoring.recordEvent('DAILY_MAINTENANCE_COMPLETED', { timestamp: new Date() });
  } catch (error) {
    logError("daily_maintenance_error", error);
  }
}

function cleanupOldLogs() {
  try {
    const daysToKeep = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const logSheet = getSheet("Logs");
    const values = logSheet.getDataRange().getValues();
    if (values.length <= 1) return;
    const rowsToDelete = [];
    for (let i = values.length - 1; i >= 1; i--) {
      let entryDate = parseRussianDate(values[i][0]) || new Date(values[i][0]);
      if (entryDate instanceof Date && entryDate < cutoffDate) {
        rowsToDelete.push(i + 1);
      }
    }
    rowsToDelete.forEach(idx => logSheet.deleteRow(idx));
  } catch (e) {}
}
