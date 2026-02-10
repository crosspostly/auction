/**
 * @fileoverview Additional comprehensive tests for the VK Auction Bot system
 * This file contains more detailed integration tests for the full auction lifecycle
 */

/**
 * Test the complete auction workflow from lot creation to finalization
 */
function testCompleteAuctionWorkflow() {
  const results = [];
  
  try {
    // Test 1: Create a test lot via simulated VK event
    results.push(createAndTestLot());
    
    // Test 2: Process multiple bids
    results.push(processMultipleBids());
    
    // Test 3: Test bid validations
    results.push(testBidValidations());
    
    // Test 4: Finalize auction and check winners
    results.push(finalizeAndCheckWinners());
    
    // Summary
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    
    const ui = SpreadsheetApp.getUi();
    ui.alert(`Полный тест аукциона: ${passedCount}/${totalCount} пройдено`);
    
    Logger.log(`Полный тест аукциона: ${passedCount}/${totalCount} пройдено`);
    results.forEach(r => {
      Logger.log(`${r.testName}: ${r.passed ? 'PASS' : 'FAIL'} - ${r.error || 'OK'}`);
    });
    
  } catch (error) {
    Logger.log(`Ошибка в полном тесте аукциона: ${error.message}`);
    const ui = SpreadsheetApp.getUi();
    ui.alert(`Ошибка в полном тесте аукциона: ${error.message}`);
  }
  
  return results;
}

/**
 * Test 1: Create a lot and verify it's stored correctly
 */
function createAndTestLot() {
  try {
    const testName = "Создание лота";
    
    // Simulate a VK wall_post_new event
    const lotPayload = {
      type: "wall_post_new",
      object: {
        id: 99999,
        owner_id: -1234567,
        text: `#аукцион Тестовый лот для проверки системы
        №TESTLOT001
        👀Старт 150р и шаг - 50р.
        Дедлайн 31.12.2026 в 21:00 по МСК!
        
        Описание тестового лота для проверки системы.`,
        date: Math.floor(Date.now() / 1000)
      },
      group_id: 1234567
    };
    
    // Process the event
    handleWallPostNew(lotPayload);
    
    // Wait a bit for processing
    Utilities.sleep(1000);
    
    // Check if lot was created
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "TESTLOT001");
    
    if (!testLot) {
      return { testName, passed: false, error: "Лот не был создан в таблице" };
    }
    
    if (testLot.data.start_price != 150) {
      return { testName, passed: false, error: `Неверная стартовая цена: ${testLot.data.start_price}` };
    }
    
    if (testLot.data.current_price != 150) {
      return { testName, passed: false, error: `Неверная текущая цена: ${testLot.data.current_price}` };
    }
    
    if (testLot.data.status !== "active") {
      return { testName, passed: false, error: `Неверный статус: ${testLot.data.status}` };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Создание лота", passed: false, error: error.message };
  }
}

/**
 * Test 2: Process multiple bids on the test lot
 */
function processMultipleBids() {
  try {
    const testName = "Обработка ставок";
    
    // Find our test lot
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "TESTLOT001");
    
    if (!testLot) {
      return { testName, passed: false, error: "Тестовый лот не найден" };
    }
    
    const postIdParts = testLot.data.post_id.split('_');
    const postId = postIdParts[postIdParts.length - 1]; // Get the actual post ID
    
    // Simulate multiple bids
    const bids = [
      { amount: 200, userId: 11111 },
      { amount: 250, userId: 22222 },
      { amount: 300, userId: 33333 },
      { amount: 350, userId: 44444 }
    ];
    
    for (let i = 0; i < bids.length; i++) {
      const bid = bids[i];
      
      const bidPayload = {
        type: "wall_reply_new",
        object: {
          id: 1000 + i,
          from_id: bid.userId,
          date: Math.floor(Date.now() / 1000) + i,
          text: `${bid.amount}`,
          post_id: parseInt(postId),
          post_owner_id: -1234567,
          owner_id: -1234567
        },
        group_id: 1234567
      };
      
      // Process the bid
      handleWallReplyNew(bidPayload);
      
      // Small delay between bids
      Utilities.sleep(500);
    }
    
    // Check if all bids were recorded
    const allBids = getSheetData("Bids");
    const lotBids = allBids.filter(b => b.data.lot_id === "TESTLOT001");
    
    if (lotBids.length < bids.length) {
      return { testName, passed: false, error: `Записано ставок: ${lotBids.length}, ожидалось: ${bids.length}` };
    }
    
    // Check if the lot's current price was updated to the highest bid
    const updatedLot = findLotByPostId(testLot.data.post_id);
    if (updatedLot.current_price != 350) {
      return { testName, passed: false, error: `Текущая цена не обновлена: ${updatedLot.current_price}, ожидалось: 350` };
    }
    
    if (updatedLot.leader_id != "44444") {
      return { testName, passed: false, error: `Лидер не обновлен: ${updatedLot.leader_id}, ожидалось: 44444` };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Обработка ставок", passed: false, error: error.message };
  }
}

/**
 * Test 3: Test bid validations (invalid bids)
 */
function testBidValidations() {
  try {
    const testName = "Валидация ставок";
    
    // Find our test lot
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "TESTLOT001");
    
    if (!testLot) {
      return { testName, passed: false, error: "Тестовый лот не найден для валидации" };
    }
    
    const postIdParts = testLot.data.post_id.split('_');
    const postId = postIdParts[postIdParts.length - 1]; // Get the actual post ID
    
    // Test invalid bid (lower than current)
    const invalidBidPayload = {
      type: "wall_reply_new",
      object: {
        id: 2000,
        from_id: 55555,
        date: Math.floor(Date.now() / 1000),
        text: "300", // Less than current 350
        post_id: parseInt(postId),
        post_owner_id: -1234567,
        owner_id: -1234567
      },
      group_id: 1234567
    };
    
    // Process the invalid bid
    handleWallReplyNew(invalidBidPayload);
    
    // Check if a low bid notification was queued
    const notifications = getSheetData("NotificationQueue");
    const lowBidNotif = notifications.some(n => 
      n.data.user_id === "55555" && n.data.type === "low_bid"
    );
    
    if (!lowBidNotif) {
      // Notification might not be queued immediately, let's run the queue processor
      processNotificationQueue();
      const updatedNotifications = getSheetData("NotificationQueue");
      const updatedLowBidNotif = updatedNotifications.some(n => 
        n.data.user_id === "55555" && n.data.type === "low_bid"
      );
      
      if (!updatedLowBidNotif) {
        Logger.log("Notifications in queue:", notifications.map(n => n.data));
        return { testName, passed: false, error: "Уведомление о низкой ставке не было создано" };
      }
    }
    
    // Verify the lot's price hasn't changed
    const updatedLot = findLotByPostId(testLot.data.post_id);
    if (updatedLot.current_price != 350) {
      return { testName, passed: false, error: "Цена лота изменилась несмотря на невалидную ставку" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Валидация ставок", passed: false, error: error.message };
  }
}

/**
 * Test 4: Finalize auction and check winners
 */
function finalizeAndCheckWinners() {
  try {
    const testName = "Завершение аукциона";
    
    // Find our test lot and set its deadline to the past to make it eligible for finalization
    const lots = getSheetData("Config");
    const testLot = lots.find(l => l.data.lot_id === "TESTLOT001");
    
    if (!testLot) {
      return { testName, passed: false, error: "Тестовый лот не найден для финализации" };
    }
    
    // Update the lot to have a past deadline
    updateLot("TESTLOT001", { 
      deadline: new Date(new Date().getTime() - 1000) // 1 second ago
    });
    
    // Run finalization
    finalizeAuction();
    
    // Check if the lot status changed to 'sold'
    const finalizedLot = findLotByPostId(testLot.data.post_id);
    if (finalizedLot.status !== "sold") {
      return { testName, passed: false, error: `Статус лота не изменился на 'sold': ${finalizedLot.status}` };
    }
    
    // Check if winner was added to Winners sheet
    const winners = getSheetData("Winners");
    const lotWinner = winners.find(w => w.data.lot_id === "TESTLOT001");
    
    if (!lotWinner) {
      return { testName, passed: false, error: "Победитель не был добавлен в таблицу Winners" };
    }
    
    if (lotWinner.data.winner_id != "44444") {
      return { testName, passed: false, error: `Неверный победитель: ${lotWinner.data.winner_id}, ожидалось: 44444` };
    }
    
    if (lotWinner.data.price != 350) {
      return { testName, passed: false, error: `Неверная цена победы: ${lotWinner.data.price}, ожидалось: 350` };
    }
    
    // Check if winner notification was queued
    const notifications = getSheetData("NotificationQueue");
    const winnerNotif = notifications.some(n => 
      n.data.user_id === "44444" && n.data.type === "winner"
    );
    
    if (!winnerNotif) {
      // Process queue and check again
      processNotificationQueue();
      const updatedNotifications = getSheetData("NotificationQueue");
      const updatedWinnerNotif = updatedNotifications.some(n => 
        n.data.user_id === "44444" && n.data.type === "winner"
      );
      
      if (!updatedWinnerNotif) {
        return { testName, passed: false, error: "Уведомление победителю не было создано" };
      }
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Завершение аукциона", passed: false, error: error.message };
  }
}

/**
 * Test the event queue processing system
 */
function testEventQueueProcessing() {
  try {
    const testName = "Обработка очереди событий";
    
    // Clear any existing events in queue
    const eventQueueSheet = getSheet("EventQueue");
    eventQueueSheet.clear();
    
    // Add a test event to the queue
    const testEventPayload = JSON.stringify({
      type: "wall_post_new",
      object: {
        id: 88888,
        owner_id: -1234567,
        text: `#аукцион Тест очереди событий
        №QUEUE_TEST_001
        👀Старт 100р.
        Дедлайн 31.12.2026 в 21:00 по МСК!`,
        date: Math.floor(Date.now() / 1000)
      },
      group_id: 1234567
    });
    
    appendRow("EventQueue", {
      eventId: Utilities.getUuid(),
      payload: testEventPayload,
      status: "pending",
      receivedAt: new Date()
    });
    
    // Process the event queue
    processEventQueue();
    
    // Check if the event was processed (status changed from pending)
    const events = getSheetData("EventQueue");
    const processedEvent = events.find(e => e.data.payload.includes("QUEUE_TEST_001"));
    
    if (!processedEvent) {
      return { testName, passed: false, error: "Событие не было найдено в очереди" };
    }
    
    // Check if a lot was created from the event
    const lots = getSheetData("Config");
    const queueTestLot = lots.find(l => l.data.lot_id === "QUEUE_TEST_001");
    
    if (!queueTestLot) {
      return { testName, passed: false, error: "Лот не был создан из события в очереди" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Обработка очереди событий", passed: false, error: error.message };
  }
}

/**
 * Run all integration tests
 */
function runIntegrationTests() {
  const results = [];
  
  results.push(testEventQueueProcessing());
  results.push(testCompleteAuctionWorkflow());
  
  // Summary
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  
  const ui = SpreadsheetApp.getUi();
  ui.alert(`Интеграционные тесты: ${passedCount}/${totalCount} пройдено`);
  
  Logger.log(`Интеграционные тесты: ${passedCount}/${totalCount} пройдено`);
  results.forEach(r => {
    Logger.log(`${r.testName}: ${r.passed ? 'PASS' : 'FAIL'} - ${r.error || 'OK'}`);
  });
  
  return results;
}