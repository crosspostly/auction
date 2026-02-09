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

function callVkApi(method, params) {
  const token = getVkToken();
  if (!token) throw new Error("VK_TOKEN не настроен");
  const cleanParams = { access_token: token, v: VK_API_VERSION };
  for (const key in params) {
    if (params[key] !== null && params[key] !== undefined) cleanParams[key] = String(params[key]);
  }
  const payload = Object.keys(cleanParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(cleanParams[k])).join('&');
  const options = { method: "post", contentType: "application/x-www-form-urlencoded", payload: payload, muteHttpExceptions: true };
  const res = UrlFetchApp.fetch("https://api.vk.com/method/" + method, options);
  const result = JSON.parse(res.getContentText());
  if (result.error) throw new Error(`${result.error.error_code}: ${result.error.error_msg}`);
  return result.response;
}

function getVkConfirmationCodeFromServer() {
  const groupId = getVkGroupId();
  const res = callVkApi("groups.getCallbackConfirmationCode", { group_id: groupId });
  if (res && res.code) {
    const code = String(res.code).trim();
    CacheService.getScriptCache().put("CONFIRM_" + groupId, code, 3600);
    PropertiesService.getScriptProperties().setProperty("CONFIRMATION_CODE", code);
    return code;
  }
  return null;
}

function setupCallbackServerAutomatic(url) {
  const groupId = getVkGroupId();
  const props = PropertiesService.getScriptProperties();
  
  let secret = props.getProperty("VK_SECRET");
  if (!secret) { secret = Utilities.getUuid().substring(0, 16); props.setProperty("VK_SECRET", secret); }

  const code = getVkConfirmationCodeFromServer();
  if (!code) throw new Error("Не удалось получить код подтверждения");

  const servers = callVkApi("groups.getCallbackServers", { group_id: groupId });
  let serverId = null;
  const existing = servers.items.find(s => s.url === url);
  
  if (existing) {
    serverId = String(existing.id);
  } else {
    if (servers.count >= 25) {
      const toDel = servers.items.find(s => s.title && s.title.startsWith("GAS_"));
      if (toDel) callVkApi("groups.deleteCallbackServer", { group_id: groupId, server_id: String(toDel.id) });
    }
    const res = callVkApi("groups.addCallbackServer", { group_id: groupId, url: String(url), title: "GAS_Auction", secret_key: secret });
    serverId = String(res.server_id);
  }

  const eventSettings = { group_id: groupId, server_id: serverId };
  for (let name in VK_EVENTS) eventSettings[name] = "1";
  callVkApi("groups.setCallbackSettings", eventSettings);

  return { serverId, code, secret };
}

function sendMessage(userId, message) { return callVkApi("messages.send", { user_id: String(userId), random_id: String(Math.floor(Math.random()*1e8)), message: message }); }
function postCommentToLot(postId, message) { return callVkApi("wall.createComment", { owner_id: "-" + getVkGroupId(), post_id: String(postId), message: message }); }
function replyToComment(postId, commentId, message) { return callVkApi("wall.createComment", { owner_id: "-" + getVkGroupId(), post_id: String(postId), reply_to_comment: String(commentId), message: message }); }
function getUsersInfo(userIds) { return callVkApi("users.get", { user_ids: Array.isArray(userIds) ? userIds.join(",") : String(userIds), fields: "first_name,last_name,can_write_private_message" }); }
function checkCanWrite(userId) { try { const u = getUsersInfo(userId); return u && u.groups && u.groups.length > 0 ? u.groups[0].can_write_private_message === 1 : (u && u.length > 0 ? u[0].can_write_private_message === 1 : false); } catch(e) { return false; } }
function getUserName(userId) { try { const u = getUsersInfo(userId); const user = (u.groups && u.groups[0]) || u[0]; return `${user.first_name} ${user.last_name}`; } catch(e) { return "Участник"; } }