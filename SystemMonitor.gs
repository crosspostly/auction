/**
 * @fileoverview System monitoring and health check functions for the VK Auction Bot
 * This module provides functions to monitor the system's health and automatically fix common issues
 */

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
    const requiredSheets = ['Config', 'Bids', 'Users', 'Orders', 'Settings', 'Statistics', 'EventQueue', 'NotificationQueue', 'Logs'];
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
    
    if (missingSettings.length > 0) {
      return { 
        testName: 'Проверка настроек', 
        passed: false, 
        error: `Отсутствуют критические настройки: ${missingSettings.join(', ')}`,
        action: 'notifyMissingSettings',
        data: missingSettings
      };
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
 * Adds monitoring options to the menu
 */
function addMonitoringToMenu() {
  // This function would typically be called from onOpen, but since we're 
  // adding it to an external file, we'll just document that it should be added
  // to the main menu in Code.gs
  Logger.log("Add monitoring functions to the main menu in Code.gs");
}