const CONFIG_SHEET_NAME = 'BotConfig';
const CONFIG_CACHE_TTL = 300; // 5 minutes

/**
 * Loads all keys/values from BotConfig into an object.
 */
function loadBotConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('bot_config');
  if (cached) {
    return JSON.parse(cached);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    // If the sheet doesn't exist yet, return an empty object or handle as error
    // For now, let's just return empty to avoid crashing before setup
    return {};
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0];
  const keyIndex = headers.indexOf('key');
  const valueIndex = headers.indexOf('value');
  const enabledIndex = headers.indexOf('enabled');

  const config = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const key = row[keyIndex];
    const value = row[valueIndex];
    const enabled = enabledIndex !== -1 ? String(row[enabledIndex]).toLowerCase() !== 'false' : true;

    if (key && enabled) {
      config[key] = value;
    }
  }

  cache.put('bot_config', JSON.stringify(config), CONFIG_CACHE_TTL);
  return config;
}

/**
 * Returns a config string by key. If not found - default from code or throws error.
 */
function getConfigValue(key, defaultValue) {
  const config = loadBotConfig();
  if (config[key] !== undefined && config[key] !== '') {
    return config[key];
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error('Config key not found: ' + key);
}

/**
 * Placeholder substitution in template.
 */
function fillTemplate(template, data) {
  if (!template) return '';
  let result = template;
  Object.keys(data).forEach(function (placeholder) {
    const re = new RegExp('\{' + placeholder + '\}', 'g');
    result = result.replace(re, data[placeholder]);
  });
  return result;
}
