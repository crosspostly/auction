// ===================================== 
// VK API INTEGRATION - FIXED VERSION
// =====================================

const API_VERSION = '5.199';
const CACHE_TTL_SECONDS = 21600;
const OUTBID_MESSAGE = 'Ваша ставка перебита';
const LOT_NOT_SOLD_MESSAGE = 'Лот не продан';

// ✅ ПРАВИЛЬНАЯ ФУНКЦИЯ VK API С ПОЛНЫМ ЛОГИРОВАНИЕМ
function callVk(method, params, retryCount = 0) {
  const debugMode = getSetting('DEBUG_VK_API') === 'TRUE';
  const token = getSetting('VK_TOKEN');
  
  if (!token) {
    logError('callVk', 'VK_TOKEN не задан', method);
    return null;
  }
  
  // ✅ Создаём чистый объект параметров с приведением к строкам
  const cleanParams = {
    access_token: String(token),
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
      retry: retryCount
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
      // Обработка rate limiting и временных ошибок
      if (parsed.error.error_code === 6 || parsed.error.error_code === 10) {
        if (retryCount < 3) {
          const waitTime = Math.pow(2, retryCount) * 1000;
          logInfo('⌛ callVk retry', { 
            method: method, 
            retry: retryCount + 1, 
            waitMs: waitTime, 
            error: parsed.error 
          });
          Utilities.sleep(waitTime);
          return callVk(method, params, retryCount + 1);
        }
      }
      
      logError('❌ callVk ERROR: ' + method, parsed.error, {
        sentParams: Object.keys(params).join(', '),
        error_code: parsed.error.error_code,
        error_msg: parsed.error.error_msg,
        request_params: parsed.error.request_params || 'none'
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
    if (retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 1000;
      logInfo('⌛ callVk retry after exception', { 
        method: method, 
        retry: retryCount + 1, 
        waitMs: waitTime, 
        error: e.message || String(e) 
      });
      Utilities.sleep(waitTime);
      return callVk(method, params, retryCount + 1);
    }
    
    logError('❌ callVk EXCEPTION: ' + method, e, {
      message: e.message || String(e),
      stack: e.stack || 'no stack',
      sentParams: params
    });
    return null;
  }
}

// ... (rest of the file is too long, truncating)
