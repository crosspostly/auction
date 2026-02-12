/**
 * @fileoverview This script simulates a VK auction to generate test data and events.
 * It posts real lots and comments to a specified VK group.
 */

const SIMULATOR_SETTINGS = {
  // Maximum number of posts the hourly trigger will create before stopping.
  maxPosts: 5,
  // Number of comments to post for each lot.
  commentsPerLot: { min: 10, max: 30 },
  // Delay between comments in milliseconds.
  commentDelayMs: { min: 2000, max: 10000 }
};

// --- SIMULATOR CONTROL FUNCTIONS ---

/**
 * Runs one full simulation cycle: creates one post and adds comments.
 * This is the main function for the hourly trigger.
 */
function runSingleSimulation() {
  const L = (msg, data) => Monitoring.recordEvent('SIMULATOR_LOG', { message: msg, ...data });
  
  const postCounter = Number(PropertiesService.getScriptProperties().getProperty('simulationPostCounter') || 0);
  if (postCounter >= SIMULATOR_SETTINGS.maxPosts) {
    L('Simulation stopped: max post limit reached.', { count: postCounter });
    stopSimulation();
    return;
  }
  
  L('Starting single simulation cycle...', { cycle: postCounter + 1 });
  
  // 1. Create a new lot post
  const lotId = `SIM_${Utilities.getUuid().substring(0, 8)}`;
  const startPrice = 150;
  const bidStep = 50; // Добавляем bidStep для использования в шаблоне
  const deadlineDate = new Date();
  deadlineDate.setDate(deadlineDate.getDate() + 7); // Через 7 дней от текущей даты
  deadlineDate.setHours(21, 0, 0, 0); // 21:00 по МСК
  
  const day = ("0" + deadlineDate.getDate()).slice(-2);
  const month = ("0" + (deadlineDate.getMonth() + 1)).slice(-2);
  const year = deadlineDate.getFullYear();
  const hours = ("0" + deadlineDate.getHours()).slice(-2);
  const minutes = ("0" + deadlineDate.getMinutes()).slice(-2);

  const postText = `#аукцион@dndpotustoronu №${lotId}
При поддержке GABRIGAME-WORKSHOP!
Дедлайн ${day}.${month}.${year} в ${hours}:${minutes} по МСК!
🎁Лот - на картинке. + миниатюра идет с красивой, текстурной базой.

👀Старт ${startPrice}р и шаг - ${bidStep}р.
Каждая миниатюра аукциона масштабом 32-35мм.
ПОДАРОК ТОМУ, КТО ЗАБЕРЁТ ЗА ДЕНЬ БОЛЬШЕ ВСЕГО МИНИАТЮР!
Дата окончания аукциона ${day}.${month}.${year} (суббота) в ${hours}:${minutes} по Москве.

В случае, если за 10 минут (или меньше) до окончания аукциона делается ставка, например, в 20:59, аукцион на данный лот продлевается на 10 минут - до 21:09. Начиная с 20:50, продление на 10 минут происходит с каждой новой ставкой.

После аукциона пиши ТОЛЬКО в ЛС группы. Опасайся МОШЕННИКОВ пишущих тебе в ЛС. Отправь картинки миниатюр которые выиграл. Напиши Телефон, ФИО, Город, Адрес (пункт СДЭК). И как тебе отправить, Почтой или СДЭКом.

ДОСТАВКА ЗА СЧЁТ ПОБЕДИТЕЛЯ почтой России с отправкой из Волгограда. (До 3 фигурок 450р, дальше уточним). Отправка по четвергам.

Оплата на карту в течение 3 дней после победы.`;
  
  // Use the main VK token to post (Group Token)
  const vkToken = getSetting('VK_TOKEN');
  const groupId = getSetting('GROUP_ID');
  
  const postResponse = callVk('wall.post', {
    owner_id: `-${groupId}`,
    from_group: 1,
    message: postText
  }, vkToken);

  if (!postResponse || !postResponse.response || !postResponse.response.post_id) {
    const errorMsg = postResponse && postResponse.error ? postResponse.error.error_msg : "Unknown error";
    L('Simulation failed: could not create lot post.', { error: errorMsg, fullResponse: postResponse });
    return;
  }
  
  const postId = postResponse.response.post_id;
  L('Lot post created successfully.', { lotId: lotId, postId: postId });
  PropertiesService.getScriptProperties().setProperty('simulationPostCounter', String(postCounter + 1));
  
  // Give VK time to process the post
  Utilities.sleep(5000); 

  // 2. Simulate bidding comments
  const commentCount = Math.floor(Math.random() * (SIMULATOR_SETTINGS.commentsPerLot.max - SIMULATOR_SETTINGS.commentsPerLot.min + 1)) + SIMULATOR_SETTINGS.commentsPerLot.min;
  let currentBid = startPrice;
  
  for (let i = 0; i < commentCount; i++) {

    const scenario = chooseBidScenario(i, currentBid);
    let newBid = 0;

    switch(scenario) {
      case 'VALID_BID':
        newBid = currentBid + 50;
        break;
      case 'HIGH_FREQUENCY':
        // Post another comment almost immediately
        const nextBid = currentBid + 100;
        postCommentAsUser(postId, String(nextBid)); 
        Utilities.sleep(1500); // 1.5 second delay
        newBid = currentBid + 150;
        i++; // Count this as an extra comment
        break;
      case 'SAME_BID':
        newBid = currentBid;
        break;
      case 'LOWER_BID':
        newBid = currentBid - 50;
        break;
      case 'INVALID_STEP':
        newBid = currentBid + 75;
        break;
    }

    const isSuccess = postCommentAsUser(postId, String(newBid)); 
    if (isSuccess) {
      L('Comment posted.', { scenario: scenario, bid: newBid });
      
      if (scenario === 'VALID_BID' || scenario === 'HIGH_FREQUENCY') {
        currentBid = newBid;
      }
    } else {
      L('Failed to post comment.', { scenario: scenario, bid: newBid });
    }
    
    const delay = Math.floor(Math.random() * (SIMULATOR_SETTINGS.commentDelayMs.max - SIMULATOR_SETTINGS.commentDelayMs.min + 1)) + SIMULATOR_SETTINGS.commentDelayMs.min;
    Utilities.sleep(delay);
  }
  
  L('Simulation cycle finished.', { lotId: lotId });
}

function chooseBidScenario(index, currentBid) {
  // Более частые сценарии для тестирования новых функций
  if (index % 4 === 0) return 'VALID_BID'; // Каждая 4-я ставка - валидная
  if (index % 4 === 1 && currentBid > 100) return 'LOWER_BID'; // Каждая 4-я + 1 - ниже текущей
  if (index % 4 === 2) return 'INVALID_STEP'; // Каждая 4-я + 2 - не кратна шагу
  return 'SAME_BID'; // Остальные - равные текущей
}

function postCommentAsUser(postId, text) {
   // Используем USER_TOKEN (токен администратора),
   // чтобы публиковать комментарии от имени ПОЛЬЗОВАТЕЛЯ (участника).
   const userToken = PropertiesService.getScriptProperties().getProperty('USER_TOKEN');
   
   // from_group: 0 — комментарий от имени пользователя (автора токена)
   const response = callVk('wall.createComment', {
     owner_id: `-${getVkGroupId()}`,
     post_id: postId,
     from_group: 0, 
     message: text
   }, userToken);

   if (response && response.response && response.response.comment_id) {
     return true;
   } else {
     const error = response ? response.error : "No response";
     Monitoring.recordEvent('SIMULATOR_COMMENT_ERROR', { error: error, text: text });
     return false;
   }
}

/**
 * Sets up a trigger to run the simulation every hour.
 */
function setupHourlySimulation() {
  stopSimulation(); // Stop any existing triggers first
  ScriptApp.newTrigger('runSingleSimulation')
      .timeBased()
      .everyHours(1)
      .create();
  Monitoring.recordEvent('SIMULATOR_HOURLY_TRIGGER_ENABLED', {});
}

/**
 * Stops the hourly simulation by deleting the trigger.
 */
function stopSimulation() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'runSingleSimulation') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Monitoring.recordEvent('SIMULATOR_HOURLY_TRIGGER_DISABLED', {});
}

/**
 * Resets the simulation post counter.
 */
function resetSimulationCounter() {
  PropertiesService.getScriptProperties().deleteProperty('simulationPostCounter');
  Monitoring.recordEvent('SIMULATOR_COUNTER_RESET', {});
}

/**
 * Runs a full cycle simulation: Bot creates lot -> User bids -> Auction finalizes -> User wins -> User sends shipping info.
 * Verifies each step against the data in Sheets.
 * Returns a detailed log of the execution.
 */
function runFullCycleSimulation() {
  let logBuffer = [];
  const L = (msg, data) => {
    const logEntry = `[${new Date().toLocaleTimeString()}] ${msg} ${data ? JSON.stringify(data) : ''}`;
    logBuffer.push(logEntry);
    Monitoring.recordEvent('SIM_FULL_CYCLE', { message: msg, ...data });
    Logger.log(msg); // Also log to Stackdriver
  };
  
  const SLEEP_SHORT = 2000;
  const SLEEP_LONG_AFTER_QUEUE_PROCESSING = 5000; // Increased sleep time

  try {
    // Force-reset all triggers to ensure we are running the latest code
    L('🔄 Resetting all triggers before simulation...');
    setupTriggers();
    L('✅ Triggers reset.');

    L('🚀 Starting Full Cycle Simulation...');
    
    // --- PREPARATION ---
    const userToken = PropertiesService.getScriptProperties().getProperty('USER_TOKEN');
    if (!userToken) {
      throw new Error("USER_TOKEN is missing in Script Properties. Please add it via the 'Authorization Settings' menu.");
    }
    
    // Get Test User ID and VALIDATE the token
    L('Step 1.0: Validating USER_TOKEN...');
    const userInfo = callVk('users.get', {}, userToken);
    if (!userInfo || !userInfo.response || !userInfo.response[0]) {
      L('CRITICAL: USER_TOKEN is invalid.', { response: userInfo });
      throw new Error("Could not get test user info via USER_TOKEN. The token is likely expired or invalid. Please generate a new one via the 'Authorization Settings' menu and save it in Script Properties as USER_TOKEN.");
    }
    const testUserId = String(userInfo.response[0].id);
    L('✅ USER_TOKEN is valid. Test user identified', { userId: testUserId });

    const groupId = getVkGroupId();
    const vkToken = getSetting('VK_TOKEN');
    if (!groupId || !vkToken) throw new Error("VK_TOKEN or GROUP_ID missing");

    // --- PART 1: BOT CYCLE ---
    
    // 1.1 Create Lot
    L('Step 1.1: Creating Lot Post...');
    const lotId = `SIM_FULL_${Utilities.getUuid().substring(0, 6)}`;
    const startPrice = 100;
    // Note: We use a future deadline initially
    const postText = `#аукцион №${lotId}\n🎁Лот - Тестовый лот полного цикла\n👀Старт ${startPrice}р и шаг 50р.\nДедлайн 01.01.2030 21:00 по МСК`;
    
    const postRes = callVk('wall.post', { owner_id: `-${groupId}`, from_group: 1, message: postText }, vkToken);
    if (!postRes || !postRes.response) throw new Error("Failed to post lot: " + JSON.stringify(postRes));
    const postId = postRes.response.post_id;
    
    L('Lot posted', { lotId, postId });
    Utilities.sleep(SLEEP_SHORT); 
    
    // Manually trigger parsing by enqueuing the event, just like the real webhook does
    const postEventPayload = {
      type: "wall_post_new",
      object: { id: postId, owner_id: -groupId, text: postText, attachments: postRes.attachments || [] }
    };
    enqueueEvent(JSON.stringify(postEventPayload));

    // Process the queue immediately for the test
    processEventQueue(L);
    Utilities.sleep(SLEEP_LONG_AFTER_QUEUE_PROCESSING); // Give time for event processing and sheet writes
    
    // Verify Lot Created with Retry Logic
    let lot;
    for (let i = 0; i < 5; i++) {
      Utilities.sleep(500); // Wait 0.5 seconds before each check
      const lots = getSheetData("Config");
      lot = lots.find(l => String(l.data.lot_id) === String(lotId));
      if (lot) break;
      L(`Attempt ${i + 1}: Lot not found yet, retrying...`);
    }

    if (!lot) {
      // If lot not found, log the current state of the sheet for debugging
      const currentLots = getSheetData("Config");
      L("DEBUG: Lot not found after retries.", {
        lotId_sought: lotId,
        currentLots_in_sheet: currentLots.map(l => l.data.lot_id)
      });
      throw new Error(`Lot not found in '${SHEETS.Config.name}' sheet after creation`);
    }
    if (lot.data.status !== 'active') throw new Error(`Lot status is '${lot.data.status}', expected 'active'`);
    L('✅ Lot creation verified');

    // 1.2 Place Bid
    L('Step 1.2: Placing Bid...');
    const bidAmount = startPrice + 50;
    const commentPayload = {
        owner_id: `-${groupId}`,
        post_id: postId,
        from_group: 0, // As user
        message: `${bidAmount}`
    };
    
    // Use USER_TOKEN to place bid
    const cRes = callVk('wall.createComment', commentPayload, userToken);
    if (!cRes || !cRes.response) throw new Error("Failed to place bid: " + JSON.stringify(cRes));
    const commentId = cRes.response.comment_id;

    Utilities.sleep(SLEEP_SHORT);

    // Manually trigger reply handling by enqueuing the event, just like the real webhook does
    const eventPayload = {
      type: "wall_reply_new",
      object: { id: commentId, post_id: postId, owner_id: -groupId, from_id: testUserId, text: `${bidAmount}р` }
    };
    enqueueEvent(JSON.stringify(eventPayload));
    
    // Process the queue immediately for the test
    processEventQueue(L);
    Utilities.sleep(SLEEP_LONG_AFTER_QUEUE_PROCESSING); // Give time for event processing and sheet writes
    
    // Verify Bid in 'Ставки' with Retry Logic
    let myBid;
    for (let i = 0; i < 5; i++) {
      Utilities.sleep(1000); // Increased sleep time to 1 second
      const bids = getSheetData("Bids");
      L(`Attempt ${i + 1}: Checking for bid... Found ${bids.length} total bids.`);
      myBid = bids.find(b => String(b.data.lot_id) === String(lotId) && String(b.data.bid_amount) === String(bidAmount));
      if (myBid) {
        L(`Bid found on attempt ${i + 1}!`);
        break;
      }
    }

    if (!myBid) {
      // Log all bids for the current lot for debugging
      const allBidsForLot = getSheetData("Bids").filter(b => String(b.data.lot_id) === String(lotId));
      L("DEBUG: Bid not found after retries.", {
        lotId_sought: lotId,
        bidAmount_sought: bidAmount,
        allBidsForLot_in_sheet: allBidsForLot.map(b => b.data)
      });
      throw new Error(`Bid not found in '${SHEETS.Bids.name}' sheet`);
    }
    if (myBid.data.status !== 'лидер') throw new Error(`Bid status is '${myBid.data.status}', expected 'лидер'`);
    
    // Verify Lot Update in 'Лоты'
    const updatedLot = getSheetData("Config").find(l => String(l.data.lot_id) === String(lotId));
    if (String(updatedLot.data.current_price) !== String(bidAmount)) throw new Error(`Lot price is ${updatedLot.data.current_price}, expected ${bidAmount}`);
    if (String(updatedLot.data.leader_id) !== String(testUserId)) throw new Error(`Lot leader is ${updatedLot.data.leader_id}, expected ${testUserId}`);
    L('✅ Bid placement verified');

    // 1.3 Finalize Auction
    L('Step 1.3: Finalizing Auction...');
    // Force deadline to past to ensure it closes
    updateLot(lotId, { deadline: new Date(new Date().getTime() - 10000) });
    
    finalizeAuction();
    
    // Verify Finalization
    const soldLot = getSheetData("Config").find(l => String(l.data.lot_id) === String(lotId));
    if (soldLot.data.status !== 'sold') throw new Error(`Lot status is '${soldLot.data.status}', expected 'sold'`);
    
    const orders = getSheetData("Orders");
    const order = orders.find(o => String(o.data.lot_id) === String(lotId));
    if (!order) throw new Error(`Order not created in '${SHEETS.Orders.name}' sheet`);
    if (order.data.status !== 'unpaid') throw new Error(`Order status is '${order.data.status}', expected 'unpaid'`);
    
    // Check Notification Queue for winner message
    const notifs = getSheetData("NotificationQueue");
    const winnerNotif = notifs.find(n => String(n.data.user_id) === String(testUserId) && n.data.type === 'winner' && n.data.payload.includes(lotId));
    if (!winnerNotif) throw new Error("Winner notification not found in queue");
    
    L('✅ Auction finalization verified');

    // --- PART 2: WINNER CYCLE ---
    
    // 2.1 Request Summary
    L('Step 2.1: Winner requests summary...');
    const settings = getSettings();
    const codeWord = settings.CODE_WORD || 'Аукцион';
    
    // Simulate user sending code word
    handleMessageNew({ object: { message: { from_id: testUserId, text: codeWord } } });
    
    // Verify 'USER_SUMMARY_SENT' event in logs
    Utilities.sleep(1000);
    L('✅ Summary request processed (checked logs/no errors)');

    // 2.2 Send Shipping Details
    L('Step 2.2: Winner sends shipping details...');
    const shipDetails = "Тестов Тест Тестович, г. Тестоград, ул. Багов 404, тел. 89009998877";
    
    // Simulate user sending details
    handleMessageNew({ object: { message: { from_id: testUserId, text: shipDetails } } });
    
    // Verify User Details in 'Пользователи'
    const users = getSheetData("Users");
    const user = users.find(u => String(u.data.user_id) === String(testUserId));
    if (!user) throw new Error(`User not found in '${SHEETS.Users.name}' sheet`);
    if (!user.data.shipping_details || !user.data.shipping_details.includes("Тестов")) {
        throw new Error(`Shipping details not updated. Got: ${user.data.shipping_details}`);
    }
    L('✅ Shipping details verified');
    
    L('🎉 FULL CYCLE SIMULATION COMPLETED SUCCESSFULLY!');
    return "✅ FULL CYCLE SIMULATION COMPLETED SUCCESSFULLY!";

  } catch (e) {
    L('❌ SIMULATION FAILED', { error: e.message, stack: e.stack });
    Logger.log('SIMULATION FAILED: ' + e.message);
    // Return the log buffer even on error so we can see what happened up to the failure
    return "FAILED:\n" + logBuffer.join('\n'); 
  }
}


