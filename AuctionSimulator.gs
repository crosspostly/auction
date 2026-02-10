/**
 * @fileoverview This script simulates a VK auction to generate test data and events.
 * It posts real lots and comments to a specified VK group.
 */

const SIMULATOR_SETTINGS = {
  // Массив тестовых пользователей для симуляции различных ставок.
  // ВНИМАНИЕ: Это заглушки токенов и ID. В реальной работе нужны настоящие.
  testUsers: [
    { id: "11111111", token: "vk1.a.dummy_user_token_1" },
    { id: "22222222", token: "vk1.a.dummy_user_token_2" },
    { id: "33333333", token: "vk1.a.dummy_user_token_3" }
  ],
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
  
  const postResponse = callVk('wall.post', {
    owner_id: `-${getVkGroupId()}`,
    from_group: 1,
    message: postText
  });

  if (!postResponse || !postResponse.response || !postResponse.response.post_id) {
    L('Simulation failed: could not create lot post.', { error: postResponse });
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
    const randomUserIndex = Math.floor(Math.random() * SIMULATOR_SETTINGS.testUsers.length);
    const selectedUser = SIMULATOR_SETTINGS.testUsers[randomUserIndex];
    const userId = selectedUser.id;
    const userToken = selectedUser.token;

    const scenario = chooseBidScenario(i, currentBid);
    let newBid = 0;

    switch(scenario) {
      case 'VALID_BID':
        newBid = currentBid + 50;
        break;
      case 'HIGH_FREQUENCY':
        // Post another comment almost immediately
        const nextBid = currentBid + 100;
        postCommentAsUser(postId, String(nextBid), userToken); // Используем токен выбранного пользователя
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

    postCommentAsUser(postId, String(newBid), userToken); // Используем токен выбранного пользователя
    L('Comment posted.', { scenario: scenario, bid: newBid, userId: userId });
    
    if (scenario === 'VALID_BID' || scenario === 'HIGH_FREQUENCY') {
      currentBid = newBid;
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

function postCommentAsUser(postId, text, token) {
   return callVk('wall.createComment', {
    owner_id: `-${getVkGroupId()}`,
    post_id: postId,
    from_group: 0, // Post as user
    message: text
  }, token); // Use the specific user token
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

// Override callVk to accept a token
function callVk(method, params, token = null) {
  const authToken = token || getSetting('VK_TOKEN');
  // ... (rest of the standard callVk function)
  const cleanParams = { access_token: authToken, v: "5.199", ...params };
  const url = 'https://api.vk.com/method/' + method;
  // ... rest of the function ...
  const options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.keys(cleanParams).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(cleanParams[k])}`).join('&'),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const body = response.getContentText();
  return JSON.parse(body);
}
