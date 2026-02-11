/**
 * @fileoverview Consolidated integration tests for the VK Auction Bot.
 * This file includes both component-level integration tests and full end-to-end workflow tests.
 */

// =================================================================
// MASTER TEST RUNNER
// =================================================================

/**
 * Main test suite function that runs all integration tests.
 * This should be the primary entry point for manual test execution.
 */
function runAllIntegrationTests() {
  const ui = SpreadsheetApp.getUi();
  const allResults = [];
  let summary = "РЕЗУЛЬТАТЫ ВСЕХ ИНТЕГРАЦИОННЫХ ТЕСТОВ:

";

  // --- Run Component Tests ---
  summary += "--- Запуск компонентных тестов ---
";
  const componentResults = runComponentTests();
  allResults.push(...componentResults);
  componentResults.forEach(result => {
    summary += `${result.testName}: ${result.passed ? '✅' : '❌'}
`;
  });

  // --- Run End-to-End Workflow Tests ---
  summary += "
--- Запуск сквозного теста жизненного цикла ---
";
  const workflowResults = testCompleteAuctionWorkflow();
  allResults.push(...workflowResults);
   workflowResults.forEach(result => {
    summary += `${result.testName}: ${result.passed ? '✅' : '❌'}
`;
  });
  
  // --- Run Standalone Tests ---
  summary += "
--- Запуск теста очереди событий ---
";
  const eventQueueResult = testEventQueueProcessing();
  allResults.push(eventQueueResult);
  summary += `${eventQueueResult.testName}: ${eventQueueResult.passed ? '✅' : '❌'}
`;


  // --- Generate Final Summary ---
  const passedCount = allResults.filter(r => r && r.passed).length;
  const failedCount = allResults.filter(r => r && !r.passed).length;

  let finalSummary = `РЕЗУЛЬТАТЫ ВСЕХ ИНТЕГРАЦИОННЫХ ТЕСТОВ:

`;
  finalSummary += `Всего тестов запущено: ${allResults.length}
`;
  finalSummary += `✅ Пройдено: ${passedCount}
`;
  finalSummary += `❌ Провалено: ${failedCount}

`;

  finalSummary += "--- ДЕТАЛИ ---
";
  allResults.forEach(result => {
    if (result) {
      finalSummary += `${result.testName}: ${result.passed ? '✅ ПРОШЕЛ' : '❌ НЕ ПРОШЕЛ'}
`;
      if (!result.passed) {
        finalSummary += `  -> Ошибка: ${result.error}
`;
      }
    }
  });

  ui.alert(finalSummary);
  Logger.log(finalSummary);
}


// =================================================================
// TEST SUITES
// =================================================================

/**
 * Runner for component-level integration tests.
 */
function runComponentTests() {
  const results = [];
  results.push(testLotCreation());
  results.push(testBidProcessing());
  results.push(testBidValidation());
  results.push(testAuctionFinalization());
  results.push(testNotificationSystem());
  results.push(testAuctionExtension());
  return results;
}

/**
 * Test the complete auction workflow from lot creation to finalization
 */
function testCompleteAuctionWorkflow() {
  const results = [];
  
  try {
    results.push(createAndTestLot());
    results.push(processMultipleBids());
    results.push(testBidValidations());
    results.push(finalizeAndCheckWinners());
  } catch (error) {
    Logger.log(`Ошибка в полном тесте аукциона: ${error.message}`);
  }
  
  return results;
}


// =================================================================
// COMPONENT INTEGRATION TESTS (from former Tests.gs)
// =================================================================

/**
 * Test 1: Lot Creation and Parsing
 */
function testLotCreation() {
  try {
    const testName = "Компонент: Создание лота";
    
    // Create a test lot post text
    const testPostText = `#аукцион@dndpotustoronu №TEST123
При поддержке TEST-GROUP!
Дедлайн 31.12.2026 в 21:00 по МСК!
🎁Тестовый лот для проверки системы.

👀Старт 100р и шаг - 50р.
Тестовое описание лота.`;
    
    // Parse the lot
    const parsedLot = parseLotFromPost(testPostText);
    
    if (!parsedLot) {
      return { testName, passed: false, error: "Не удалось распарсить лот" };
    }
    
    if (parsedLot.lot_id !== "TEST123") {
      return { testName, passed: false, error: `Неверный ID лота: ${parsedLot.lot_id}` };
    }
    
    if (parsedLot.start_price !== 100) {
      return { testName, passed: false, error: `Неверная стартовая цена: ${parsedLot.start_price}` };
    }
    
    if (parsedLot.bidStep !== 50) {
      return { testName, passed: false, error: `Неверный шаг ставки: ${parsedLot.bidStep}` };
    }
    
    const testLotData = { 
      lot_id: "TEST123", 
      post_id: "test_owner_test_post", 
      name: parsedLot.name, 
      start_price: parsedLot.start_price, 
      current_price: parsedLot.start_price, 
      leader_id: "", 
      status: "active", 
      created_at: new Date(), 
      deadline: parsedLot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000), 
      bid_step: parsedLot.bidStep || 0 
    };
    upsertLot(testLotData);
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Создание лота", passed: false, error: error.message };
  }
}

/**
 * Test 2: Bid Processing and Validation
 */
function testBidProcessing() {
  try {
    const testName = "Компонент: Обработка ставок";
    
    const testLotData = { 
      lot_id: "BID_TEST", 
      post_id: "-123_456", 
      name: "Тестовый лот для ставок", 
      start_price: 100, 
      current_price: 100, 
      leader_id: "", 
      status: "active", 
      created_at: new Date(), 
      deadline: new Date(new Date().getTime() + 1*24*60*60*1000),
      bid_step: 50 
    };
    upsertLot(testLotData);
    
    const bidPayload = {
      type: "wall_reply_new",
      object: {
        id: 777,
        from_id: 12345,
        date: Date.now()/1000,
        text: "150",
        post_id: 456,
        post_owner_id: -123
      },
      group_id: 123
    };
    
    handleWallReplyNew(bidPayload);
    
    const bids = getSheetData("Bids");
    const testBid = bids.find(b => b.data.lot_id === "BID_TEST" && Number(b.data.bid_amount) === 150);
    
    if (!testBid) {
      return { testName, passed: false, error: "Ставка не была записана" };
    }
    
    const updatedLot = findLotByPostId("-123_456");
    if (!updatedLot || updatedLot.current_price !== 150 || updatedLot.leader_id !== "12345") {
      return { testName, passed: false, error: "Лот не был обновлен" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Обработка ставок", passed: false, error: error.message };
  }
}

/**
 * Test 3: Bid Validation (Low bid, invalid step, etc.)
 */
function testBidValidation() {
  try {
    const testName = "Компонент: Валидация ставок";
    
    const testLotData = { 
      lot_id: "VALIDATION_TEST", 
      post_id: "-123_457", 
      name: "Тестовый лот для валидации", 
      start_price: 100, 
      current_price: 200,
      leader_id: "54321", 
      status: "active", 
      created_at: new Date(), 
      deadline: new Date(new Date().getTime() + 1*24*60*60*1000),
      bid_step: 50 
    };
    upsertLot(testLotData);
    
    const lowBidPayload = {
      type: "wall_reply_new",
      object: {
        id: 778,
        from_id: 11111,
        date: Date.now()/1000,
        text: "150",
        post_id: 457,
        post_owner_id: -123
      },
      group_id: 123
    };
    
    handleWallReplyNew(lowBidPayload);
    
    const notifications = getSheetData("NotificationQueue");
    const lowBidNotification = notifications.find(n => 
      n.data.user_id === "11111" && n.data.type === "low_bid"
    );
    
    if (!lowBidNotification) {
      return { testName, passed: false, error: "Уведомление о низкой ставке не было отправлено" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Валидация ставок", passed: false, error: error.message };
  }
}

/**
 * Test 4: Auction Finalization and Winner Selection
 */
function testAuctionFinalization() {
  try {
    const testName = "Компонент: Завершение аукциона";
    
    const testLotData = { 
      lot_id: "FINALIZE_TEST", 
      post_id: "-123_458", 
      name: "Тестовый лот для завершения", 
      start_price: 100, 
      current_price: 300, 
      leader_id: "99999", 
      status: "active", 
      created_at: new Date(), 
      deadline: new Date(new Date().getTime() - 1*60*60*1000),
      bid_step: 50 
    };
    upsertLot(testLotData);
    
    finalizeAuction();
    
    const soldLot = findLotByPostId("-123_458");
    if (!soldLot || soldLot.status !== "sold") {
      return { testName, passed: false, error: "Лот не был отмечен как проданный" };
    }
    
    const winners = getSheetData("Winners");
    const testWinner = winners.find(w => w.data.lot_id === "FINALIZE_TEST");
    
    if (!testWinner) {
      return { testName, passed: false, error: "Победитель не был добавлен в 'Победители'" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Завершение аукциона", passed: false, error: error.message };
  }
}

/**
 * Test 5: Notification System
 */
function testNotificationSystem() {
  try {
    const testName = "Компонент: Система уведомлений";
    
    const testNotification = {
      user_id: "12345",
      type: "winner",
      payload: { lot_id: "NOTIF_TEST", lot_name: "Тестовый лот", price: 500 }
    };
    
    queueNotification(testNotification);
    
    const notifications = getSheetData("NotificationQueue");
    const queuedNotification = notifications.find(n => 
      n.data.user_id === "12345" && n.data.type === "winner"
    );
    
    if (!queuedNotification) {
      return { testName, passed: false, error: "Уведомление не было поставлено в очередь" };
    }
    
    processNotificationQueue();
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Система уведомлений", passed: false, error: error.message };
  }
}

/**
 * Test 6: Auction Extension Logic (Anti-sniping)
 */
function testAuctionExtension() {
  try {
    const testName = "Компонент: Продление аукциона";
    
    const now = new Date();
    const deadlineSoon = new Date(now.getTime() + 5 * 60 * 1000);
    const testLotData = { 
      lot_id: "EXTENSION_TEST", 
      post_id: "-123_460", 
      name: "Тестовый лот с продлением", 
      start_price: 100, 
      current_price: 200, 
      leader_id: "54321", 
      status: "active", 
      created_at: new Date(), 
      deadline: deadlineSoon,
      bid_step: 50 
    };
    upsertLot(testLotData);
    
    const extensionBidPayload = {
      type: "wall_reply_new",
      object: {
        id: 780,
        from_id: 33333,
        date: Date.now()/1000,
        text: "250",
        post_id: 460,
        post_owner_id: -123
      },
      group_id: 123
    };
    
    handleWallReplyNew(extensionBidPayload);
    
    const updatedLot = findLotByPostId("-123_460");
    if (!updatedLot) {
      return { testName, passed: false, error: "Лот не найден после ставки" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Компонент: Продление аукциона", passed: false, error: error.message };
  }
}


// =================================================================
// END-TO-END WORKFLOW TESTS (from former AdditionalTests.gs)
// =================================================================

function createAndTestLot() {
  try {
    const testName = "E2E: Создание лота";
    
    const lotPayload = {
      type: "wall_post_new",
      object: {
        id: 99999,
        owner_id: -1234567,
        text: `#аукцион Тестовый лот E2E №E2ELOT001 👀Старт 150р и шаг - 50р. Дедлайн 31.12.2026 в 21:00 по МСК!`,
        date: Math.floor(Date.now() / 1000)
      },
      group_id: 1234567
    };
    
    handleWallPostNew(lotPayload);
    Utilities.sleep(1000);
    
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "E2ELOT001");
    
    if (!testLot || testLot.data.start_price != 150) {
      return { testName, passed: false, error: "Лот не был создан корректно" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "E2E: Создание лота", passed: false, error: error.message };
  }
}

function processMultipleBids() {
  try {
    const testName = "E2E: Обработка ставок";
    
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "E2ELOT001");
    if (!testLot) return { testName, passed: false, error: "Тестовый лот E2E не найден" };
    
    const postId = testLot.data.post_id.split('_')[1];
    
    const bids = [
      { amount: 200, userId: 11111 },
      { amount: 250, userId: 22222 },
      { amount: 350, userId: 44444 }
    ];
    
    for (let i = 0; i < bids.length; i++) {
      const bid = bids[i];
      const bidPayload = {
        type: "wall_reply_new",
        object: {
          id: 1000 + i, from_id: bid.userId, date: Math.floor(Date.now() / 1000) + i,
          text: `${bid.amount}`, post_id: parseInt(postId), post_owner_id: -1234567
        },
        group_id: 1234567
      };
      handleWallReplyNew(bidPayload);
      Utilities.sleep(500);
    }
    
    const updatedLot = findLotByPostId(testLot.data.post_id);
    if (updatedLot.current_price != 350 || updatedLot.leader_id != "44444") {
      return { testName, passed: false, error: `Лот не обновился. Цена: ${updatedLot.current_price}, Лидер: ${updatedLot.leader_id}` };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "E2E: Обработка ставок", passed: false, error: error.message };
  }
}

function testBidValidations() {
  try {
    const testName = "E2E: Валидация ставок";
    
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "E2ELOT001");
    if (!testLot) return { testName, passed: false, error: "Тестовый лот E2E не найден" };

    const postId = testLot.data.post_id.split('_')[1];

    const invalidBidPayload = {
      type: "wall_reply_new",
      object: {
        id: 2000, from_id: 55555, date: Math.floor(Date.now() / 1000),
        text: "300", post_id: parseInt(postId), post_owner_id: -1234567
      },
      group_id: 1234567
    };
    
    handleWallReplyNew(invalidBidPayload);
    
    const notifications = getSheetData("NotificationQueue");
    const lowBidNotif = notifications.some(n => n.data.user_id === "55555" && n.data.type === "low_bid");
    
    if (!lowBidNotif) {
      return { testName, passed: false, error: "Уведомление о низкой ставке не было создано" };
    }
    
    const updatedLot = findLotByPostId(testLot.data.post_id);
    if (updatedLot.current_price != 350) {
      return { testName, passed: false, error: "Цена лота изменилась после невалидной ставки" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "E2E: Валидация ставок", passed: false, error: error.message };
  }
}

function finalizeAndCheckWinners() {
  try {
    const testName = "E2E: Завершение аукциона";
    
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "E2ELOT001");
    if (!testLot) return { testName, passed: false, error: "Тестовый лот E2E не найден" };
    
    updateLot("E2ELOT001", { deadline: new Date(new Date().getTime() - 1000) });
    
    finalizeAuction();
    
    const finalizedLot = findLotByPostId(testLot.data.post_id);
    if (finalizedLot.status !== "sold") {
      return { testName, passed: false, error: `Лот не 'sold', статус: ${finalizedLot.status}` };
    }
    
    const winners = getSheetData("Winners");
    const lotWinner = winners.find(w => w.data.lot_id === "E2ELOT001");
    
    if (!lotWinner || lotWinner.data.winner_id != "44444" || lotWinner.data.price != 350) {
      return { testName, passed: false, error: "Победитель не определен или данные неверны" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "E2E: Завершение аукциона", passed: false, error: error.message };
  }
}

function testEventQueueProcessing() {
  try {
    const testName = "Тест: Обработка очереди событий";
    
    const eventQueueSheet = getSheet("EventQueue");
    eventQueueSheet.clear();
    
    const testEventPayload = JSON.stringify({
      type: "wall_post_new",
      object: {
        id: 88888, owner_id: -1234567,
        text: `#аукцион Тест очереди №QUEUE_TEST_001 👀Старт 100р.`,
        date: Math.floor(Date.now() / 1000)
      },
      group_id: 1234567
    });
    
    appendRow("EventQueue", {
      eventId: Utilities.getUuid(), payload: testEventPayload,
      status: "pending", receivedAt: new Date()
    });
    
    processEventQueue();
    
    const lots = getSheetData("Config");
    const queueTestLot = lots.find(l => l.data.lot_id === "QUEUE_TEST_001");
    
    if (!queueTestLot) {
      return { testName, passed: false, error: "Лот не был создан из события в очереди" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Обработка очереди событий", passed: false, error: error.message };
  }
}
