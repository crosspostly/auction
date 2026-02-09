const VK_API_VERSION = "5.199";

const VK_EVENTS = {
  wall_post_new: 1, wall_reply_new: 1, wall_reply_edit: 1, wall_reply_delete: 1,
  message_new: 1, message_reply: 1, photo_new: 1, photo_comment_new: 1,
  video_new: 1, video_comment_new: 1, audio_new: 1, group_join: 1,
  group_leave: 1, user_block: 1, user_unblock: 1, poll_vote_new: 1,
  board_post_new: 1, market_comment_new: 1, group_change_settings: 1,
  group_change_photo: 1, group_officers_edit: 1
};

function getVkToken() { return PropertiesService.getScriptProperties().getProperty("VK_TOKEN") || ""; }
function getVkGroupId() { return String(PropertiesService.getScriptProperties().getProperty("GROUP_ID") || "").replace("-", ""); }

function callVk(method, params, retryCount = 0) {

  const settings = getSettings();

  const debugMode = settings['DEBUG_VK_API'] === true;

  const token = settings['VK_TOKEN'];



  if (!token) {

    logError('callVk', 'VK_TOKEN не задан', method);

    throw new Error('VK_TOKEN не настроен. Пожалуйста, укажите его в Настройках.');

  }



  const cleanParams = { access_token: token, v: VK_API_VERSION };

  for (const key in params) {

    if (params[key] !== null && params[key] !== undefined) cleanParams[key] = String(params[key]);

  }



  const url = 'https://api.vk.com/method/' + method;

  const options = {

    method: 'post',

    contentType: 'application/x-www-form-urlencoded',

    payload: Object.keys(cleanParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(cleanParams[k])).join('&'),

    muteHttpExceptions: true

  };



  if (debugMode) {

    const sanitizedPayload = { ...cleanParams };

    if (sanitizedPayload.access_token) sanitizedPayload.access_token = sanitizedPayload.access_token.substring(0, 10) + '...[HIDDEN]';

    logInfo('🚀 VK API REQUEST', { method: method, url: url, payload: sanitizedPayload });

  }



  try {

    const response = UrlFetchApp.fetch(url, options);

    const statusCode = response.getResponseCode();

    const body = response.getContentText();



    if (debugMode) {

      logInfo('📥 VK API RESPONSE', { method: method, statusCode: statusCode, responseBody: body.substring(0, 2000) });

    }



    const parsed = JSON.parse(body);



    if (parsed.error) {

      // Retry logic for "Too many requests per second" or "Internal server error"

      if ((parsed.error.error_code === 6 || parsed.error.error_code === 10) && retryCount < 3) {

        const waitTime = Math.pow(2, retryCount) * 1000;

        Utilities.sleep(waitTime);

        return callVk(method, params, retryCount + 1);

      }

      logError('callVk_API_Error', parsed.error.error_msg, { method: method, errorCode: parsed.error.error_code, params: params });

      return parsed; // Return the error object

    }

        return parsed; // Return the full parsed object

    

      } catch (e) {

        logError('callVk_Exception', e.message, { method: method, params: params, stack: e.stack });

        if (retryCount < 3) {

      Utilities.sleep(Math.pow(2, retryCount) * 1000);

      return callVk(method, params, retryCount + 1);

    }

    throw new Error('Не удалось выполнить запрос к VK API после нескольких попыток: ' + e.message);

  }

}



/**

 * Gets the confirmation code from the VK server and stores it.

 * @returns {string|null} The confirmation code or null on failure.

 */

function getVkConfirmationCodeFromServer() {

  const groupId = getVkGroupId();

  const res = callVk("groups.getCallbackConfirmationCode", { group_id: groupId });

  // The modified callVk returns the 'response' object directly

  if (res && res.code) {

    const code = String(res.code).trim();

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

  

  let secret = props.getProperty("VK_SECRET");

  if (!secret) {

    secret = Utilities.getUuid();

    props.setProperty("VK_SECRET", secret);

    logInfo('Generated and saved a new VK_SECRET.');

  }



  const code = getVkConfirmationCodeFromServer();

  if (!code) throw new Error("Не удалось получить код подтверждения от VK.");



  const servers = callVk("groups.getCallbackServers", { group_id: groupId });

  let serverId = null;

  

  if (servers && servers.items) {

      const existing = servers.items.find(s => s.url === url);

      if (existing) {

          if (existing.status === 'failed') {

              logInfo(`Found existing server with "failed" status (ID: ${existing.id}). Deleting it now...`);

              callVk("groups.deleteCallbackServer", { group_id: groupId, server_id: String(existing.id) });

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

    const res = callVk("groups.addCallbackServer", { group_id: groupId, url: String(url), title: "GAS_Auction_Bot", secret_key: secret });

    if (res && res.server_id) {

        serverId = String(res.server_id);

        logInfo('Added new callback server with ID: ' + serverId);

    } else {

        throw new Error('Не удалось добавить новый callback сервер в VK. Ответ VK: ' + JSON.stringify(res));

    }

  }



  const eventSettings = { group_id: groupId, server_id: serverId };

  eventSettings['wall_post_new'] = 1;

  eventSettings['wall_reply_new'] = 1;

  eventSettings['message_new'] = 1;

  

  const setResult = callVk("groups.setCallbackSettings", eventSettings);

  if (setResult === 1) {

      logInfo('Successfully set callback settings for server ID: ' + serverId);

  } else {

      logError('setCallbackSettings', 'Failed to set callback settings.', setResult);

  }



  return { serverId, code, secret };

}



function sendMessage(userId, message) { return callVk("messages.send", { user_id: String(userId), random_id: String(Math.floor(Math.random()*1e9)), message: message, disable_mentions: 1 }); }

function postCommentToLot(postId, message) { return callVk("wall.createComment", { owner_id: "-" + getVkGroupId(), post_id: String(postId), message: message }); }

function replyToComment(postId, commentId, message) { return callVk("wall.createComment", { owner_id: "-" + getVkGroupId(), post_id: String(postId), reply_to_comment: String(commentId), message: message }); }

function getUsersInfo(userIds) { return callVk("users.get", { user_ids: Array.isArray(userIds) ? userIds.join(",") : String(userIds), fields: "first_name,last_name,can_write_private_message" }); }

function checkCanWrite(userId) { try { const u = getUsersInfo(userId); return u && u.length > 0 ? u[0].can_write_private_message === 1 : false; } catch(e) { return false; } }

function getUserName(userId) { try { const u = getUsersInfo(userId); return u && u.length > 0 ? `${u[0].first_name} ${u[0].last_name}` : "Участник"; } catch(e) { return "Участник"; } }
