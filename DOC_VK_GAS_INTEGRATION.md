# Техническая документация: Интеграция VK API и Google Apps Script

## 1. Главная проблема: Ошибка `int64`
В Google Apps Script (GAS) все числа являются типом `Number` (64-bit float). При передаче JSON-объекта через `UrlFetchApp`, GAS может форматировать целые числа как дробные (например, `11.0` вместо `11`). 
VK API строго валидирует типы данных, и если поле ожидает `int64`, наличие десятичной точки вызывает ошибку `100: server_id not int64`.

## 2. Решение: Ручная сборка Payload
Для гарантии того, что данные дойдут до VK в правильном формате, необходимо:
1.  Преобразовать все параметры в строки: `String(value)`.
2.  Собрать тело запроса самостоятельно в формате `application/x-www-form-urlencoded`.

### Эталонный метод вызова (VkApi.gs):
```javascript
function callVkApi(method, params) {
  const payload = Object.keys(params)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])))
    .join('&');

  const options = {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: payload,
    muteHttpExceptions: true
  };
  return UrlFetchApp.fetch("https://api.vk.com/method/" + method, options);
}
```

## 3. Особенности VK API v5.199+
*   **Метод `groups.getById`**: Возвращает массив объектов внутри ключа `groups` (ранее был просто массив в `response`). Доступ: `res.groups[0].id`.
*   **Метод `groups.addCallbackServer`**: Поле `title` ограничено **14 символами**. Использование длинных имен вызывает ошибку 100.

## 4. Обработка входящих Webhook (doPost)
Для успешного подтверждения сервера (Handshake):
1.  Ответ на `type: "confirmation"` должен быть **первым** действием в функции.
2.  Ответ должен быть чистой строкой кода подтверждения.
3.  **Обязательно** использование `.setMimeType(ContentService.MimeType.TEXT)`.

### Правильный doPost:
```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.type === 'confirmation') {
    return ContentService.createTextOutput(code).setMimeType(ContentService.MimeType.TEXT);
  }
  // ... логика
  return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
}
```
