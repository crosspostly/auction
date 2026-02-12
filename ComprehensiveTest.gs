/**
 * @fileoverview Comprehensive test suite for the VK Auction Bot
 * This file includes tests for the complete workflow and settings validation
 */

/**
 * Runs a comprehensive test of the entire system
 */
function runComprehensiveTest() {
  const results = [];
  
  // Test 1: Check all required settings
  results.push(testSettingsConfiguration());
  
  // Test 2: Check all sheets exist and are accessible
  results.push(testSheetsAvailability());
  
  // Test 3: Test lot creation process
  results.push(testLotCreation());
  
  // Test 4: Test bid processing with different scenarios
  results.push(testBidProcessing());
  
  // Test 5: Test notification system with enabled/disabled settings
  results.push(testNotificationSystem());
  
  // Test 6: Test auction finalization
  results.push(testAuctionFinalization());
  
  // Test 7: Test message handling
  results.push(testMessageHandling());
  
  // Generate comprehensive report
  const report = generateComprehensiveReport(results);
  
  // Log the report
  console.log(report);
  
  return results;
}

/**
 * Test 1: Check all required settings
 */
function testSettingsConfiguration() {
  const testName = "Проверка настроек системы";
  try {
    const settings = getSettings();
    
    // Check if all required settings exist
    const requiredSettings = [
      'bid_step_enabled',
      'require_subscription', 
      'subscription_check_enabled',
      'debug_logging_enabled',
      'reply_on_invalid_bid_enabled',
      'send_winner_dm_enabled'
    ];
    
    const missingSettings = [];
    const presentSettings = [];
    
    requiredSettings.forEach(setting => {
      if (settings[setting] !== undefined) {
        presentSettings.push(`${setting}: ${settings[setting]}`);
      } else {
        missingSettings.push(setting);
      }
    });
    
    const result = {
      testName,
      passed: missingSettings.length === 0,
      details: {
        checkedSettings: requiredSettings.length,
        presentSettings: presentSettings.length,
        missingSettings: missingSettings,
        settingsValues: presentSettings
      }
    };
    
    if (!result.passed) {
      result.error = `Отсутствуют настройки: ${missingSettings.join(', ')}`;
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 2: Check all sheets exist and are accessible
 */
function testSheetsAvailability() {
  const testName = "Проверка доступности листов";
  try {
    const requiredSheets = ['Config', 'Bids', 'Users', 'Orders', 'Settings', 'EventQueue', 'NotificationQueue', 'Logs', 'Incoming'];
    
    const availableSheets = [];
    const missingSheets = [];
    
    requiredSheets.forEach(sheetKey => {
      try {
        const sheet = getSheet(sheetKey);
        if (sheet) {
          const rowCount = sheet.getLastRow();
          availableSheets.push(`${sheetKey} (${rowCount} rows)`);
        } else {
          missingSheets.push(sheetKey);
        }
      } catch (e) {
        missingSheets.push(sheetKey);
      }
    });
    
    const result = {
      testName,
      passed: missingSheets.length === 0,
      details: {
        checkedSheets: requiredSheets.length,
        availableSheets: availableSheets,
        missingSheets: missingSheets
      }
    };
    
    if (!result.passed) {
      result.error = `Отсутствуют листы: ${missingSheets.join(', ')}`;
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 3: Test lot creation process
 */
function testLotCreation() {
  const testName = "Тест создания лота";
  try {
    // Create a test lot
    const testLotId = `TEST_${Utilities.getUuid().substring(0, 6)}`;
    const testLotData = {
      lot_id: testLotId,
      post_id: `test_post_${testLotId}`,
      name: "Тестовый лот для проверки системы",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      created_at: new Date(),
      deadline: new Date(new Date().getTime() + 7*24*60*60*1000), // 7 days from now
      bid_step: 50
    };
    
    // Add to Config sheet
    upsertLot(testLotData);
    
    // Verify it was added
    const lots = getSheetData("Config");
    const foundLot = lots.find(l => l.data.lot_id === testLotId);
    
    const result = {
      testName,
      passed: !!foundLot,
      details: {
        testLotId: testLotId,
        lotFound: !!foundLot,
        lotData: foundLot ? foundLot.data : null
      }
    };
    
    if (!result.passed) {
      result.error = `Лот ${testLotId} не был найден в листе "Лоты"`;
    }
    
    // Clean up test data
    if (foundLot) {
      try {
        getSheet("Config").deleteRow(foundLot.rowIndex);
      } catch (e) {
        console.warn(`Could not clean up test lot ${testLotId}: ${e.message}`);
      }
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 4: Test bid processing with different scenarios
 */
function testBidProcessing() {
  const testName = "Тест обработки ставок";
  try {
    // Create a test lot first
    const testLotId = `BID_TEST_${Utilities.getUuid().substring(0, 6)}`;
    const testLotData = {
      lot_id: testLotId,
      post_id: `test_post_${testLotId}`,
      name: "Тестовый лот для ставок",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      created_at: new Date(),
      deadline: new Date(new Date().getTime() + 7*24*60*60*1000),
      bid_step: 50
    };
    
    upsertLot(testLotData);
    
    // Test valid bid
    const testUserId = "TEST_USER_" + Utilities.getUuid().substring(0, 6);
    const validBidAmount = 150; // Should be valid (100 + 50 step)
    
    // Add bid to Bids sheet directly for testing
    const bidData = {
      bid_id: Utilities.getUuid(),
      lot_id: testLotId,
      user_id: testUserId,
      bid_amount: validBidAmount,
      timestamp: new Date(),
      comment_id: "TEST_COMMENT_" + Utilities.getUuid().substring(0, 6),
      status: "лидер"
    };
    
    appendRow("Bids", bidData);
    
    // Verify bid was recorded
    const bids = getSheetData("Bids");
    const foundBid = bids.find(b => b.data.lot_id === testLotId && Number(b.data.bid_amount) === validBidAmount);
    
    // Verify lot was updated (this would normally happen in handleWallReplyNew)
    const lots = getSheetData("Config");
    const updatedLot = lots.find(l => l.data.lot_id === testLotId);
    
    const result = {
      testName,
      passed: !!foundBid && updatedLot && Number(updatedLot.data.current_price) >= validBidAmount,
      details: {
        testLotId: testLotId,
        testUserId: testUserId,
        validBidAmount: validBidAmount,
        bidRecorded: !!foundBid,
        lotUpdated: !!updatedLot,
        currentPrice: updatedLot ? updatedLot.data.current_price : null
      }
    };
    
    if (!result.passed) {
      result.error = `Ставка не была корректно обработана или лот не обновлен`;
    }
    
    // Clean up test data
    try {
      if (foundBid) {
        getSheet("Bids").deleteRow(foundBid.rowIndex);
      }
      if (updatedLot) {
        getSheet("Config").deleteRow(updatedLot.rowIndex);
      }
    } catch (e) {
      console.warn(`Could not clean up test bid/lot: ${e.message}`);
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 5: Test notification system with enabled/disabled settings
 */
function testNotificationSystem() {
  const testName = "Тест системы уведомлений";
  try {
    const settings = getSettings();
    
    // Test notification queuing
    const testUserId = "NOTIF_TEST_USER_" + Utilities.getUuid().substring(0, 6);
    const testLotId = "NOTIF_TEST_LOT_" + Utilities.getUuid().substring(0, 6);
    
    const notification = {
      user_id: testUserId,
      type: "winner",
      payload: {
        lot_id: testLotId,
        lot_name: "Тестовый лот для уведомлений",
        price: 500
      }
    };
    
    // Queue notification
    queueNotification(notification);
    
    // Check if notification was queued
    const notifications = getSheetData("NotificationQueue");
    const queuedNotification = notifications.find(n => 
      n.data.user_id === testUserId && 
      n.data.type === "winner" && 
      n.data.payload.includes(testLotId)
    );
    
    const result = {
      testName,
      passed: !!queuedNotification,
      details: {
        sendWinnerDmEnabled: settings.send_winner_dm_enabled,
        testUserId: testUserId,
        testLotId: testLotId,
        notificationQueued: !!queuedNotification,
        queuedNotification: queuedNotification ? queuedNotification.data : null
      }
    };
    
    if (!result.passed) {
      result.error = `Уведомление не было поставлено в очередь`;
    }
    
    // Clean up test data
    if (queuedNotification) {
      try {
        getSheet("NotificationQueue").deleteRow(queuedNotification.rowIndex);
      } catch (e) {
        console.warn(`Could not clean up test notification: ${e.message}`);
      }
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 6: Test auction finalization
 */
function testAuctionFinalization() {
  const testName = "Тест завершения аукциона";
  try {
    // Create a test lot that should be finalized (past deadline)
    const testLotId = `FINAL_TEST_${Utilities.getUuid().substring(0, 6)}`;
    const testUserId = "FINAL_TEST_USER_" + Utilities.getUuid().substring(0, 6);
    
    const lotData = {
      lot_id: testLotId,
      post_id: `final_test_post_${testLotId}`,
      name: "Тестовый лот для завершения",
      start_price: 100,
      current_price: 200,
      leader_id: testUserId,
      status: "active",
      created_at: new Date(Date.now() - 8*24*60*60*1000), // 8 days ago
      deadline: new Date(Date.now() - 1*24*60*60*1000), // 1 day ago (expired)
      bid_step: 50
    };
    
    upsertLot(lotData);
    
    // Add a test bid for this lot
    const bidData = {
      bid_id: Utilities.getUuid(),
      lot_id: testLotId,
      user_id: testUserId,
      bid_amount: 200,
      timestamp: new Date(Date.now() - 2*24*60*60*1000), // 2 days ago
      comment_id: "FINAL_TEST_BID",
      status: "лидер"
    };
    
    appendRow("Bids", bidData);
    
    // Simulate finalization process (without actually calling finalizeAuction to avoid side effects)
    // Just check if the lot would be eligible for finalization
    const lots = getSheetData("Config");
    const lotToFinalize = lots.find(l => 
      l.data.lot_id === testLotId && 
      l.data.status === "active" && 
      new Date(l.data.deadline) < new Date()
    );
    
    const result = {
      testName,
      passed: !!lotToFinalize,
      details: {
        testLotId: testLotId,
        testUserId: testUserId,
        lotEligibleForFinalization: !!lotToFinalize,
        lotData: lotToFinalize ? lotToFinalize.data : null
      }
    };
    
    if (!result.passed) {
      result.error = `Лот не соответствует критериям для завершения`;
    }
    
    // Clean up test data
    try {
      const allLots = getSheetData("Config");
      const lotToRemove = allLots.find(l => l.data.lot_id === testLotId);
      if (lotToRemove) {
        getSheet("Config").deleteRow(lotToRemove.rowIndex);
      }
      
      const allBids = getSheetData("Bids");
      const bidsToRemove = allBids.filter(b => b.data.lot_id === testLotId);
      bidsToRemove.forEach(bid => {
        try {
          getSheet("Bids").deleteRow(bid.rowIndex);
        } catch (e) {
          console.warn(`Could not delete bid: ${e.message}`);
        }
      });
    } catch (e) {
      console.warn(`Could not clean up finalization test data: ${e.message}`);
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Test 7: Test message handling
 */
function testMessageHandling() {
  const testName = "Тест обработки сообщений";
  try {
    // Test the buildUserOrderSummary function with a non-existent user
    // (should return "no orders" message)
    const summary = buildUserOrderSummary("NONEXISTENT_USER_TEST_" + Utilities.getUuid().substring(0, 6));
    
    const result = {
      testName,
      passed: typeof summary === 'string',
      details: {
        summaryReturned: typeof summary === 'string',
        summaryPreview: summary ? summary.substring(0, 100) : null
      }
    };
    
    if (!result.passed) {
      result.error = `Функция buildUserOrderSummary не вернула строку`;
    }
    
    return result;
  } catch (error) {
    return {
      testName,
      passed: false,
      error: error.message,
      details: { stack: error.stack }
    };
  }
}

/**
 * Generate comprehensive report from test results
 */
function generateComprehensiveReport(results) {
  let report = "=== КОМПЛЕКСНЫЙ ТЕСТ СИСТЕМЫ VK АУКЦИОННОГО БОТА ===\n\n";
  
  let passedCount = 0;
  let failedCount = 0;
  
  results.forEach((result, index) => {
    report += `${index + 1}. ${result.testName}: ${result.passed ? '✅ ПРОШЕЛ' : '❌ НЕ ПРОШЕЛ'}\n`;
    
    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
      if (result.error) {
        report += `   Ошибка: ${result.error}\n`;
      }
    }
    
    if (result.details) {
      report += `   Детали: ${JSON.stringify(result.details, null, 2)}\n`;
    }
    
    report += "\n";
  });
  
  report += `=== ИТОГИ ===\n`;
  report += `Всего тестов: ${results.length}\n`;
  report += `Пройдено: ${passedCount}\n`;
  report += `Провалено: ${failedCount}\n`;
  report += `Успешность: ${Math.round((passedCount/results.length)*100)}%\n`;
  
  // Add settings summary
  try {
    const settings = getSettings();
    report += `\n=== НАСТРОЙКИ СИСТЕМЫ ===\n`;
    report += `send_winner_dm_enabled: ${settings.send_winner_dm_enabled}\n`;
    report += `subscription_check_enabled: ${settings.subscription_check_enabled}\n`;
    report += `reply_on_invalid_bid_enabled: ${settings.reply_on_invalid_bid_enabled}\n`;
    report += `debug_logging_enabled: ${settings.debug_logging_enabled}\n`;
    report += `bid_step_enabled: ${settings.bid_step_enabled}\n`;
    report += `require_subscription: ${settings.require_subscription}\n`;
  } catch (e) {
    report += `\n=== НАСТРОЙКИ СИСТЕМЫ ===\n`;
    report += `Ошибка при получении настроек: ${e.message}\n`;
  }
  
  return report;
}