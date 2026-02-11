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

## 5. Двухтокенная схема и проверка прав

Для стабильной работы рекомендуется разделять задачи между двумя токенами:
1.  **Admin (User) Token**: Только для методов `groups.setCallbackSettings`, `groups.getCallbackConfirmationCode` и `wall.delete`.
2.  **Group Token**: Для операционной работы (`messages.send`, `wall.createComment`).

### Метод «Тихой проверки» (Шаг 4):
Для гарантии того, что бот действительно может писать от имени группы (настройка `from_group: 1`), реализован следующий алгоритм:
1.  Публикация поста `wall.post` через Group Token.
2.  Публикация комментария `wall.createComment` через Group Token.
3.  **Мгновенное удаление** поста через Admin Token.
Это позволяет проверить права, не оставляя мусора на стене группы.

