# ТЕХНИЧЕСКОЕ ЗАДАНИЕ: ИСПРАВЛЕНИЕ ОШИБКИ ПОДКЛЮЧЕНИЯ VK CALLBACK API (Google Apps Script)

## 1. СУТЬ ПРОБЛЕМЫ
При попытке автоматического подключения сервера Callback API через метод `groups.addCallbackServer`, ВКонтакте возвращает ошибку или помечает сервер статусом `failed`. 

Основные симптомы:
1.  **Ошибка `100: server_id not int64`**: Возникает при вызове `groups.setCallbackSettings`, если ID сервера передается как число (GAS может превратить его в `11.0`, что ВК не принимает).
2.  **Ошибка `Invalid response code`**: ВК отправляет тестовый запрос на `doPost` и ожидает мгновенного ответа строкой подтверждения. Если скрипт тормозит (обращается к базе) или возвращает не чистый текст, связь обрывается.

## 2. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ К РЕШЕНИЮ

### Задача №1: Победить ошибку "int64"
*   **Проблема:** Google Apps Script хранит числа как 64-bit float. При сборке JSON или Form-data целые числа могут получить десятичную точку.
*   **Решение:** 
    1. Все числовые параметры (`group_id`, `server_id`, `user_id`, `random_id`) ДОЛЖНЫ быть принудительно преобразованы в строку: `String(value)`.
    2. Тело запроса (`payload`) ДОЛЖНО собираться вручную как строка `key1=val1&key2=val2` (MIME-тип `application/x-www-form-urlencoded`). Это гарантирует, что GAS не влезет в формат данных.

### Задача №2: Реализовать "Мгновенный Handshake"
*   **Проблема:** ВК ждет ответ на `type: confirmation` в течение 1-2 секунд. Обращение к `PropertiesService` или `SpreadsheetApp` внутри `doPost` может занимать больше времени.
*   **Решение:**
    1. Использовать `CacheService` для временного хранения кода подтверждения. Он работает в разы быстрее, чем база свойств.
    2. Функция `doPost` должна начинаться с проверки: `if (data.type === 'confirmation') return ...`. Никаких лишних логов или функций перед этим!
    3. Ответ ДОЛЖЕН иметь строгий MIME-тип: `.setMimeType(ContentService.MimeType.TEXT)`.

### Задача №3: Авто-очистка лимитов (Ошибка 2000)
*   **Проблема:** Лимит 25 серверов на одну группу ВК.
*   **Решение:** Перед добавлением нового сервера проверить список существующих (`groups.getCallbackServers`). Если лимит достигнут — удалить самый старый сервер с заголовком "GAS_Auction" или аналогичным.

## 3. ЭТАЛОННАЯ СТРУКТУРА DO-POST
```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  
  if (data.type === 'confirmation') {
    var code = CacheService.getScriptCache().get('CONFIRM_' + data.group_id) 
               || PropertiesService.getScriptProperties().getProperty('CONFIRMATION_CODE');
    return ContentService.createTextOutput(String(code)).setMimeType(ContentService.MimeType.TEXT);
  }
  
  // Ответ 'ok' для всех остальных событий ПЕРЕД основной обработкой
  var response = ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  
  // Логика обработки...
  return response;
}
```

## 4. ПРОВЕРКА
Считать задачу выполненной, если:
1. Кнопка в Таблице возвращает "Успешно".
2. В настройках ВК статус сервера сменился на "ok" (зеленый).
3. В листе "Журнал" появляются входящие события `wall_post_new`.
