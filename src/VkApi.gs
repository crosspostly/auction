const VK_API_VERSION = "5.131";

function getVkToken() {
  return PropertiesService.getScriptProperties().getProperty("VK_TOKEN") || "";
}

function getVkGroupId() {
  const settings = getSettings();
  return settings.group_id || PropertiesService.getScriptProperties().getProperty("VK_GROUP_ID") || "";
}

function callVkApi(method, params) {
  const token = getVkToken();
  if (!token) {
    throw new Error("VK token is not configured");
  }
  const payload = {
    ...params,
    access_token: token,
    v: VK_API_VERSION
  };
  const response = UrlFetchApp.fetch(`https://api.vk.com/method/${method}`, {
    method: "post",
    payload: payload,
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  if (data.error) {
    const error = new Error(`${data.error.error_code}: ${data.error.error_msg}`);
    error.details = data.error;
    throw error;
  }
  return data.response;
}

function callVkApiWithRetry(method, params, attempts) {
  const maxAttempts = attempts || 3;
  let lastError;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return callVkApi(method, params);
    } catch (error) {
      lastError = error;
      Utilities.sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

function sendMessage(userId, message) {
  return callVkApiWithRetry("messages.send", {
    user_id: userId,
    random_id: Utilities.getUuid(),
    message: message
  });
}

function postCommentToLot(postId, message) {
  const groupId = getVkGroupId();
  if (!groupId) {
    throw new Error("VK group ID is not configured");
  }
  return callVkApiWithRetry("wall.createComment", {
    owner_id: -Math.abs(Number(groupId)),
    post_id: postId,
    message: message
  });
}

function getUsersInfo(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) {
    return [];
  }
  return callVkApiWithRetry("users.get", {
    user_ids: ids.join(","),
    fields: "first_name,last_name"
  });
}
