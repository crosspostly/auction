
/**
 * Diagnostic tools for verifying the project health.
 */

function debugProject() {
  Logger.log("--- Starting Debug ---");
  
  // 1. Check Triggers
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log("Active Triggers: " + triggers.length);
  triggers.forEach(t => Logger.log(` - ${t.getHandlerFunction()} (${t.getEventType()})`));
  
  if (triggers.length === 0) {
    Logger.log("⚠️ NO TRIGGERS FOUND! Run 'setupTriggers' immediately.");
  }

  // 2. Check EventQueue
  const events = getSheetData("EventQueue");
  const pending = events.filter(e => e.data.status === 'pending');
  Logger.log(`Pending Events: ${pending.length}`);
  
  // 3. Test VK Connection
  try {
    const groupId = getVkGroupId();
    if (!groupId) {
      Logger.log("⚠️ GROUP_ID is missing in Properties!");
    } else {
      const group = callVk('groups.getById', { group_id: groupId });
      Logger.log("VK Group Check: " + (group && group.response ? "OK" : "FAILED"));
      if (group && group.error) Logger.log("VK Error: " + group.error.error_msg);
    }
  } catch (e) {
    Logger.log("VK Check Error: " + e.message);
  }
  
  // 4. Test Settings
  try {
    const token = getSetting('VK_TOKEN');
    Logger.log("VK Token Present: " + (!!token));
  } catch (e) {
    Logger.log("Settings Check Error: " + e.message);
  }
  
  Logger.log("--- End Debug ---");
  return "Debug Complete. Check Logs.";
}

/**
 * MOCK TEST: Диагностика доступа к листам и данным.
 * Запустите эту функцию, чтобы понять, видит ли скрипт данные на самом деле.
 */
function runMockTest() {
  Logger.log("🕵️‍♂️ START MOCK TEST");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets();
  
  Logger.log(`📚 Всего листов в таблице: ${allSheets.length}`);
  allSheets.forEach(s => Logger.log(` - "${s.getName()}" (Rows: ${s.getLastRow()})`));
  
  // 1. Проверяем конфиг
  const configName = SHEETS["EventQueue"].name;
  Logger.log(`\n📋 Ищем лист по конфигу: "${configName}"`);
  
  const sheet = ss.getSheetByName(configName);
  if (!sheet) {
    Logger.log("❌ ОШИБКА: Скрипт НЕ НАХОДИТ лист с таким именем! Возможно, есть лишние пробелы или разница в регистре.");
    return;
  }
  Logger.log("✅ Лист найден.");
  
  // 2. Проверяем заголовки
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    Logger.log("⚠️ Лист пуст.");
    return;
  }
  
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  Logger.log(`headers found: ${JSON.stringify(headers)}`);
  
  const statusIndex = headers.indexOf("status");
  
  if (statusIndex === -1) {
    Logger.log("❌ ОШИБКА: Не найден столбец 'status'!");
    return;
  }
  
  // 3. Проверяем данные (первые 5 строк)
  Logger.log(`\n🔍 Анализ первых 5 строк данных (Всего строк: ${values.length}):`);
  
  let pendingCount = 0;
  
  // Пропускаем заголовок (i=1)
  for (let i = 1; i < Math.min(values.length, 6); i++) {
    const row = values[i];
    const statusRaw = row[statusIndex];
    const statusClean = String(statusRaw || "").toLowerCase().trim();
    
    Logger.log(`Row ${i+1}: Status raw='${statusRaw}' -> clean='${statusClean}'`);
    
    if (statusClean === 'pending') {
      pendingCount++;
      Logger.log(`   ✅ Эту строку скрипт ДОЛЖЕН обработать.`);
    } else {
      Logger.log(`   🚫 Эту строку скрипт пропустит.`);
    }
  }
  
  Logger.log(`\n📊 ИТОГ ТЕСТА: Найдено кандидатов на обработку в первых строках: ${pendingCount}`);
  
  if (pendingCount > 0) {
    Logger.log("Вывод: Скрипт ВИДИТ данные. Проблема была в триггерах или лимитах.");
  } else {
    Logger.log("Вывод: Скрипт НЕ ВИДИТ данные 'pending'. Проверьте точное написание статуса в таблице.");
  }
}

function forceRun() {
  Logger.log("Forcing Process Event Queue (with retries)...");
  for (let i = 0; i < 3; i++) {
    processEventQueue();
    if (i < 2) Utilities.sleep(2000 * (i + 1));
  }
  Logger.log("Forcing Process Notification Queue...");
  processNotificationQueue();
  Logger.log("Done.");
}

/**
 * Принудительно очищает всю очередь, пока в ней не останется событий.
 * Полезно, если накопился большой затор.
 */
function forceClearAllQueues() {
  Logger.log("🚀 Запуск ТУРБО-ОЧИСТКИ...");
  
  let totalProcessed = 0;
  let hasMore = true;
  
  while (hasMore && totalProcessed < 200) {
    const events = getSheetData("EventQueue");
    const pending = events.filter(e => String(e.data.status).toLowerCase().trim() === 'pending');
    
    if (pending.length === 0) {
      hasMore = false;
      break;
    }
    
    Logger.log(`Разгребаем пачку... Осталось: ${pending.length}`);
    processEventQueue();
    totalProcessed += 10;
    Utilities.sleep(10000); 
  }
  
  processNotificationQueue();
  Logger.log(`✅ Турбо-очистка завершена. Обработано событий: ~${totalProcessed}`);
}

function resetAndRestart() {
  setupTriggers();
  resetSimulationCounter();
  Logger.log("Triggers reset and simulation counter cleared.");
}

/**
 * Диагностика: Проверка обоих токенов и их прав.
 */
function identifyTokenOwner() {
  Logger.log("--- TOKEN DIAGNOSTIC ---");
  const props = PropertiesService.getScriptProperties();
  const userToken = props.getProperty('USER_TOKEN');
  const groupToken = props.getProperty('VK_TOKEN');
  const groupId = getVkGroupId();
  
  if (!userToken && !groupToken) {
    Logger.log("❌ No tokens found in Properties.");
    return;
  }

  // 1. Проверяем ADMIN TOKEN (USER)
  if (userToken) {
    Logger.log("--- Checking ADMIN (USER) TOKEN ---");
    const userRes = callVk('users.get', {}, userToken);
    if (userRes && userRes.response && userRes.response[0]) {
      const user = userRes.response[0];
      Logger.log(`👤 Owner: ${user.first_name} ${user.last_name} (ID: ${user.id})`);
      
      // Проверка роли
      const managers = callVk('groups.getMembers', { group_id: groupId, filter: 'managers' }, userToken);
      if (managers?.response) {
        const me = managers.response.items.find(m => m.id == user.id);
        Logger.log(me ? `✅ Role in group: ${me.role}` : "❌ Not a manager of this group!");
      }
    } else {
      Logger.log("❌ Admin Token is invalid or expired.");
    }
  }

  // 2. Проверяем GROUP TOKEN
  if (groupToken) {
    Logger.log("\n--- Checking GROUP TOKEN ---");
    const groupRes = callVk('groups.getById', { group_id: groupId }, groupToken);
    if (groupRes && groupRes.response && groupRes.response.groups) {
      Logger.log(`🏢 Valid for group: ${groupRes.response.groups[0].name}`);
      
      // Проверка прав на сообщения
      const longPoll = callVk('groups.getLongPollServer', { group_id: groupId }, groupToken);
      Logger.log(longPoll?.response ? "✅ Can access group API" : "⚠️ Limited API access (normal for group tokens)");
    } else {
      Logger.log("❌ Group Token is invalid or has wrong Group ID.");
    }
  }
  
  Logger.log("--- END DIAGNOSTIC ---");
}

/**
 * Комплексный тест прав: создает, комментирует и удаляет.
 */
function testFullPermissions() {
  Logger.log("--- START FULL PERMISSIONS TEST ---");
  const props = PropertiesService.getScriptProperties();
  const userToken = props.getProperty('USER_TOKEN');
  const groupToken = props.getProperty('VK_TOKEN');
  const groupId = getVkGroupId();

  if (!userToken || !groupToken) {
    Logger.log("❌ Need BOTH tokens for this test.");
    return;
  }

  // 1. Пост от имени ГРУППЫ (через Group Token)
  Logger.log("1. Posting from Group...");
  const postRes = callVk('wall.post', { owner_id: `-${groupId}`, from_group: 1, message: "Test Post (delete me)" }, groupToken);
  
  if (postRes?.response?.post_id) {
    const pid = postRes.response.post_id;
    Logger.log("✅ Post OK.");

    // 2. Коммент от имени ГРУППЫ (через Group Token)
    Logger.log("2. Commenting as Group...");
    const commRes = callVk('wall.createComment', { owner_id: `-${groupId}`, post_id: pid, from_group: 1, message: "Group Comment" }, groupToken);
    Logger.log(commRes?.response ? "✅ Comment OK." : "❌ Comment FAILED.");

    // 3. Коммент от имени ЮЗЕРА (через User Token)
    Logger.log("3. Commenting as User...");
    const userCommRes = callVk('wall.createComment', { owner_id: `-${groupId}`, post_id: pid, from_group: 0, message: "User Comment" }, userToken);
    Logger.log(userCommRes?.response ? "✅ User Comment OK." : "❌ User Comment FAILED.");

    // 4. Удаление поста (через User Token)
    Logger.log("4. Deleting post via Admin...");
    const delRes = callVk('wall.delete', { owner_id: `-${groupId}`, post_id: pid }, userToken);
    Logger.log(delRes?.response ? "✅ Cleanup OK." : "❌ Cleanup FAILED.");
  } else {
    Logger.log("❌ Initial post failed: " + JSON.stringify(postRes));
  }
  Logger.log("--- END TEST ---");
}

/**
 * TEST: Проверка прав токена на публикацию комментариев от имени пользователя.
 * Создает тестовый пост на стене группы, затем пытается оставить к нему комментарий с from_group=0.
 * Результат пишется в лог.
 */
function testVkCommentPermission() {
  Logger.log("--- START VK COMMENT PERMISSION TEST ---");
  
  const token = getSetting('VK_TOKEN');
  const groupId = getVkGroupId();
  
  if (!token || !groupId) {
    Logger.log("❌ ERROR: VK_TOKEN or GROUP_ID is missing.");
    return;
  }
  
  Logger.log(`Using Group ID: ${groupId}`);
  
  // 1. Create a test post
  Logger.log("1. Creating test post...");
  const postRes = callVk('wall.post', {
    owner_id: `-${groupId}`,
    from_group: 1,
    message: "#test_permission Checking comment permissions..."
  }, token);
  
  if (!postRes || !postRes.response || !postRes.response.post_id) {
    Logger.log("❌ FAILED to create post: " + (postRes?.error?.error_msg || JSON.stringify(postRes)));
    return;
  }
  
  const postId = postRes.response.post_id;
  Logger.log(`✅ Post created. ID: ${postId}`);
  
  // Wait a bit
  Utilities.sleep(2000);
  
  // 2. Try to comment as USER (from_group=0) using the SAME token
  Logger.log("2. Attempting to comment as USER (from_group=0)...");
  const commentRes = callVk('wall.createComment', {
    owner_id: `-${groupId}`,
    post_id: postId,
    from_group: 0, // This is the key parameter we are testing
    message: "Test comment from user (from_group=0)"
  }, token);
  
  if (commentRes && commentRes.response && commentRes.response.comment_id) {
    Logger.log(`✅ SUCCESS! Comment as USER created. ID: ${commentRes.response.comment_id}`);
    Logger.log("🎉 CONCLUSION: The VK_TOKEN HAS permissions to post comments as a user.");
  } else {
    const errorMsg = commentRes?.error?.error_msg || "Unknown error";
    const errorCode = commentRes?.error?.error_code || "?";
    Logger.log(`❌ FAILED to create comment as USER.`);
    Logger.log(`Error Code: ${errorCode}`);
    Logger.log(`Error Msg: ${errorMsg}`);
  }

  // 2.1 Try to comment as GROUP (from_group=1)
  Logger.log("2.1 Attempting to comment as GROUP (from_group=1)...");
  const groupCommentRes = callVk('wall.createComment', {
    owner_id: `-${groupId}`,
    post_id: postId,
    from_group: 1, 
    message: "Test comment from GROUP (from_group=1)"
  }, token);

  if (groupCommentRes && groupCommentRes.response && groupCommentRes.response.comment_id) {
    Logger.log(`✅ SUCCESS! Comment as GROUP created. ID: ${groupCommentRes.response.comment_id}`);
  } else {
    const errorMsg = groupCommentRes?.error?.error_msg || "Unknown error";
    Logger.log(`❌ FAILED to create comment as GROUP: ${errorMsg}`);
  }
  
  // 3. Cleanup (Delete the post)
  Logger.log("3. Cleaning up (deleting post)...");
  Utilities.sleep(2000);
  callVk('wall.delete', {
    owner_id: `-${groupId}`,
    post_id: postId
  }, token);
  Logger.log("--- END TEST ---");
}

/**
 * ПРОВЕРКА: Доходят ли запросы от VK вообще?
 */
function checkIncomingEvents() {
  try {
    const data = getSheetData("Incoming");
    
    if (data.length === 0) {
      Logger.log('❌ НЕТ ВХОДЯЩИХ СОБЫТИЙ!');
      Logger.log('Это означает, что VK вообще не отправляет запросы на ваш URL.');
      return;
    }
    
    Logger.log(`✅ Найдено ${data.length} входящих событий`);
    
    Logger.log('Последние 5:');
    data.slice(-5).reverse().forEach(row => {
      Logger.log(`[${row.data.date}] ${row.data.type} | ${String(row.data.payload).substring(0, 100)}`);
    });
  } catch (e) {
    Logger.log('❌ Ошибка при проверке событий: ' + e.message);
  }
}

/**
 * Проверка URL веб-приложения
 */
function checkDeploymentUrl() {
  const props = PropertiesService.getScriptProperties();
  const savedUrl = props.getProperty('WEB_APP_URL');
  
  Logger.log('=== ПРОВЕРКА URL ===');
  Logger.log('URL в настройках скрипта:');
  Logger.log(savedUrl || '❌ НЕ УКАЗАН');
  Logger.log('\nДля получения URL: Deploy -> New deployment -> Web app (Everyone).');
}

/**
 * Ручной тест doPost (симуляция входящего события)
 */
function testDoPostManually() {
  const gid = getVkGroupId();
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        type: 'wall_post_new',
        object: {
          id: Math.floor(Math.random() * 100000),
          owner_id: -Number(gid),
          text: '#аукцион\nЛот: Тестовый предмет\n№DEBUG' + Math.floor(Math.random() * 100) + '\nСтарт 500р',
          date: Math.floor(Date.now() / 1000),
          attachments: []
        },
        group_id: Number(gid)
      })
    },
    parameter: {}
  };
  
  Logger.log('📤 Отправляем тестовый запрос в doPost...');
  const response = doPost(fakeEvent);
  Logger.log('📥 Ответ: ' + response.getContent());
  Logger.log('\nПроверьте лист "Лоты" - должен появиться новый лот.');
}
