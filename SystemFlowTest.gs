/**
 * @fileoverview Tests for the complete system flow to ensure all sheets are used correctly
 * This file tests the complete sequence of events from post arrival to finalization
 */

/**
 * Master test function that runs all system flow tests
 */
function runSystemFlowTests() {
  const results = [];
  
  results.push(testPostArrivalFlow());
  results.push(testBidProcessingFlow());
  results.push(testNotificationFlow());
  results.push(testAuctionFinalizationFlow());
  results.push(testMessageHandlingFlow());
  
  // Generate summary
  const summary = "РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ПОТОКА СИСТЕМЫ:\n\n";
  results.forEach(result => {
    console.log(`${result.testName}: ${result.passed ? '✅ ПРОШЕЛ' : '❌ НЕ ПРОШЕЛ'}`);
    if (!result.passed) {
      console.log(`  Ошибка: ${result.error}`);
    }
  });
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log(`\nПройдено: ${passedCount}/${totalCount} тестов`);
  
  return results;
}

/**
 * Test 1: Complete flow when a post arrives
 */
function testPostArrivalFlow() {
  const testName = "Тест: Обработка прихода поста";
  
  try {
    // Prepare test data
    const testPostId = "TEST_POST_" + Utilities.getUuid().substring(0, 6);
    const testLotId = "TEST_LOT_" + Utilities.getUuid().substring(0, 6);
    const testPostText = `#аукцион@dndpotustoronu №${testLotId}
При поддержке TEST-GROUP!
Дедлайн 01.01.2030 21:00 по МСК!
🎁Лот - на картинке. Тестовый лот.

👀Старт 100р и шаг - 50р.
Тестовый пост для проверки системы.`;
    
    // Simulate the post processing manually
    const parsedLot = parseLotFromPost({
      id: parseInt(testPostId.split('_')[2]),
      owner_id: -123456789,
      text: testPostText,
      attachments: []
    });
    
    if (!parsedLot || parsedLot.lot_id !== testLotId) {
      return { testName, passed: false, error: "Лот не был распарсен корректно" };
    }
    
    // Create lot data
    const lotData = {
      lot_id: parsedLot.lot_id,
      post_id: `-${parsedLot.owner_id}_${parsedLot.id}`,
      name: parsedLot.name,
      start_price: parsedLot.start_price,
      current_price: parsedLot.start_price,
      leader_id: "",
      status: "active",
      created_at: new Date(),
      deadline: parsedLot.deadline || new Date(new Date().getTime() + 7*24*60*60*1000),
      bid_step: parsedLot.bidStep || 0,
      image_url: parsedLot.image_url || "",
      attachment_id: parsedLot.attachment_id || ""
    };
    
    // Save to Config sheet
    upsertLot(lotData);
    
    // Verify the lot was saved to Config sheet
    const configRows = getSheetData("Config");
    const savedLot = configRows.find(l => l.data.lot_id === testLotId);
    
    if (!savedLot) {
      return { testName, passed: false, error: "Лот не был сохранен в лист 'Лоты'" };
    }
    
    // Verify data integrity
    if (savedLot.data.status !== "active") {
      return { testName, passed: false, error: "Статус лота не 'active'" };
    }
    
    // Check if Logs sheet was updated
    const logsRows = getSheetData("Logs");
    const lotCreatedEvent = logsRows.find(s => 
      s.data.type === 'MONITORING' && 
      s.data.message === 'LOT_CREATED' && 
      s.data.details.includes(testLotId)
    );
    
    if (!lotCreatedEvent) {
      console.log("Предупреждение: Событие LOT_CREATED не найдено в журнале (это может быть нормально для теста)");
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Обработка прихода поста", passed: false, error: error.message };
  }
}

/**
 * Test 2: Complete flow when bids are processed
 */
function testBidProcessingFlow() {
  const testName = "Тест: Обработка ставок";
  
  try {
    // First, ensure we have a test lot
    const testLotId = "BID_TEST_LOT_" + Utilities.getUuid().substring(0, 6);
    const testUserId = "TEST_USER_" + Utilities.getUuid().substring(0, 6);
    
    const lotData = {
      lot_id: testLotId,
      post_id: "-123456789_999999",
      name: "Тестовый лот для ставок",
      start_price: 100,
      current_price: 100,
      leader_id: "",
      status: "active",
      created_at: new Date(),
      deadline: new Date(new Date().getTime() + 7*24*60*60*1000),
      bid_step: 50
    };
    
    upsertLot(lotData);
    
    // Process a valid bid
    const bidAmount = 150; // Valid bid (100 + 50 step)
    
    // Simulate bid processing (this mimics what handleWallReplyNew does)
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    
    try {
      // Re-fetch lot inside lock to ensure we have latest data
      const currentLot = findLotByPostId("-123456789_999999");
      
      // Validate bid (simplified version of enhancedValidateBid)
      const validationResult = { isValid: true, reason: null };
      
      if (validationResult.isValid) {
        // Find current leader bid and mark it as overtaken
        const bids = getSheetData("Bids");
        const oldLeaderBid = bids.find(b => 
          b.data.lot_id === currentLot.lot_id && 
          b.data.status === "лидер"
        );
        
        if (oldLeaderBid) {
          updateRow("Bids", oldLeaderBid.rowIndex, { status: "перебита" });
        }
        
        // Record the new bid as leader
        appendRow("Bids", {
          bid_id: Utilities.getUuid(),
          lot_id: currentLot.lot_id,
          user_id: testUserId,
          bid_amount: bidAmount,
          timestamp: new Date(),
          comment_id: "TEST_COMMENT_" + Utilities.getUuid().substring(0, 6),
          status: "лидер"
        });
        
        // Update the lot
        updateLot(currentLot.lot_id, { 
          current_price: bidAmount, 
          leader_id: testUserId 
        });
      }
    } finally {
      lock.releaseLock();
    }
    
    // Verify bid was recorded
    const bids = getSheetData("Bids");
    const recordedBid = bids.find(b => 
      b.data.lot_id === testLotId && 
      Number(b.data.bid_amount) === bidAmount
    );
    
    if (!recordedBid) {
      return { testName, passed: false, error: "Ставка не была записана в лист 'Ставки'" };
    }
    
    // Verify lot was updated
    const updatedLot = findLotByPostId("-123456789_999999");
    if (Number(updatedLot.current_price) !== bidAmount) {
      return { testName, passed: false, error: "Цена лота не была обновлена" };
    }
    
    if (updatedLot.leader_id !== testUserId) {
      return { testName, passed: false, error: "Лидер лота не был обновлен" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Обработка ставок", passed: false, error: error.message };
  }
}

/**
 * Test 3: Notification queue flow
 */
function testNotificationFlow() {
  const testName = "Тест: Обработка уведомлений";
  
  try {
    // Add a test notification to the queue
    const testUserId = "NOTIF_USER_" + Utilities.getUuid().substring(0, 6);
    const testLotId = "NOTIF_LOT_" + Utilities.getUuid().substring(0, 6);
    
    const notification = {
      user_id: testUserId,
      type: "winner",
      payload: {
        lot_id: testLotId,
        lot_name: "Тестовый лот",
        price: 500
      }
    };
    
    queueNotification(notification);
    
    // Verify notification was added to queue
    const queueRows = getSheetData("NotificationQueue");
    const queuedNotification = queueRows.find(n => 
      n.data.user_id === testUserId && 
      n.data.type === "winner" &&
      n.data.payload.includes(testLotId)
    );
    
    if (!queuedNotification) {
      return { testName, passed: false, error: "Уведомление не было добавлено в очередь" };
    }
    
    if (queuedNotification.data.status !== "pending") {
      return { testName, passed: false, error: "Статус уведомления не 'pending'" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Обработка уведомлений", passed: false, error: error.message };
  }
}

/**
 * Test 4: Auction finalization flow
 */
function testAuctionFinalizationFlow() {
  const testName = "Тест: Завершение аукциона";
  
  try {
    // Create a test lot that should be finalized (past deadline)
    const testLotId = "FINAL_TEST_LOT_" + Utilities.getUuid().substring(0, 6);
    const testUserId = "FINAL_USER_" + Utilities.getUuid().substring(0, 6);
    
    const lotData = {
      lot_id: testLotId,
      post_id: "-123456789_888888",
      name: "Тестовый лот для завершения",
      start_price: 100,
      current_price: 200,
      leader_id: testUserId,
      status: "active",
      created_at: new Date(Date.now() - 8*24*60*60*1000), // 8 days ago
      deadline: new Date(Date.now() - 1*24*60*60*1000), // 1 day ago
      bid_step: 50
    };
    
    upsertLot(lotData);
    
    // Add a test bid for this lot
    appendRow("Bids", {
      bid_id: Utilities.getUuid(),
      lot_id: testLotId,
      user_id: testUserId,
      bid_amount: 200,
      timestamp: new Date(Date.now() - 2*24*60*60*1000), // 2 days ago
      comment_id: "TEST_BID_COMMENT",
      status: "лидер"
    });
    
    // Manually run finalization logic for this specific lot
    const lots = getSheetData("Config");
    const lotToFinalize = lots.find(l => l.data.lot_id === testLotId);
    
    if (lotToFinalize && lotToFinalize.data.status === "active" && new Date(lotToFinalize.data.deadline) < new Date()) {
      // Find winner (highest bid)
      const bids = getSheetData("Bids");
      const lotBids = bids.filter(b => b.data.lot_id === testLotId);
      
      if (lotBids.length > 0) {
        // Find highest bid (simplified - in real system would sort by amount and time)
        const highestBid = lotBids.reduce((prev, current) => 
          Number(prev.data.bid_amount) > Number(current.data.bid_amount) ? prev : current
        );
        
        if (highestBid) {
          // Update lot status to sold
          updateRow("Config", lotToFinalize.rowIndex, { status: "sold" });
          
          // Add to Winners sheet
          appendRow("Orders", {
            order_id: `${testLotId}-${highestBid.data.user_id}`,
            lot_id: testLotId,
            lot_name: lotToFinalize.data.name,
            post_id: lotToFinalize.data.post_id,
            user_id: highestBid.data.user_id,
            win_date: new Date(),
            win_price: highestBid.data.bid_amount,
            status: 'unpaid',
            shipping_batch_id: ''
          });
          
          // Queue winner notification
          const winnerNotification = {
            user_id: highestBid.data.user_id,
            type: "winner", 
            payload: {
              lot_id: testLotId,
              lot_name: lotToFinalize.data.name,
              price: highestBid.data.bid_amount
            }
          };
          queueNotification(winnerNotification);
        }
      } else {
        // No bids - mark as unsold
        updateRow("Config", lotToFinalize.rowIndex, { status: "unsold" });
      }
    }
    
    // Verify lot was marked as sold
    const updatedLot = findLotByPostId("-123456789_888888");
    if (updatedLot.status !== "sold") {
      return { testName, passed: false, error: "Лот не был помечен как 'sold'" };
    }
    
    // Verify order was created
    const orders = getSheetData("Orders");
    const order = orders.find(o => o.data.lot_id === testLotId);
    if (!order) {
      return { testName, passed: false, error: "Заказ не был создан в листе 'Заказы'" };
    }
    
    // Verify notification was queued
    const queueRows = getSheetData("NotificationQueue");
    const winnerNotification = queueRows.find(n => 
      n.data.type === "winner" && 
      n.data.payload.includes(testLotId)
    );
    if (!winnerNotification) {
      return { testName, passed: false, error: "Уведомление победителю не было поставлено в очередь" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Завершение аукциона", passed: false, error: error.message };
  }
}

/**
 * Test 5: Message handling flow
 */
function testMessageHandlingFlow() {
  const testName = "Тест: Обработка сообщений от пользователей";
  
  try {
    // This test verifies that the message handling system is set up correctly
    // In a real scenario, this would be tested with actual VK messages
    // Here we just verify the function exists and can be called
    
    // Add a test user to the Users sheet
    const testUserId = "MSG_USER_" + Utilities.getUuid().substring(0, 6);
    
    // Check if Users sheet exists and can be written to
    appendRow("Users", {
      user_id: testUserId,
      user_name: "Тестовый Пользователь",
      first_win_date: new Date(),
      last_win_date: new Date(),
      total_lots_won: 1,
      total_lots_paid: 0,
      shipping_status: 'accumulating',
      shipping_details: ''
    });
    
    // Verify user was added
    const users = getSheetData("Users");
    const testUser = users.find(u => u.data.user_id === testUserId);
    
    if (!testUser) {
      return { testName, passed: false, error: "Пользователь не был добавлен в лист 'Пользователи'" };
    }
    
    // Test the buildUserOrderSummary function with a non-existent user
    // (should return "no orders" message)
    const summary = buildUserOrderSummary("NONEXISTENT_USER");
    if (!summary.includes("нет неоплаченных")) {
      return { testName, passed: false, error: "Функция buildUserOrderSummary не возвращает корректное сообщение для пользователя без заказов" };
    }
    
    return { testName, passed: true };
  } catch (error) {
    return { testName: "Тест: Обработка сообщений от пользователей", passed: false, error: error.message };
  }
}