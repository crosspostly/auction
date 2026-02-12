// =====================================
// VK API INTEGRATION - MERGED VERSION
// =====================================

const API_VERSION = '5.199';
const CACHE_TTL_SECONDS = 21600;

const VK_EVENTS = {
  wall_post_new: 1, wall_reply_new: 1, wall_reply_edit: 1, wall_reply_delete: 1,
  message_new: 1, message_reply: 1, photo_new: 1, photo_comment_new: 1,
  video_new: 1, video_comment_new: 1, audio_new: 1, group_join: 1,
  group_leave: 1, user_block: 1, user_unblock: 1, poll_vote_new: 1,
  board_post_new: 1, market_comment_new: 1, group_change_settings: 1,
  group_change_photo: 1, group_officers_edit: 1
};

// ✅ ПРАВИЛЬНАЯ ФУНКЦИЯ VK API С ПОЛНЫМ ЛОГИРОВАНИЕМ И РЕТРАЯМИ
function callVk(method, params, token = null, retryCount = 0) {
  const debugEnabled = getSetting('debug_logging_enabled'); // Использование единой настройки из таблицы
  const debugMode = (debugEnabled === true || debugEnabled === 'ВКЛ');
  const authToken = token || getSetting('VK_TOKEN');

  if (!authToken) {
    logError('callVk', 'VK_TOKEN не задан', method);
    return null;
  }

  // ✅ Создаём чистый объект параметров с приведением к строкам
  const cleanParams = {
    access_token: String(authToken),
    v: String(API_VERSION)
  };

  // ✅ Приводим ВСЕ параметры к строкам
  for (const key in params) {
    if (params[key] !== null && params[key] !== undefined) {
      cleanParams[key] = String(params[key]);
    }
  }

  // ✅ Ручная сборка payload в формате application/x-www-form-urlencoded
  const payload = Object.keys(cleanParams)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(cleanParams[k]))
    .join('&');

  const url = 'https://api.vk.com/method/' + method;

  const options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true
  };

  // 🔍 ЛОГИРОВАНИЕ ЗАПРОСА
  if (debugMode) {
    const sanitizedParams = {};
    for (const key in cleanParams) {
      if (key === 'access_token') {
        sanitizedParams[key] = cleanParams[key].substring(0, 10) + '...[HIDDEN]';
      } else {
        sanitizedParams[key] = cleanParams[key];
      }
    }

    logInfo('🚀 VK API REQUEST', {
      method: method,
      url: url,
      params: sanitizedParams,
      retryCount: retryCount
    });
  }

  try {
    const startTime = new Date().getTime();
    const response = UrlFetchApp.fetch(url, options);
    const responseTime = new Date().getTime() - startTime;
    const statusCode = response.getResponseCode();
    const body = response.getContentText();

    // 🔍 ЛОГИРОВАНИЕ ОТВЕТА
    if (debugMode) {
      logInfo('📥 VK API RESPONSE', {
        method: method,
        status: statusCode,
        responseTime: responseTime + 'ms',
        bodyLength: body.length,
        bodyPreview: body.substring(0, 500)
      });
    }

    const parsed = JSON.parse(body);

    if (parsed.error) {
      const errorCode = parsed.error.error_code;
      
      // Обработка rate limiting и временных ошибок с экспоненциальным ретраем
      if (errorCode === 6 || errorCode === 10 || errorCode === 29 || statusCode === 500 || statusCode === 502 || statusCode === 503) {
        if (retryCount < 3) {
          // Экспоненциальный ретрай: 1с, 2с, 4с
          const waitTime = Math.pow(2, retryCount) * 1000;
          logInfo('⏳ callVk retry', { 
            method: method, 
            retry: retryCount + 1, 
            waitMs: waitTime, 
            errorCode: errorCode,
            errorMessage: parsed.error.error_msg
          });
          Utilities.sleep(waitTime);
          return callVk(method, params, token, retryCount + 1);
        }
      }

      logError('❌ callVk ERROR: ' + method, parsed.error.error_msg || parsed.error, {
        sentParams: Object.keys(params).join(', '),
        error_code: errorCode,
        error_msg: parsed.error.error_msg,
        request_params: parsed.error.request_params || 'none',
        retryCount: retryCount
      });

      return parsed; // Возвращаем с ошибкой для обработки выше
    }

    if (debugMode) {
      logInfo('✅ VK API SUCCESS', {
        method: method,
        hasResponse: !!parsed.response
      });
    }

    return parsed;

  } catch (e) {
    // Обработка сетевых ошибок с экспоненциальным ретраем
    if (retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 1000;
      logInfo('⏳ callVk network retry', { 
        method: method, 
        retry: retryCount + 1, 
        waitMs: waitTime, 
        error: e.message || String(e) 
      });
      Utilities.sleep(waitTime);
      return callVk(method, params, token, retryCount + 1);
    }
    
    logError('❌ callVk EXCEPTION: ' + method, e, {
      message: e.message || String(e),
      stack: e.stack || 'no stack',
      sentParams: params,
      retryCount: retryCount
    });
    return null;
  }
}

function getVkConfirmationCodeFromServer() {
  const groupId = getVkGroupId();
  const res = callVk("groups.getCallbackConfirmationCode", { group_id: groupId }, getVkToken(true));

  // The modified callVk returns the 'response' object directly
  if (res && res.response && res.response.code) {
    const code = String(res.response.code).trim();
    CacheService.getScriptCache().put("CONFIRM_" + groupId, code, 3600); // Cache for 1 hour
    PropertiesService.getScriptProperties().setProperty("CONFIRMATION_CODE", code);
    logInfo('Confirmation code received and saved: ' + code);
    return code;
  }
  logError('getVkConfirmationCode', 'Failed to retrieve confirmation code.', res);
  return null;
}

/**
 * Automatically sets up the callback server on VK.
 * @param {string} url The URL of the web app to register.
 * @returns {object} An object containing the serverId, code, and secret.
 */
function setupCallbackServerAutomatic(url) {
  const groupId = getVkGroupId();
  const props = PropertiesService.getScriptProperties();
  const adminToken = getVkToken(true);

  let secret = props.getProperty("VK_SECRET");
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty("VK_SECRET", secret);
    logInfo('Generated and saved a new VK_SECRET.');
  }

  const code = getVkConfirmationCodeFromServer();
  // Код может не прийти сразу, если сервер ещё не подтвержден, но это не должно блокировать создание записи сервера
  if (!code) logInfo('setupCallbackServer: Confirmation code not received yet, will try during verification.');

  const servers = callVk("groups.getCallbackServers", { group_id: groupId }, adminToken);
  let serverId = null;

  if (servers && servers.response && servers.response.items) {
      const existing = servers.response.items.find(s => s.url === url);
      if (existing) {
          if (existing.status === 'failed') {
              logInfo(`Found existing server with "failed" status (ID: ${existing.id}). Deleting it now...`);
              callVk("groups.deleteCallbackServer", { group_id: groupId, server_id: String(existing.id) }, adminToken);
              logInfo(`Server ID ${existing.id} deleted.`);
              // Server ID is now null, so a new one will be created.
          } else {
              serverId = String(existing.id);
              logInfo('Found existing callback server with "ok" status. ID: ' + serverId);
          }
      }
  } else {
      throw new Error('Не удалось получить список callback серверов от VK.');
  }

  if (!serverId) {
    logInfo('No active server found. Creating a new one...');
    const res = callVk("groups.addCallbackServer", { group_id: groupId, url: String(url), title: "GAS_Auction_Bot", secret_key: secret }, adminToken);
    if (res && res.response && res.response.server_id) {
        serverId = String(res.response.server_id);
        logInfo('Added new callback server with ID: ' + serverId);
    } else {
        throw new Error('Не удалось добавить новый callback сервер в VK. Ответ VK: ' + JSON.stringify(res));
    }
  }

  const eventSettings = { 
    group_id: groupId, 
    server_id: serverId,
    wall_post_new: 1,
    wall_reply_new: 1,
    wall_reply_edit: 1,
    wall_reply_delete: 1,
    message_new: 1
  };

  const setResult = callVk("groups.setCallbackSettings", eventSettings, adminToken);
  if (setResult === 1 || (setResult && setResult.response === 1)) {
      logInfo('Successfully set callback settings for server ID: ' + serverId);
  } else {
      logError('setCallbackSettings', 'Failed to set callback settings.', setResult);
  }

  return { serverId, code, secret };
}

/**
 * ✅ ПРАВИЛЬНАЯ ПРОВЕРКА СОСТОЯНИЯ СОБЫТИЙ
 * Возвращает реальное состояние с сервера VK
 */
function getCallbackEventsStatus(groupId, serverId) {
  const adminToken = getVkToken(true);
  const response = callVk('groups.getCallbackSettings', {
    group_id: groupId,
    server_id: serverId
  }, adminToken);
  
  if (!response) {
    logError('getCallbackEventsStatus', 'Пустой ответ от VK', { groupId, serverId });
    return null;
  }

  // ✅ ИСПРАВЛЕНИЕ: Правильная обработка вложенности
  let settings = response;
  
  if (response.response) {
    settings = response.response;
  }
  
  // В новых версиях API (5.199+) события лежат в поле 'events'
  const eventData = settings.events || settings;
  
  const criticalEvents = ['wall_post_new', 'wall_reply_new', 'wall_reply_edit', 'wall_reply_delete', 'message_new'];

  // ✅ Проверяем, что eventData действительно содержит настройки событий
  const hasEventFields = criticalEvents.some(event => 
    eventData.hasOwnProperty(event)
  );

  if (!hasEventFields) {
    logError('getCallbackEventsStatus', 'В ответе VK нет полей событий', {
      availableKeys: Object.keys(eventData).join(', '),
      rawResponse: JSON.stringify(response).substring(0, 500)
    });
    return null;
  }
  
  // ✅ ЛОГИРОВАНИЕ для отладки
  logInfo('📊 Raw Callback Settings', {
    groupId: groupId,
    serverId: serverId,
    rawSettings: JSON.stringify(eventData).substring(0, 300)
  });
  
  const status = {
    enabled: [],
    disabled: [],
    raw: eventData
  };
  
  criticalEvents.forEach(event => {
    // Проверяем наличие флага именно в данных событий
    if (eventData[event] === 1 || eventData[event] === '1' || eventData[event] === true) {
      status.enabled.push(event);
    } else {
      status.disabled.push(event);
    }
  });
  
  logInfo('✅ Parsed Callback Status', {
    enabled: status.enabled.length,
    disabled: status.disabled.length,
    enabledList: status.enabled.join(', '),
    disabledList: status.disabled.join(', ')
  });
  
  return status;
}

/**
 * ✅ УМНОЕ ВКЛЮЧЕНИЕ СОБЫТИЙ (без дублирования)
 * Включает только те события, которые реально выключены
 */
function enableCallbackEvents(groupId, serverId, eventsToEnable) {
  if (!Array.isArray(eventsToEnable) || eventsToEnable.length === 0) {
    return { success: false, message: 'Пустой список событий' };
  }
  
  // 1. Получаем текущее состояние
  const currentStatus = getCallbackEventsStatus(groupId, serverId);
  
  if (!currentStatus) {
    return { success: false, message: 'Ошибка получения текущего состояния' };
  }
  
  // 2. Фильтруем: включаем только те, что реально выключены
  const reallyDisabled = eventsToEnable.filter(event => 
    !currentStatus.enabled.includes(event)
  );
  
  if (reallyDisabled.length === 0) {
    return { 
      success: true, 
      message: 'Все события уже активны',
      enabled: eventsToEnable
    };
  }
  
  // 3. Подготавливаем payload только для выключенных событий
  const payload = {
    group_id: groupId,
    server_id: serverId
  };
  
  // Включаем ВСЕ запрошенные события (VK позволяет слать все сразу)
  eventsToEnable.forEach(event => {
    payload[event] = '1';
  });
  
  // 4. Отправляем запрос
  const response = callVk('groups.setCallbackSettings', payload, getVkToken(true));
  
  if (response && (response.response === 1 || response === 1)) {
    logInfo('✅ События успешно обновлены', reallyDisabled);
    return { 
      success: true, 
      enabled: eventsToEnable,
      message: `Настройки событий обновлены`
    };
  } else {
    logError('enableCallbackEvents', 'Ошибка VK API', response);
    return { 
      success: false, 
      error: response,
      message: 'Ошибка при сохранении настроек в VK'
    };
  }
}

function sendMessage(userId, message) { 
  const result = callVk("messages.send", { 
    user_id: String(userId), 
    random_id: String(Math.floor(Math.random()*1e9)), 
    message: message, 
    disable_mentions: 1 
  }); 
  
  // Проверяем, была ли ошибка при отправке сообщения
  if (result && result.error) {
    const errorCode = result.error.error_code;
    // Ошибки, связанные с невозможностью отправки сообщения пользователю
    if (errorCode === 901 || errorCode === 902 || errorCode === 936) {
      // 901: Cannot send messages to this user due to privacy settings
      // 902: Cannot send message: user is deactivated
      // 936: Cannot send message to user who added the community to the blacklist
      logInfo('sendMessage_blocked', {
        user_id: userId,
        error_code: errorCode,
        error_msg: result.error.error_msg
      });
    }
  }
  
  return result;
}

function getVkToken(isAdminAction = false) {
  const props = PropertiesService.getScriptProperties();
  if (isAdminAction) {
    return props.getProperty("USER_TOKEN") || props.getProperty("VK_TOKEN");
  }
  return props.getProperty("VK_TOKEN") || "";
}

function getVkGroupId() {
  const gid = PropertiesService.getScriptProperties().getProperty("GROUP_ID");
  return gid ? String(gid).replace("-", "") : "";
}

function postCommentToLot(postId, message) {
  return callVk("wall.createComment", {
    owner_id: "-" + getVkGroupId(),
    post_id: String(postId),
    from_group: 1,
    message: message
  }, getVkToken(false)); // Используем Group Token
}

function replyToComment(postId, commentId, message) {
  return callVk("wall.createComment", {
    owner_id: "-" + getVkGroupId(),
    post_id: String(postId),
    reply_to_comment: String(commentId),
    from_group: 1,
    message: message
  }, getVkToken(false)); // Используем Group Token
}

function getUsersInfo(userIds) {
  return callVk("users.get", {
    user_ids: Array.isArray(userIds) ? userIds.join(",") : String(userIds),
    fields: "first_name,last_name,can_write_private_message"
  });
}

function checkCanWrite(userId) {
  try {
    const u = getUsersInfo(userId);
    return u && u.response && u.response.length > 0 ? u.response[0].can_write_private_message === 1 : false;
  } catch(e) {
    return false;
  }
}

function getUserName(userId) {
  try {
    const u = getUsersInfo(userId);
    return u && u.response && u.response.length > 0 ? `${u.response[0].first_name} ${u.response[0].last_name}` : "Участник";
  } catch(e) {
    return "Участник";
  }
}