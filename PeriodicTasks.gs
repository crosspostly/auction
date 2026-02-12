/**
 * @fileoverview Periodic monitoring functions that can be scheduled to run automatically
 */

/**
 * Function to be called periodically to monitor system health
 * This can be set up as a time-based trigger
 */
function periodicSystemCheck() {
  try {
    // Process error buffer (EventQueue)
    processEventQueue();

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
 * Function to run when the script starts up
 * This ensures monitoring is properly set up
 */
function onScriptStart() {
  try {
    // Set up periodic monitoring
    setupPeriodicMonitoring();
    
    // Log startup
    Monitoring.recordEvent('SCRIPT_STARTED', {
      timestamp: new Date(),
      version: '1.0.0'
    });
    
    Logger.log('Скрипт запущен, мониторинг настроен');
  } catch (error) {
    Logger.log(`Ошибка при запуске скрипта: ${error.message}`);
    Monitoring.recordEvent('SCRIPT_STARTUP_ERROR', {
      error: error.message
    });
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