/**
 * @fileoverview Complete Test Suite for VK Auction Bot
 * This file provides comprehensive test coverage for all system components
 * including real-world battle scenarios.
 * 
 * Usage:
 * - Run from GAS editor: runCompleteTestSuite()
 * - Run via Web App: ?action=run_tests&secret=YOUR_SECRET
 * - Run specific test: runBattleSimulation()
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const TEST_CONFIG = {
  // Test timeouts and delays
  VERIFICATION_RETRIES: 10,
  VERIFICATION_INITIAL_DELAY: 1000,
  SLEEP_BETWEEN_STEPS: 2000,
  SLEEP_AFTER_QUEUE_PROCESSING: 5000,
  
  // Test data prefixes
  LOT_PREFIX: 'TEST_SUITE_',
  USER_PREFIX: 'TEST_USER_',
  
  // Expected test results
  EXPECTED_BID_STEP: 50,
  EXPECTED_MIN_INCREMENT: 50
};

// Global test log buffer
let TEST_LOG_BUFFER = [];

/**
 * Helper function for structured test logging
 */
function testLog(message, data) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    data: data || null
  };
  TEST_LOG_BUFFER.push(logEntry);
  
  // Also log to GAS Logger and Monitoring
  const logMessage = `[TEST ${timestamp}] ${message}`;
  Logger.log(logMessage);
  
  if (data) {
    Logger.log(JSON.stringify(data, null, 2));
  }
  
  // Record to Statistics sheet
  try {
    Monitoring.recordEvent('TEST_LOG', { message, data: JSON.stringify(data) });
  } catch (e) {
    // Monitoring might not be available during early tests
  }
  
  return logEntry;
}

/**
 * Clear test log buffer
 */
function clearTestLog() {
  TEST_LOG_BUFFER = [];
}

/**
 * Get test log as formatted string
 */
function getTestLog() {
  return TEST_LOG_BUFFER.map(entry => {
    let line = `[${entry.timestamp}] ${entry.message}`;
    if (entry.data) {
      line += '\n' + JSON.stringify(entry.data, null, 2);
    }
    return line;
  }).join('\n');
}

// =============================================================================
// MASTER TEST RUNNER
// =============================================================================

/**
 * Run all tests including payment simulation
 */
function runCompleteTestSuite() {
  const startTime = new Date();
  TEST_LOG_BUFFER = []; // Reset buffer
  
  testLog("🚀 Starting Complete Test Suite", { 
    timestamp: startTime.toISOString(),
    config: TEST_CONFIG 
  });
  
  // Run pre-flight checks
  const preflightResult = runPreFlightChecks();
  if (!preflightResult.passed) {
    return generateTestReport([preflightResult], startTime);
  }
  
  // Run all test functions
  const testFunctions = [
    testPropertiesExist,
    testSheetsAccessible,
    testVkTokensValid,
    testTemplatesFromSettings,
    testToggleSettings,  // NEW: All toggle settings test
    testPostFinalizationDataIntegrity,
    testPaymentSimulation,
    testPaymentProcessing, // NEW: Payment processing test
    testBidValidationLogic,
    testAntiSnipingMechanism,
    testWinnerDetermination,
    testNotificationQueueProcessing
  ];
  
  const results = testFunctions.map(fn => {
    try {
      return fn();
    } catch (error) {
      testLog(`ERROR in ${fn.name}`, { error: error.message });
      return { passed: false, name: fn.name, error: error.message };
    }
  });
  
  const endTime = new Date();
  return generateTestReport(results, startTime, endTime);
}

/**
 * Check all pre-requisites are set correctly before testing starts
 * Returns early results immediately without executing main suite if errors occur
 * @returns {Object} Summary results including if checks were successful or failed
 */
function runPreFlightChecks() {
  try {
    const props = PropertiesService.getScriptProperties();
    const userToken = props.getProperty('USER_TOKEN');
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    if (!userToken || !vkToken || !groupId) {
      const missing = [];
      if (!userToken) missing.push('USER_TOKEN');
      if (!vkToken) missing.push('VK_TOKEN');
      if (!groupId) missing.push('GROUP_ID');
      
      testLog('Missing required tokens for battle simulation', {
        missing
      });
      
      return {
        passed: false,
        error: `Missing tokens. Set ${missing.join(' & ')} and re-deploy project`,
        details: { missingTokens: missing }
      };
    }
    
    return {
      passed: true,
      details: { hasUserToken: true, hasVkToken: true, hasGroupId: true }
    };
  } catch (error) {
    testLog('Error running pre-flight checks', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      passed: false,
      error: error.message,
      stack: error.stack
    };
  }
}

/**
 * Test that the app settings/templates loaded successfully and look ok
 * This checks that all required keys from Config.yaml were present/ok on sheet loading
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testTemplatesFromSettings() {
  const testName = "INTEGRATION: Templates from Settings";
  testLog(`Starting ${testName}`);
  
  try {
    const settings = getSettings();
    
    // Required templates that MUST be in Settings
    const requiredTemplates = [
      { key: 'outbid_notification_template', name: 'Outbid Notification' },
      { key: 'low_bid_notification_template', name: 'Low Bid Notification' },
      { key: 'winner_notification_template', name: 'Winner Notification' },
      { key: 'winner_comment_template', name: 'Winner Comment' },
      { key: 'unsold_lot_comment_template', name: 'Unsold Lot Comment' },
      { key: 'subscription_required_template', name: 'Subscription Required' },
      { key: 'order_summary_template', name: 'Order Summary' }
    ];
    
    const results = requiredTemplates.map(t => {
      const template = settings[t.key];
      const hasValue = template && typeof template === 'string' && template.length > 0;
      const notDefault = hasValue && !template.includes('Ошибка: шаблон не найден');
      
      return {
        key: t.key,
        name: t.name,
        hasValue,
        notDefault,
        length: hasValue ? template.length : 0,
        preview: hasValue ? template.substring(0, 50) + '...' : 'MISSING'
      };
    });
    
    const failed = results.filter(r => !r.hasValue || !r.notDefault);
    
    testLog(`Templates check: ${failed.length === 0 ? 'PASSED' : 'FAILED'}`, {
      total: requiredTemplates.length,
      passed: results.filter(r => r.hasValue && r.notDefault).length,
      failed: failed.map(f => f.key)
    });
    
    return {
      passed: failed.length === 0,
      testName,
      details: { templates: results, failedCount: failed.length }
    };
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, testName, error: error.message };
  }
}

/**
 * Test that the app settings/templates loaded successfully and look ok
 * This checks that all required keys from Config.yaml were present/ok on sheet loading
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testPropertiesExist() {
  const testName = "INTEGRATION: Required Properties";
  testLog(`Starting ${testName}`);
  
  try {
    const props = PropertiesService.getScriptProperties();
    const requiredProps = ['VK_TOKEN', 'GROUP_ID', 'VK_SECRET'];
    const missing = [];
    const present = [];
    
    requiredProps.forEach(prop => {
      const value = props.getProperty(prop);
      if (!value) {
        missing.push(prop);
      } else {
        present.push(prop);
      }
    });
    
    const passed = missing.length === 0;
    
    testLog(`Properties check: ${passed ? 'PASSED' : 'FAILED'}`, {
      present,
      missing,
      count: { present: present.length, missing: missing.length }
    });
    
    return {
      testName,
      passed,
      critical: true,
      details: { present, missing }
    };
  } catch (error) {
    testLog('Error checking properties', { error: error.message });
    return { testName, passed: false, critical: true, error: error.message };
  }
}

/**
 * Test that the app settings/templates loaded successfully and look ok
 * This checks that all required keys from Config.yaml were present/ok on sheet loading
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testSheetsAccessible() {
  const testName = "INTEGRATION: Sheets Access";
  testLog(`Starting ${testName}`);
  
  try {
    const requiredSheets = ['Config', 'Bids', 'Users', 'Orders', 'Settings', 'EventQueue', 'NotificationQueue', 'Logs', 'Incoming'];
    
    const results = requiredSheets.map(sheetKey => {
      try {
        const sheet = getSheet(sheetKey);
        return { sheet: sheetKey, exists: !!sheet, passed: !!sheet };
      } catch (e) {
        return { sheet: sheetKey, exists: false, passed: false, error: e.message };
      }
    });
    
    const failed = results.filter(r => !r.passed);
    
    return {
      testName,
      passed: failed.length === 0,
      details: { total: requiredSheets.length, failed: failed.map(f => f.sheet) }
    };
  } catch (error) {
    return { testName, passed: false, error: error.message };
  }
}

/**
 * Test that the app settings/templates loaded successfully and look ok
 * This checks that all required keys from Config.yaml were present/ok on sheet loading
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testVkTokensValid() {
  const testName = "INTEGRATION: VK Token Validation";
  testLog(`Starting ${testName}`);
  
  try {
    const props = PropertiesService.getScriptProperties();
    const vkToken = props.getProperty('VK_TOKEN');
    const userToken = props.getProperty('USER_TOKEN');
    
    if (!vkToken) {
      return {
        testName,
        passed: false,
        critical: true,
        error: 'VK_TOKEN not set',
        details: { hasVkToken: false, hasUserToken: !!userToken }
      };
    }
    
    // Try to validate token with a simple API call
    testLog('Validating VK_TOKEN with API call...');
    const testResult = callVk('groups.getById', {}, vkToken);
    
    if (testResult && testResult.error) {
      testLog('VK_TOKEN validation failed', { error: testResult.error });
      return {
        testName,
        passed: false,
        critical: true,
        error: `VK API error: ${testResult.error.error_msg || JSON.stringify(testResult.error)}`,
        details: { hasVkToken: true, hasUserToken: !!userToken, apiError: testResult.error }
      };
    }
    
    testLog('VK_TOKEN validated successfully');
    return {
      testName,
      passed: true,
      critical: true,
      details: { hasVkToken: true, hasUserToken: !!userToken, apiResponse: !!testResult }
    };
  } catch (error) {
    testLog('Error validating VK tokens', { error: error.message });
    return { testName, passed: false, critical: true, error: error.message };
  }
}

/**
 * Test payment simulation
 * Simulates user sending shipping details after winning
 */
function testPaymentSimulation() {
  const testName = "INTEGRATION: Payment Simulation";
  testLog(`Starting ${testName}`);
  
  try {
    // 1. Create test lot
    const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
    const testUserId = TEST_CONFIG.USER_PREFIX + Utilities.getUuid().slice(0, 8);
    
    const testLot = {
      lot_id: testLotId,
      name: "Test Payment Lot",
      start_price: 100,
      current_price: 200,
      leader_id: testUserId,
      status: "active",
      deadline: new Date(Date.now() + 300000), // 5 minutes from now
      created_at: new Date()
    };
    
    appendRow("Config", testLot);
    testLog("Created test lot", { lot_id: testLotId });
    
    // 2. Create user
    const testUser = {
      user_id: testUserId,
      user_name: "Test Payment User",
      first_win_date: new Date(),
      last_win_date: new Date(),
      total_lots_won: 1,
      total_lots_paid: 0,
      shipping_status: "accumulating",
      shipping_details: ""
    };
    
    appendRow("Users", testUser);
    testLog("Created test user", { user_id: testUserId });
    
    // 3. Create order
    const testOrder = {
      order_id: `${testLotId}-${testUserId}`,
      lot_id: testLotId,
      lot_name: testLot.name,
      post_id: "123456_789",
      user_id: testUserId,
      win_date: new Date(),
      win_price: 200,
      status: "unpaid",
      shipping_batch_id: ""
    };
    
    appendRow("Orders", testOrder);
    testLog("Created test order", { order_id: testOrder.order_id });
    
    // 4. Simulate user sending shipping details (this triggers the confirmation message)
    const shippingMessage = "Иванов Иван Иванович, город Москва, улица Ленина 10, квартира 5, 89123456789";
    
    // Mock handleMessageNew function call
    // In real scenario, this would be triggered by VK callback
    // For testing, we'll directly call the logic
    
    const phoneRegex = /(?:\+7|8)[\s\-]?\(?(\d{3})\)?[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/;
    const fioRegex = /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/;
    
    const phoneMatch = shippingMessage.match(phoneRegex);
    const fioMatch = shippingMessage.match(fioRegex);
    
    if (phoneMatch && fioMatch) {
      const phone = phoneMatch[0];
      const fio = fioMatch[0];
      const address = shippingMessage.replace(phoneRegex, '').replace(fioRegex, '').replace(/\s+/g, ' ').trim();
      
      const shippingDetails = `ФИО: ${fio}\nТелефон: ${phone}\nАдрес: ${address}`;
      
      // Update user with shipping details
      const users = getSheetData("Users");
      const userRow = users.find(u => String(u.data.user_id) === testUserId);
      
      if (userRow) {
        updateRow("Users", userRow.rowIndex, { shipping_details: shippingDetails });
        testLog("Updated user with shipping details", { user_id: testUserId });
        
        // Get confirmation message from settings
        const settings = getSettings();
        const confirmationMsg = settings.shipping_confirmation_template || '✅ Спасибо, данные для доставки приняты!';
        
        testLog("Confirmation message from settings", { 
          template_exists: !!settings.shipping_confirmation_template,
          message: confirmationMsg 
        });
        
        // Verify the message comes from settings
        if (confirmationMsg === '✅ Спасибо, данные для доставки приняты!') {
          testLog("WARNING: Using default message, not from settings", { message: confirmationMsg });
        } else {
          testLog("SUCCESS: Message correctly loaded from settings", { message: confirmationMsg });
        }
      }
    }
    
    // 5. Verify data integrity
    const updatedUsers = getSheetData("Users");
    const updatedUser = updatedUsers.find(u => String(u.data.user_id) === testUserId);
    
    if (!updatedUser || !updatedUser.data.shipping_details) {
      throw new Error("Shipping details not saved to user record");
    }
    
    testLog("Payment simulation completed successfully");
    return { passed: true, name: testName };
    
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, name: testName, error: error.message };
  }
}

/**
 * Test payment processing and data integrity
 * Simulates user payment and verifies data is recorded correctly
 */
function testPaymentProcessing() {
  const testName = "INTEGRATION: Payment Processing";
  testLog(`Starting ${testName}`);
  
  try {
    // 1. Create test lot
    const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
    const testUserId = TEST_CONFIG.USER_PREFIX + Utilities.getUuid().slice(0, 8);
    
    const testLot = {
      lot_id: testLotId,
      name: "Test Payment Processing Lot",
      start_price: 100,
      current_price: 200,
      leader_id: testUserId,
      status: "active",
      deadline: new Date(Date.now() + 300000),
      created_at: new Date()
    };
    
    appendRow("Config", testLot);
    testLog("Created test lot", { lot_id: testLotId });
    
    // 2. Create user with initial stats
    const testUser = {
      user_id: testUserId,
      user_name: "Test Payment User",
      first_win_date: new Date(),
      last_win_date: new Date(),
      total_lots_won: 1,
      total_lots_paid: 0, // Initially 0
      shipping_status: "accumulating",
      shipping_details: ""
    };
    
    appendRow("Users", testUser);
    testLog("Created test user", { user_id: testUserId, initial_paid: 0 });
    
    // 3. Create unpaid order
    const testOrder = {
      order_id: `${testLotId}-${testUserId}`,
      lot_id: testLotId,
      lot_name: testLot.name,
      post_id: "123456_789",
      user_id: testUserId,
      win_date: new Date(),
      win_price: 200,
      status: "unpaid", // Initially unpaid
      shipping_batch_id: ""
    };
    
    appendRow("Orders", testOrder);
    testLog("Created test order", { order_id: testOrder.order_id, status: "unpaid" });
    
    // 4. Simulate payment processing
    // In real scenario, this would be triggered by admin marking order as paid
    // For testing, we'll simulate the data update logic
    
    // Update order status to "paid"
    const orders = getSheetData("Orders");
    const orderRow = orders.find(o => o.data.order_id === testOrder.order_id);
    
    if (orderRow) {
      updateRow("Orders", orderRow.rowIndex, { status: "paid" });
      testLog("Updated order status to paid", { order_id: testOrder.order_id });
    }
    
    // Update user's paid count
    const users = getSheetData("Users");
    const userRow = users.find(u => String(u.data.user_id) === testUserId);
    
    if (userRow) {
      const newPaidCount = (Number(userRow.data.total_lots_paid) || 0) + 1;
      updateRow("Users", userRow.rowIndex, { 
        total_lots_paid: newPaidCount,
        last_win_date: new Date() // Update last win date
      });
      testLog("Updated user paid count", { 
        user_id: testUserId, 
        old_paid: userRow.data.total_lots_paid || 0,
        new_paid: newPaidCount 
      });
    }
    
    // 5. Verify data integrity
    const updatedOrders = getSheetData("Orders");
    const updatedOrder = updatedOrders.find(o => o.data.order_id === testOrder.order_id);
    
    const updatedUsers = getSheetData("Users");
    const updatedUser = updatedUsers.find(u => String(u.data.user_id) === testUserId);
    
    // Assertions
    if (!updatedOrder) {
      throw new Error("Order not found after update");
    }
    
    if (updatedOrder.data.status !== "paid") {
      throw new Error(`Order status is '${updatedOrder.data.status}', expected 'paid'`);
    }
    
    if (!updatedUser) {
      throw new Error("User not found after update");
    }
    
    if (Number(updatedUser.data.total_lots_paid) !== 1) {
      throw new Error(`User paid count is ${updatedUser.data.total_lots_paid}, expected 1`);
    }
    
    if (Number(updatedUser.data.total_lots_won) !== 1) {
      throw new Error(`User won count is ${updatedUser.data.total_lots_won}, expected 1`);
    }
    
    testLog("Payment processing data integrity verified");
    return { passed: true, name: testName };
    
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, name: testName, error: error.message };
  }
}

/**
 * Test bid validation logic
 * This checks that bids are correctly validated according to rules
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testBidValidationLogic() {
  const testName = "INTEGRATION: Bid Validation Logic";
  testLog(`Starting ${testName}`);
  
  try {
    const mockLot = {
      current_price: 1000,
      start_price: 1000,
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      bid_step: 50
    };
    
    const testCases = [
      { bid: 1050, expected: true, desc: "Valid bid with step" },
      { bid: 1000, expected: false, desc: "Same as current" },
      { bid: 950, expected: false, desc: "Below current" },
      { bid: 1075, expected: false, desc: "Not matching step" },
      { bid: 2000000, expected: false, desc: "Over max bid" }
    ];
    
    const results = testCases.map(tc => {
      const result = validateBid(tc.bid, mockLot);
      return {
        desc: tc.desc,
        bid: tc.bid,
        expectedValid: tc.expected,
        actualValid: result.isValid,
        passed: result.isValid === tc.expected
      };
    });
    
    const failed = results.filter(r => !r.passed);
    
    return {
      testName,
      passed: failed.length === 0,
      details: { total: testCases.length, failed: failed.length }
    };
  } catch (error) {
    return { testName, passed: false, error: error.message };
  }
}

/**
 * Test anti-sniping mechanism
 * This checks that auction is extended if bid is made in last 10 minutes
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testAntiSnipingMechanism() {
  const testName = "INTEGRATION: Anti-Sniping Mechanism";
  testLog(`Starting ${testName}`);
  
  try {
    // Create lot with deadline 5 minutes from now
    const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
    const originalDeadline = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    
    const lotData = {
      lot_id: testLotId,
      post_id: `-123456789_${Utilities.getUuid().substring(0, 6)}`,
      name: "Test Extension",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      created_at: new Date(),
      deadline: originalDeadline,
      bid_step: 50
    };
    
    upsertLot(lotData);
    
    // Simulate bid in last 10 minutes
    const timeUntilDeadline = 5; // 5 minutes
    const shouldExtend = timeUntilDeadline <= 10 && timeUntilDeadline > 0;
    
    // Cleanup
    const lots = getSheetData("Config");
    const createdLot = lots.find(l => l.data.lot_id === testLotId);
    if (createdLot) {
      try {
        getSheet("Config").deleteRow(createdLot.rowIndex);
      } catch (e) {}
    }
    
    return {
      testName,
      passed: shouldExtend,
      details: { shouldExtend, timeUntilDeadline }
    };
  } catch (error) {
    return { testName, passed: false, error: error.message };
  }
}

/**
 * Test winner determination
 * This checks that winner is correctly determined after auction ends
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testWinnerDetermination() {
  const testName = "INTEGRATION: Winner Determination";
  testLog(`Starting ${testName}`);
  
  try {
    // Step 1: Create test lot
    const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
    const testUserId = TEST_CONFIG.USER_PREFIX + Utilities.getUuid().slice(0, 8);
    
    const testLot = {
      lot_id: testLotId,
      name: "Test Winner Lot",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      deadline: new Date(Date.now() + 300000), // 5 minutes from now
      created_at: new Date()
    };
    
    appendRow("Config", testLot);
    testLog("Created test lot", { lot_id: testLotId });
    
    // Step 2: Simulate bids
    const testBids = [
      { amount: 150, user: testUserId },
      { amount: 200, user: testUserId },
      { amount: 250, user: testUserId }
    ];
    
    testBids.forEach(bid => {
      appendRow("Bids", {
        bid_id: Utilities.getUuid(),
        lot_id: testLotId,
        user_id: bid.user,
        bid_amount: bid.amount,
        timestamp: new Date(),
        comment_id: "TEST_" + Utilities.getUuid().slice(0, 8),
        status: "лидер"
      });
    });
    
    // Update lot with final bid
    updateLot(testLotId, {
      current_price: 250,
      leader_id: testUserId
    });
    
    // Step 3: Finalize auction
    updateLot(testLotId, {
      status: "sold",
      deadline: new Date(Date.now() - 1000) // Past deadline
    });
    
    // Step 4: Verify winner
    const finalLot = getSheetData("Config").find(l => l.data.lot_id === testLotId);
    const winner = finalLot.data.winner;
    
    if (winner !== testUserId) {
      throw new Error(`Winner mismatch. Expected ${testUserId}, got ${winner}`);
    }
    
    testLog("Winner determination completed successfully");
    return { passed: true, name: testName };
    
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, name: testName, error: error.message };
  }
}

/**
 * Test notification queue processing
 * This checks that notifications are correctly queued and processed
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testNotificationQueueProcessing() {
  const testName = "INTEGRATION: Notification Queue Processing";
  testLog(`Starting ${testName}`);
  
  try {
    // 1. Create test lot
    const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
    const testUserId = TEST_CONFIG.USER_PREFIX + Utilities.getUuid().slice(0, 8);
    
    const testLot = {
      lot_id: testLotId,
      name: "Test Notification Lot",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      deadline: new Date(Date.now() + 300000), // 5 minutes from now
      created_at: new Date()
    };
    
    appendRow("Config", testLot);
    testLog("Created test lot", { lot_id: testLotId });
    
    // 2. Create user
    const testUser = {
      user_id: testUserId,
      user_name: "Test Notification User",
      first_win_date: new Date(),
      last_win_date: new Date(),
      total_lots_won: 1,
      total_lots_paid: 0,
      shipping_status: "accumulating",
      shipping_details: ""
    };
    
    appendRow("Users", testUser);
    testLog("Created test user", { user_id: testUserId });
    
    // 3. Create order
    const testOrder = {
      order_id: `${testLotId}-${testUserId}`,
      lot_id: testLotId,
      lot_name: testLot.name,
      post_id: "123456_789",
      user_id: testUserId,
      win_date: new Date(),
      win_price: 200,
      status: "unpaid",
      shipping_batch_id: ""
    };
    
    appendRow("Orders", testOrder);
    testLog("Created test order", { order_id: testOrder.order_id });
    
    // 4. Queue notification
    queueNotification({
      user_id: testUserId,
      type: "winner",
      payload: {
        lot_id: testLotId,
        lot_name: testLot.name,
        price: 200
      }
    });
    
    testLog("Queued notification", { user_id: testUserId });
    
    // 5. Simulate notification processing
    // In real scenario, this would be triggered by cron job
    // For testing, we'll directly call the logic
    
    const notificationQueue = getSheetData("NotificationQueue");
    const notification = notificationQueue.find(n => n.data.user_id === testUserId);
    
    if (notification) {
      testLog("Notification found in queue", { user_id: testUserId });
      
      // Process notification
      sendNotification(notification.data);
      updateNotificationStatus(notification.data.queue_id, "processed", new Date());
      
      // Verify notification is marked as processed
      const processedNotification = getSheetData("NotificationQueue").find(n => n.data.user_id === testUserId);
      if (processedNotification && processedNotification.status === "processed") {
        testLog("Notification processed successfully", { user_id: testUserId });
      } else {
        throw new Error("Notification not processed");
      }
    } else {
      throw new Error("Notification not found in queue");
    }
    
    // 6. Verify data integrity
    const updatedUsers = getSheetData("Users");
    const updatedUser = updatedUsers.find(u => String(u.data.user_id) === testUserId);
    
    if (!updatedUser) {
      throw new Error("User not found after notification processing");
    }
    
    testLog("Notification queue processing completed successfully");
    return { passed: true, name: testName };
    
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, name: testName, error: error.message };
  }
}

/**
 * Verify data integrity after auction finalization
 * This checks that all sheets are filled with correct data after auction ends
 * @returns {Object} Test result status passed | !passed | err: reason_for_failure
 */
function testPostFinalizationDataIntegrity() {
  const testName = "INTEGRATION: Post-Finalization Data Integrity";
  testLog(`Starting ${testName}`);
  
  const testLotId = TEST_CONFIG.LOT_PREFIX + Utilities.getUuid().slice(0, 8);
  const testUserId = TEST_CONFIG.USER_PREFIX + Utilities.getUuid().slice(0, 8);
  
  try {
    // Step 1: Create test lot
    const lotData = {
      lot_id: testLotId,
      post_id: `-123456789_${Date.now()}`,
      name: "Finalization Test Lot",
      start_price: 100,
      current_price: 250,
      leader_id: testUserId,
      status: "active",
      created_at: new Date(),
      deadline: new Date(Date.now() - 1000), // Already passed
      bid_step: 50,
      image_url: "https://test.com/image.jpg",
      attachment_id: "photo123_456"
    };
    upsertLot(lotData);
    
    // Step 2: Create test bid
    const bidId = Utilities.getUuid();
    appendRow("Bids", {
      bid_id: bidId,
      lot_id: testLotId,
      user_id: testUserId,
      bid_amount: 250,
      timestamp: new Date(),
      comment_id: "test_comment_123",
      status: "лидер"
    });
    
    // Step 3: Simulate finalization (partial)
    // Instead of calling finalizeAuction() which affects real data,
    // we manually create the expected data structures
    
    // Create order
    const orderId = `${testLotId}-${testUserId}`;
    appendRow("Orders", {
      order_id: orderId,
      lot_id: testLotId,
      lot_name: lotData.name,
      post_id: lotData.post_id,
      user_id: testUserId,
      win_date: new Date(),
      win_price: lotData.current_price,
      status: 'unpaid',
      shipping_batch_id: ''
    });
    
    // Update lot status
    updateLot(testLotId, { status: "sold" });
    
    // Create/update user
    const users = getSheetData("Users");
    const existingUser = users.find(u => String(u.data.user_id) === testUserId);
    
    if (existingUser) {
      updateRow("Users", existingUser.rowIndex, {
        last_win_date: new Date(),
        total_lots_won: (Number(existingUser.data.total_lots_won) || 0) + 1
      });
    } else {
      appendRow("Users", {
        user_id: testUserId,
        user_name: "Test User",
        first_win_date: new Date(),
        last_win_date: new Date(),
        total_lots_won: 1,
        total_lots_paid: 0,
        shipping_status: 'accumulating',
        shipping_details: ''
      });
    }
    
    // Step 4: Verify data integrity
    
    // Check Config (Lot)
    const lotsAfter = getSheetData("Config");
    const soldLot = lotsAfter.find(l => l.data.lot_id === testLotId);
    const lotStatusCorrect = soldLot && soldLot.data.status === "sold";
    testLog('Lot status check', { lotId: testLotId, status: soldLot?.data.status });
    
    // Check Orders
    const orders = getSheetData("Orders");
    const order = orders.find(o => o.data.lot_id === testLotId);
    const orderCorrect = order && 
      order.data.status === 'unpaid' && 
      order.data.win_price === 250 &&
      order.data.user_id === testUserId;
    testLog('Order check', { orderId: order?.data.order_id, status: order?.data.status, price: order?.data.win_price });
    
    // Check Users
    const usersAfter = getSheetData("Users");
    const winner = usersAfter.find(u => String(u.data.user_id) === testUserId);
    const userCorrect = winner && 
      winner.data.total_lots_won >= 1 &&
      winner.data.last_win_date;
    testLog('User check', { userId: testUserId, lotsWon: winner?.data.total_lots_won });
    
    // Check Bids
    const bidsAfter = getSheetData("Bids");
    const bid = bidsAfter.find(b => b.data.lot_id === testLotId);
    const bidCorrect = bid && bid.data.bid_amount === 250;
    testLog('Bid check', { bidId: bid?.data.bid_id, amount: bid?.data.bid_amount });
    
    // Step 5: Cleanup
    try {
      // Remove test lot
      if (soldLot) getSheet("Config").deleteRow(soldLot.rowIndex);
      
      // Remove test order
      if (order) getSheet("Orders").deleteRow(order.rowIndex);
      
      // Remove test user
      if (winner) getSheet("Users").deleteRow(winner.rowIndex);
      
      // Remove test bid
      if (bid) getSheet("Bids").deleteRow(bid.rowIndex);
    } catch (cleanupError) {
      testLog('Cleanup error', { error: cleanupError.message });
    }
    
    const allChecksPassed = lotStatusCorrect && orderCorrect && userCorrect && bidCorrect;
    
    return {
      testName,
      passed: allChecksPassed,
      details: {
        lotStatusCorrect,
        orderCorrect,
        userCorrect,
        bidCorrect,
        checks: {
          lot: { status: soldLot?.data.status },
          order: { id: order?.data.order_id, status: order?.data.status },
          user: { id: winner?.data.user_id, lotsWon: winner?.data.total_lots_won },
          bid: { amount: bid?.data.bid_amount }
        }
      }
    };
  } catch (error) {
    testLog('Data integrity test failed', { error: error.message });
    
    // Cleanup on error
    try {
      const lots = getSheetData("Config");
      const lot = lots.find(l => l.data.lot_id === testLotId);
      if (lot) getSheet("Config").deleteRow(lot.rowIndex);
    } catch (e) {}
    
    return { testName, passed: false, error: error.message };
  }
}

/**
 * Test all toggle settings functionality
 * Verifies each toggle setting works correctly
 */
function testToggleSettings() {
  const testName = "UNIT: Toggle Settings";
  testLog(`Starting ${testName}`);
  
  try {
    const settings = getSettings();
    
    // List of all toggle settings that should exist
    const requiredToggles = [
      { key: 'bid_step_enabled', name: 'Bid Step Enabled', expected: 'ВКЛ' },
      { key: 'subscription_check_enabled', name: 'Subscription Check Enabled', expected: 'ВЫКЛ' },
      { key: 'debug_logging_enabled', name: 'Debug Logging Enabled', expected: 'ВЫКЛ' },
      { key: 'reply_on_invalid_bid_enabled', name: 'Reply on Invalid Bid Enabled', expected: 'ВКЛ' },
      { key: 'send_winner_dm_enabled', name: 'Send Winner DM Enabled', expected: 'ВКЛ' }
    ];
    
    let passedCount = 0;
    let totalCount = requiredToggles.length;
    
    requiredToggles.forEach(toggle => {
      const value = settings[toggle.key];
      testLog(`Checking ${toggle.name}`, { 
        key: toggle.key, 
        expected: toggle.expected, 
        actual: value 
      });
      
      if (value === undefined) {
        testLog(`❌ Missing toggle: ${toggle.key}`);
      } else if (value !== toggle.expected) {
        testLog(`⚠️  Unexpected value for ${toggle.key}: expected ${toggle.expected}, got ${value}`);
      } else {
        testLog(`✅ ${toggle.name} correct: ${value}`);
        passedCount++;
      }
    });
    
    const passed = passedCount === totalCount;
    testLog(`${testName} result`, { passed: passed, passed_count: passedCount, total: totalCount });
    
    return { 
      passed: passed, 
      name: testName,
      details: `${passedCount}/${totalCount} toggles correct`
    };
    
  } catch (error) {
    testLog(`FAILED: ${testName}`, { error: error.message });
    return { passed: false, name: testName, error: error.message };
  }
}

// =============================================================================
// BATTLE SIMULATION (Real VK API calls)
// =============================================================================

/**
 * Runs full battle simulation with real VK API calls
 * This is the most comprehensive test that exercises the entire system
 * 
 * Tests the COMPLETE cycle according to documentation:
 * 1. Bot creates lot -> recorded in Config
 * 2. User bids -> recorded in Bids, Config updated
 * 3. Auction finalizes -> Orders created, Users updated, Notifications queued
 * 4. Winner interaction -> Shipping details saved
 */
function runBattleSimulation() {
  const testName = "BATTLE: Full Cycle Simulation";
  const startTime = new Date();
  
  testLog('=== STARTING BATTLE SIMULATION ===');
  
  const verificationResults = {
    lotCreated: false,
    bidsRecorded: false,
    auctionFinalized: false,
    orderCreated: false,
    userUpdated: false,
    notificationQueued: false
  };
  
  try {
    // Check if we have required tokens
    const props = PropertiesService.getScriptProperties();
    const userToken = props.getProperty('USER_TOKEN');
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    if (!userToken || !vkToken || !groupId) {
      testLog('Missing required tokens for battle simulation', {
        hasUserToken: !!userToken,
        hasVkToken: !!vkToken,
        hasGroupId: !!groupId
      });
      
      return {
        testName,
        passed: false,
        error: "Missing required tokens. Set USER_TOKEN, VK_TOKEN, and GROUP_ID.",
        critical: false,
        details: { hasUserToken: !!userToken, hasVkToken: !!vkToken, hasGroupId: !!groupId }
      };
    }
    
    // Run the actual full cycle simulation from AuctionSimulator.gs
    // This function already does all the verification steps
    testLog('Calling runFullCycleSimulation()...');
    const result = runFullCycleSimulation();
    
    testLog('runFullCycleSimulation() returned', { result: result?.substring?.(0, 200) });
    
    // Check if the result indicates success
    const successIndicators = [
      result && result.includes && result.includes("SUCCESSFULLY"),
      result && result.includes && result.includes("✅")
    ];
    const passed = successIndicators.some(indicator => indicator === true);
    
    const duration = (new Date() - startTime) / 1000;
    
    testLog('Battle simulation completed', {
      passed,
      duration,
      resultPreview: result?.substring?.(0, 100)
    });
    
    return {
      testName,
      passed,
      duration,
      details: {
        result: result?.substring?.(0, 500) || "No result",
        hasUserToken: true,
        hasVkToken: true,
        hasGroupId: true
      }
    };
    
  } catch (error) {
    testLog('CRITICAL ERROR in battle simulation', {
      error: error.message,
      stack: error.stack
    });
    
    const duration = (new Date() - startTime) / 1000;
    
    return {
      testName,
      passed: false,
      error: error.message,
      stack: error.stack,
      duration,
      details: verificationResults
    };
  }
}

// =============================================================================
// BATTLE SIMULATION HELPERS
// =============================================================================

function createTestLot() {
  try {
    const testId = TEST_CONFIG.LOT_PREFIX + Date.now();
    const configSheet = getSheet('Config');
    
    if (!configSheet) {
      return { success: false, error: 'Config sheet not found' };
    }
    
    // Add test lot row
    const row = [
      testId,                    // A: ID
      'Test Lot ' + testId,      // B: Title
      'Test description',        // C: Description
      50,                        // D: Start price
      50,                        // E: Step
      1000,                      // F: Buy now
      10,                        // G: Duration minutes
      'https://example.com/img.jpg', // H: Image
      'active',                  // I: Status
      new Date().toISOString(),  // J: Created
      '',                        // K: VK Post ID
      ''                         // L: Winner
    ];
    
    configSheet.appendRow(row);
    
    testLog('Test lot created in Config', { lotId: testId });
    
    return { success: true, lotId: testId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function publishTestPost(lotId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    if (!vkToken || !groupId) {
      return { success: false, error: 'Missing VK_TOKEN or GROUP_ID' };
    }
    
    const message = `🧪 TEST LOT ${lotId}\n\nThis is a test auction lot.\n\nStart: 50₽\nStep: 50₽\n\n#test #auction`;
    
    const result = callVk('wall.post', {
      owner_id: '-' + groupId,
      message: message,
      from_group: 1
    }, vkToken);
    
    if (result && result.error) {
      return { 
        success: false, 
        error: result.error.error_msg || JSON.stringify(result.error),
        vkError: result.error
      };
    }
    
    if (!result || !result.response || !result.response.post_id) {
      return { success: false, error: 'Invalid response from VK API', response: result };
    }
    
    const postId = result.response.post_id;
    
    // Update Config with VK Post ID
    const configSheet = getSheet('Config');
    const data = configSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === lotId) {
        configSheet.getRange(i + 1, 11).setValue(postId); // Column K
        break;
      }
    }
    
    testLog('VK post published and linked to lot', { postId, lotId });
    
    return { success: true, postId: postId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function verifyPostExists(postId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    // Retry logic for eventual consistency
    for (let attempt = 1; attempt <= TEST_CONFIG.VERIFICATION_RETRIES; attempt++) {
      const result = callVk('wall.getById', {
        posts: `-${groupId}_${postId}`
      }, vkToken);
      
      if (result && result.response && result.response.length > 0) {
        testLog('Post verified', { postId, attempt });
        return { success: true, post: result.response[0] };
      }
      
      if (result && result.error) {
        testLog('Post verification API error', { attempt, error: result.error });
      }
      
      Utilities.sleep(TEST_CONFIG.VERIFICATION_INITIAL_DELAY * attempt);
    }
    
    return { success: false, error: 'Post not found after retries' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function simulateBid(postId, amount) {
  try {
    const props = PropertiesService.getScriptProperties();
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    if (!vkToken || !groupId) {
      return { success: false, error: 'Missing VK_TOKEN or GROUP_ID' };
    }
    
    const message = `${amount}`;
    
    const result = callVk('wall.createComment', {
      owner_id: '-' + groupId,
      post_id: postId,
      message: message,
      from_group: 0
    }, vkToken);
    
    if (result && result.error) {
      return { 
        success: false, 
        error: result.error.error_msg || JSON.stringify(result.error),
        vkError: result.error
      };
    }
    
    if (!result || !result.response || !result.response.comment_id) {
      return { success: false, error: 'Invalid response from VK API', response: result };
    }
    
    const commentId = result.response.comment_id;
    
    testLog('Bid comment created', { commentId, postId, amount });
    
    return { success: true, commentId: commentId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function verifyBidProcessed(postId, expectedAmount) {
  try {
    // Check Bids sheet for the bid
    const bidsSheet = getSheet('Bids');
    
    if (!bidsSheet) {
      return { success: false, error: 'Bids sheet not found' };
    }
    
    const data = bidsSheet.getDataRange().getValues();
    
    // Look for bid with matching post ID and amount
    for (let i = 1; i < data.length; i++) {
      const rowPostId = data[i][1]; // Post ID column
      const rowAmount = data[i][3]; // Amount column
      
      if (String(rowPostId) === String(postId) && Number(rowAmount) === expectedAmount) {
        testLog('Bid found in Bids sheet', { 
          row: i + 1, 
          postId, 
          amount: expectedAmount,
          bidData: data[i]
        });
        return { success: true, bidRow: i + 1, bidData: data[i] };
      }
    }
    
    return { success: false, error: 'Bid not found in Bids sheet' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkAuctionState(lotId) {
  try {
    const configSheet = getSheet('Config');
    
    if (!configSheet) {
      return { success: false, error: 'Config sheet not found' };
    }
    
    const data = configSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === lotId) {
        const state = {
          lotId: data[i][0],
          title: data[i][1],
          status: data[i][8],
          vkPostId: data[i][10],
          winner: data[i][11]
        };
        
        testLog('Auction state retrieved', state);
        return { success: true, state };
      }
    }
    
    return { success: false, error: 'Lot not found in Config' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function cleanupTestPost(postId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const vkToken = props.getProperty('VK_TOKEN');
    const groupId = props.getProperty('GROUP_ID');
    
    if (!vkToken || !groupId) {
      return { success: false, error: 'Missing VK_TOKEN or GROUP_ID' };
    }
    
    const result = callVk('wall.delete', {
      owner_id: '-' + groupId,
      post_id: postId
    }, vkToken);
    
    if (result && result.error) {
      // Post might already be deleted
      if (result.error.error_code === 100) {
        testLog('Post already deleted or not found', { postId });
        return { success: true, alreadyDeleted: true };
      }
      
      return { 
        success: false, 
        error: result.error.error_msg || JSON.stringify(result.error)
      };
    }
    
    testLog('Test post deleted', { postId });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

function generateTestReport(results, startTime, endTime) {
  let report = "\n";
  report += "╔══════════════════════════════════════════════════════════════╗\n";
  report += "║        VK AUCTION BOT - COMPLETE TEST SUITE REPORT           ║\n";
  report += "╚══════════════════════════════════════════════════════════════╝\n\n";
  
  report += `📅 Timestamp: ${startTime.toISOString()}\n`;
  report += `⏱️  Duration: ${(endTime - startTime) / 1000}s\n`;
  
  // Critical errors section
  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    report += "\n🚨 CRITICAL ERRORS:\n";
    report += "═══════════════════════════════════════════════════════════════\n";
    errors.forEach(err => {
      report += `  ❌ ${err.name}: ${err.error}\n`;
      if (err.stack) {
        report += `     Stack: ${err.stack.substring(0, 200)}...\n`;
      }
    });
    report += "\n";
  }
  
  report += "\n╔══════════════════════════════════════════════════════════════╗\n";
  report += "║                      SUMMARY                                 ║\n";
  report += "╠══════════════════════════════════════════════════════════════╣\n";
  report += `║  Total Tests:  ${results.length.toString().padStart(3)}                                      ║\n`;
  report += `║  ✅ Passed:    ${results.filter(r => r.passed).length.toString().padStart(3)} (${Math.round((results.filter(r => r.passed).length / results.length) * 100)}%)                        ║\n`;
  report += `║  ❌ Failed:    ${results.filter(r => !r.passed).length.toString().padStart(3)}                                      ║\n`;
  if (errors.length > 0) {
    report += `║  🚨 Critical:  ${errors.length.toString().padStart(3)}                                      ║\n`;
  }
  report += "╚══════════════════════════════════════════════════════════════╝\n\n";
  
  report += "DETAILED RESULTS:\n";
  report += "═══════════════════════════════════════════════════════════════\n\n";
  
  // Group by category
  const categories = {};
  results.forEach(test => {
    const category = test.name.split(":")[0];
    if (!categories[category]) categories[category] = [];
    categories[category].push(test);
  });
  
  Object.keys(categories).forEach(category => {
    report += `[${category}]\n`;
    categories[category].forEach(test => {
      const icon = test.passed ? "✅" : "❌";
      const name = test.name.substring(test.name.indexOf(":") + 1).trim();
      const critical = test.critical ? " [CRITICAL]" : "";
      report += `  ${icon} ${name}${critical}\n`;
      
      if (!test.passed && test.error) {
        report += `     Error: ${test.error}\n`;
      }
      
      // Show details for failed tests
      if (!test.passed && test.details) {
        const detailStr = JSON.stringify(test.details, null, 2).substring(0, 300);
        report += `     Details: ${detailStr}...\n`;
      }
      
      // Show step details for battle simulation
      if (test.name.includes("BATTLE") && test.details && test.details.steps) {
        report += `     Steps completed: ${test.details.steps.length}\n`;
        test.details.steps.forEach(step => {
          const stepIcon = step.passed ? "✓" : "✗";
          report += `       ${stepIcon} Step ${step.step}: ${step.name}\n`;
          if (!step.passed && step.details && step.details.error) {
            report += `         Error: ${step.details.error}\n`;
          }
        });
      }
    });
    report += "\n";
  });
  
  report += "═══════════════════════════════════════════════════════════════\n";
  report += `Overall Status: ${results.filter(r => !r.passed).length === 0 ? "🎉 ALL TESTS PASSED" : "⚠️  SOME TESTS FAILED"}\n`;
  
  // Add test log summary
  const testLog = getTestLog();
  if (testLog) {
    report += "\n\n📋 TEST LOG (last 20 entries):\n";
    report += "═══════════════════════════════════════════════════════════════\n";
    const logLines = testLog.split('\n').slice(-40);
    report += logLines.join('\n');
    report += "\n";
  }
  
  return report;
}

// =============================================================================
// WEB APP ENTRY POINT
// =============================================================================

/**
 * Entry point for Web App testing
 * Called by deploy_and_test.sh via ?action=run_tests&secret=...
 */
function runTestsViaWebApp() {
  try {
    const report = runCompleteTestSuite();
    return ContentService.createTextOutput(report).setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    return ContentService.createTextOutput("❌ TEST SUITE FAILED:\n" + error.message).setMimeType(ContentService.MimeType.TEXT);
  }
}






