/**
 * @fileoverview Periodic monitoring functions with self-lifecycle management
 */

/**
 * ЗАПУСКАТЕЛЬ: Срабатывает в 21:00. Создает частый мониторинг, если есть активные лоты.
 */
function startAuctionMonitoring() {
  const now = new Date();
  // Проверка субботы строго по Москве (GMT+3)
  const dayOfWeekMoscow = Utilities.formatDate(now, "GMT+3", "u"); // 1=Mon, 6=Sat, 7=Sun
  const isSaturday = (dayOfWeekMoscow === "6");
  
  const saturdayOnly = (getSetting('saturday_only_enabled') === 'ВКЛ');

  if (saturdayOnly && !isSaturday) {
    logInfo("📅 Режим 'Только суббота' активен. Сегодня не суббота по МСК, мониторинг не будет запущен.");
    return;
  }

  const allLots = getSheetData("Config");
  const hasActive = allLots.some(l => l.data.status === "active" || l.data.status === "Активен");

  if (hasActive) {
    activateFrequentMonitoring();
    logInfo("🚀 Субботний финал начался! Мониторинг дедлайнов активирован.");
  } else {
    logDebug("Активных лотов для финализации не найдено.");
  }
}

/**
 * Активирует частую проверку (раз в минуту) для завершения аукционов.
 * Безопасно для повторного вызова (не плодит дубликаты триггеров).
 */
function activateFrequentMonitoring() {
  const functionName = "periodicSystemCheck";
  const triggers = ScriptApp.getProjectTriggers();
  const existing = triggers.find(t => t.getHandlerFunction() === functionName);
  
  if (!existing) {
    ScriptApp.newTrigger(functionName)
      .timeBased()
      .everyMinutes(1)
      .create();
    logInfo("⏱️ Активирован минутный мониторинг финализации.");
  }
}

/**
 * РАБОЧИЙ ЦИКЛ: Проверяет дедлайны и очередь.
 */
function periodicSystemCheck() {
  try {
    const now = new Date();
    const nowMSK = Utilities.formatDate(now, "GMT+3", "dd.MM.yyyy HH:mm:ss");
    logInfo(`⏱️ periodicSystemCheck: Запуск проверки. Время (MSK): ${nowMSK}`);
    
    // 1. Сначала полностью разгребаем очередь событий, чтобы не закрыть лот
    // до того, как последняя ставка запишется в таблицу.
    let hasPending = true;
    let safeguard = 0;
    while (hasPending && safeguard < 5) { // Обрабатываем пачками до 50 событий за раз
      processEventQueue();
      const pendingCount = getSheetData("EventQueue").filter(e => e.data.status === "pending").length;
      hasPending = pendingCount > 0;
      safeguard++;
      if (hasPending) Utilities.sleep(500);
    }

    // 2. Теперь ищем лоты, время которых реально вышло
    const configData = getSheetData("Config");
    logInfo(`📊 periodicSystemCheck: Всего лотов: ${configData.length}`);
    
    const expiredLots = configData.filter(row => {
      const deadline = parseRussianDate(row.data.deadline);
      const isActive = (row.data.status === "active" || row.data.status === "Активен");
      const isExpired = deadline && deadline <= now;
      
      // Логируем каждый активный лот
      if (isActive) {
        const deadlineStr = deadline ? Utilities.formatDate(deadline, "GMT+3", "dd.MM.yyyy HH:mm:ss") : "NULL";
        const rawDeadline = row.data.deadline;
        const deadlineType = typeof rawDeadline;
        logInfo(`   🔍 Лот ${row.data.lot_id}: статус=${row.data.status}, дедлайн=${deadlineStr}, истёк=${isExpired}`);
        logInfo(`      🔎 Сырое значение: "${rawDeadline}" (Type: ${deadlineType})`);
        if (deadline) {
          logInfo(`      🔎 Сравнение: deadline.getTime()=${deadline.getTime()}, now.getTime()=${now.getTime()}, результат=${deadline <= now}`);
        }
      }
      
      return isActive && deadline && deadline <= now;
    });

    logInfo(`✅ periodicSystemCheck: Найдено просроченных лотов: ${expiredLots.length}`);
    
    if (expiredLots.length > 0) {
      logInfo(`Найдено ${expiredLots.length} лотов с истекшим сроком. Финализируем...`);
      finalizeAuction();
    }
    
    // 3. ПРОВЕРКА ОСТАНОВКИ: если активных лотов больше нет - рассылаем итоги и удаляем триггер
    const activeLots = getSheetData("Config").filter(row => row.data.status === "active" || row.data.status === "Активен");
    if (activeLots.length === 0) {
      logInfo("🏁 Все лоты обработаны. Рассылаю сводки.");
      sendAllSummaries(); 
      
      // Удаляем триггер частой проверки, чтобы не тратить лимиты
      deleteTriggerByName("periodicSystemCheck");
      
      // На всякий случай запускаем очередь уведомлений
      processNotificationQueue();
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
