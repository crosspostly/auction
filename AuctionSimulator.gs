/**
 * @fileoverview This script simulates a VK auction to generate test data and events.
 * It posts real lots and comments to a specified VK group.
 */

const SIMULATOR_SETTINGS = {
  // The user token to post comments. IMPORTANT: This user must be a member of the group.
  userToken: "vk1.a.H6v5lstlQKqsJCa1MCSaHPaw4nGVkk9s_3xnDwGNFyIxum45n_uN7vLhPgGThdMegQlhTk2MZBRBY41Fb98x6qrXXntyzduHCI2-PUe3GlMfGLvN8CY5AeJkgv4wXEp252JcmzeuoMJ9y57DcDDdf3mdzonQ8nhlQXGRlLKqhl-ancCOBVC1gIP0tGbdFjQICNBb1Zqwj1on6tH59QIr2A",
  // Maximum number of posts the hourly trigger will create before stopping.
  maxPosts: 5,
  // Number of comments to post for each lot.
  commentsPerLot: { min: 10, max: 30 },
  // Delay between comments in milliseconds.
  commentDelayMs: { min: 2000, max: 10000 },
  // The ID of the user account corresponding to the token above.
  testUserId: "11813721"
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
  const startPrice = 100;
  const postText = `#аукцион
Симуляция. Лот №${lotId}
Старт: ${startPrice}₽
Шаг: 50₽`;
  
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

    postCommentAsUser(postId, String(newBid));
    L('Comment posted.', { scenario: scenario, bid: newBid });
    
    if (newBid > currentBid) {
      currentBid = newBid;
    }
    
    const delay = Math.floor(Math.random() * (SIMULATOR_SETTINGS.commentDelayMs.max - SIMULATOR_SETTINGS.commentDelayMs.min + 1)) + SIMULATOR_SETTINGS.commentDelayMs.min;
    Utilities.sleep(delay);
  }
  
  L('Simulation cycle finished.', { lotId: lotId });
}

function chooseBidScenario(index, currentBid) {
  if (index % 5 === 1) return 'HIGH_FREQUENCY';
  if (index % 5 === 2 && currentBid > 100) return 'LOWER_BID';
  if (index % 5 === 3) return 'SAME_BID';
  if (index % 5 === 4) return 'INVALID_STEP';
  return 'VALID_BID';
}

function postCommentAsUser(postId, text) {
   return callVk('wall.createComment', {
    owner_id: `-${getVkGroupId()}`,
    post_id: postId,
    from_group: 0, // Post as user
    message: text
  }, SIMULATOR_SETTINGS.userToken); // Use the specific user token
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
  SpreadsheetApp.getUi().alert('Ежечасная симуляция включена.');
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
  SpreadsheetApp.getUi().alert('Ежечасная симуляция остановлена.');
}

/**
 * Resets the simulation post counter.
 */
function resetSimulationCounter() {
  PropertiesService.getScriptProperties().deleteProperty('simulationPostCounter');
  Monitoring.recordEvent('SIMULATOR_COUNTER_RESET', {});
  SpreadsheetApp.getUi().alert('Счетчик постов симуляции сброшен.');
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
