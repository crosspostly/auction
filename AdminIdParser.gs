
/**
 * Parses the ADMIN_IDS string which can contain user IDs and VK chat URLs.
 * Extracts clean IDs and separates them into users and chats.
 * @param {string} adminIdsString The raw string from the settings sheet.
 * @returns {{all: string[], users: string[], chats: string[]}} An object containing all IDs, only user IDs, and only chat peer_ids.
 */
function parseAdminIds(adminIdsString) {
  if (!adminIdsString || typeof adminIdsString !== 'string') {
    return { all: [], users: [], chats: [] };
  }

  const ids = String(adminIdsString).split(',').map(item => {
    const trimmedItem = item.trim();
    if (trimmedItem.startsWith("https://vk.com/im/")) {
      const match = trimmedItem.match(/(?:\/convo\/|\/sel\/c)(\d+)/);
      return match ? match[1] : null;
    }
    return trimmedItem;
  }).filter(id => id);

  const users = ids.filter(id => Number(id) < 2000000000);
  const chats = ids.filter(id => Number(id) >= 2000000000);

  return { all: ids, users: users, chats: chats };
}
