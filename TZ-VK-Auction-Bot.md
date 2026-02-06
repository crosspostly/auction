# ТЕХНИЧЕСКОЕ ЗАДАНИЕ: БОТ АВТОМАТИЗАЦИИ АУКЦИОНОВ ВКОНТАКТЕ

**Версия:** 2.0  
**Дата:** 06.02.2026  
**Платформа:** Google Apps Script + VK Callback API  
**База данных:** Google Sheets  

---

## 1. ОБЗОР ПРОЕКТА

### 1.1. Назначение
Разработка автоматизированного бота для проведения еженедельных аукционов товаров (фигурки Warhammer 40k) в группе ВКонтакте с полной автоматизацией процесса от публикации лотов до оформления заказов победителями.

### 1.2. Бизнес-цель
Сокращение ручного труда администратора с 4+ часов до 15-20 минут на один аукцион за счёт автоматизации:
- Отслеживания ставок в комментариях
- Определения победителей
- Уведомлений участников
- Формирования сводок для оплаты

### 1.3. Технологический стек
- **Backend:** Google Apps Script (JavaScript ES6+)
- **Database:** Google Sheets (API v4)
- **VK Integration:** VK API v5.131+ (Callback API)
- **Hosting:** Google Cloud (Apps Script environment)
- **Scheduler:** Google Apps Script Time-based Triggers

---

## 2. АРХИТЕКТУРА СИСТЕМЫ

### 2.1. Компоненты

```
┌─────────────────┐
│   VK Community  │
│   (Events)      │
└────────┬────────┘
         │ Callback API Webhook
         ▼
┌─────────────────┐
│  Google Apps    │◄──────── Time Trigger (Cron)
│  Script Bot     │
└────────┬────────┘
         │
         ├─────────► VK API (methods.api.vk.com)
         │           - messages.send
         │           - wall.createComment
         │           - users.get
         │
         └─────────► Google Sheets API
                     - Read/Write data
                     - Update configs
```

### 2.2. Потоки данных

**2.2.1. Входящие события (от VK)**
- `wall_post_new` — новый пост на стене группы
- `wall_reply_new` — новый комментарий к посту
- `message_new` — новое сообщение в ЛС группы
- `confirmation` — подтверждение Callback сервера

**2.2.2. Исходящие события (к VK)**
- `messages.send` — отправка ЛС пользователям
- `wall.createComment` — публикация комментария (результаты аукциона)
- `users.get` — получение данных пользователей

**2.2.3. Хранилище (Google Sheets)**
4 листа:
1. **Config** — список активных лотов
2. **Bids** — история всех ставок
3. **Winners** — итоговая таблица победителей
4. **Settings** — настройки бота и шаблоны

---

## 3. ДЕТАЛЬНАЯ СПЕЦИФИКАЦИЯ ФУНКЦИЙ

### 3.1. ФУНКЦИЯ 1: Автопоиск постов-лотов

#### 3.1.1. Триггер
- **Тип:** Callback API event `wall_post_new`
- **Условие:** Текст поста содержит хештег `#аукцион` (регистронезависимо)

#### 3.1.2. Алгоритм
1. Получить событие `wall_post_new` от VK
2. Извлечь текст поста из `event.object.text`
3. Проверить наличие паттерна `#аукцион` (regex: `/\#аукцион/i`)
4. Если найден:
   - Парсить данные лота из текста:
     ```
     Паттерн:
     Лот №{NUMBER}: {NAME}
     Цена: {PRICE}₽
     
     Regex: /Лот\s+№?(\d+).*?\n.*?(\S.*?)\n.*?Цена:\s*(\d+)\s*₽/is
     ```
   - Записать в Google Sheets (лист **Config**):
     ```
     | lot_id | post_id | name | start_price | current_price | leader_id | status |
     |--------|---------|------|-------------|---------------|-----------|--------|
     | 1691   | -123_456| Marine| 450        | 450           | null      | active |
     ```

#### 3.1.3. Обработка ошибок
- Если парсинг не удался → записать в лог-лист "ParsingErrors" с текстом поста
- Если дубликат `lot_id` → обновить существующую запись (защита от переопубликации)
- Если пост удалён/скрыт → изменить статус лота на `cancelled`

#### 3.1.4. Граничные условия
- Максимум 100 лотов на один аукцион (ограничение Google Sheets API квот)
- Обработка Emoji и спецсимволов в названиях лотов (экранирование для Sheets)

---

### 3.2. ФУНКЦИЯ 2: Отслеживание ставок

#### 3.2.1. Триггер
- **Тип:** Callback API event `wall_reply_new`
- **Условие:** Комментарий к посту с активным лотом

#### 3.2.2. Алгоритм обработки ставки

```javascript
function processBid(event) {
  // 1. Извлечь данные
  const commentId = event.object.id;
  const postId = event.object.post_id;
  const userId = event.object.from_id;
  const text = event.object.text.trim();
  const timestamp = event.object.date;

  // 2. Проверить: это пост-лот?
  const lot = findLotByPostId(postId); // Поиск в Config
  if (!lot || lot.status !== 'active') return; // Игнорировать

  // 3. Распарсить ставку
  const bid = parseBid(text); // Regex: /(\d+)\s*₽?/
  if (!bid) return; // Не является ставкой

  // 4. Валидация ставки
  if (!validateBid(bid, lot)) {
    // Не прошла валидацию (меньше текущей, не кратна шагу и т.д.)
    // Опционально: уведомить пользователя о неверной ставке
    return;
  }

  // 5. КРИТИЧЕСКАЯ СЕКЦИЯ: защита от race condition
  // Использовать LockService для атомарной операции
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); // Ждём до 5 секунд
    
    // Перечитать текущую макс. ставку (могла измениться)
    const currentLot = findLotByPostId(postId);
    
    if (bid > currentLot.current_price) {
      // Записать ставку в историю (лист Bids)
      recordBid({
        lot_id: lot.lot_id,
        user_id: userId,
        bid_amount: bid,
        timestamp: timestamp,
        comment_id: commentId
      });

      // Получить предыдущего лидера (для уведомления)
      const previousLeader = currentLot.leader_id;

      // Обновить текущую цену и лидера в Config
      updateLot(lot.lot_id, {
        current_price: bid,
        leader_id: userId
      });

      // Уведомить перебитого (асинхронно, вне блокировки)
      if (previousLeader && previousLeader !== userId) {
        queueNotification({
          user_id: previousLeader,
          type: 'outbid',
          lot: lot,
          new_bid: bid,
          new_leader: userId
        });
      }
    }
  } finally {
    lock.releaseLock();
  }
}
```

#### 3.2.3. Функция валидации ставки

```javascript
function validateBid(bid, lot) {
  const settings = getSettings(); // Из листа Settings

  // Проверка 1: Ставка > текущей цены
  if (bid <= lot.current_price) {
    return false;
  }

  // Проверка 2: Кратность шагу (опционально)
  if (settings.bid_step_enabled) {
    const step = settings.bid_step || 50;
    if ((bid - lot.start_price) % step !== 0) {
      return false;
    }
  }

  // Проверка 3: Минимальное превышение текущей ставки
  const minIncrement = settings.min_bid_increment || 50;
  if (bid < lot.current_price + minIncrement) {
    return false;
  }

  // Проверка 4: Разумный лимит (защита от опечаток)
  const maxBid = settings.max_bid || 1000000;
  if (bid > maxBid) {
    return false;
  }

  return true;
}
```

#### 3.2.4. Защита от race conditions

**Проблема:**
Два пользователя делают ставки одновременно (в пределах 100-500мс):
- Пользователь A: 500₽ (время: 12:00:00.100)
- Пользователь B: 550₽ (время: 12:00:00.300)

Без защиты: оба прочитают `current_price = 450₽`, оба сочтут свои ставки валидными, оба запишутся → конфликт.

**Решение:**
```javascript
// Google Apps Script LockService
const lock = LockService.getScriptLock();
lock.waitLock(5000); // Эксклюзивная блокировка на 5 сек

// Критическая секция (только 1 экземпляр скрипта выполняет)
// - Перечитать актуальную цену
// - Сравнить новую ставку с актуальной
// - Записать, если выше
// - Обновить current_price атомарно

lock.releaseLock();
```

**Альтернативный подход (оптимистичная блокировка):**
```javascript
// В Config добавить столбец version (целое число)
// При обновлении:
UPDATE Config 
SET current_price = 550, leader_id = 789, version = version + 1
WHERE lot_id = 1691 AND version = 5

// Если затронуто 0 строк → версия изменилась → повторить попытку
```

#### 3.2.5. Обработка ошибок
- **VK API error 901 (Can't send messages for users without permission):** Записать в лог, пропустить уведомление
- **Google Sheets quota exceeded:** Включить exponential backoff (повтор через 1, 2, 4, 8 секунд)
- **Invalid comment format:** Игнорировать, не падать

---

### 3.3. ФУНКЦИЯ 3: Уведомления о перебитых ставках

#### 3.3.1. Архитектура очереди

**Почему очередь?**
- VK API лимиты: 20 сообщений/секунду (документация 2026)
- Если 15 лотов × 5 перебитий = 75 уведомлений → нужно батчить

**Реализация:**
```javascript
// Лист NotificationQueue в Google Sheets
| queue_id | user_id | type   | payload (JSON)       | status  | created_at | processed_at |
|----------|---------|--------|----------------------|---------|------------|--------------|
| 1        | 123     | outbid | {"lot":"Marine",...} | pending | timestamp  | null         |
| 2        | 456     | outbid | {...}                | pending | timestamp  | null         |

// Функция добавления в очередь (вызывается из processBid)
function queueNotification(data) {
  const queue = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NotificationQueue');
  queue.appendRow([
    generateId(),
    data.user_id,
    data.type,
    JSON.stringify(data.payload),
    'pending',
    new Date(),
    null
  ]);
}

// Time-based trigger: каждые 5 секунд
function processNotificationQueue() {
  const queue = getSheet('NotificationQueue');
  const rows = queue.getDataRange().getValues();
  
  let sent = 0;
  const maxBatch = 20; // VK API limit
  
  for (let i = 1; i < rows.length && sent < maxBatch; i++) {
    const [queueId, userId, type, payload, status] = rows[i];
    
    if (status !== 'pending') continue;
    
    try {
      sendNotification(userId, type, JSON.parse(payload));
      updateQueueStatus(queueId, 'sent');
      sent++;
    } catch (e) {
      updateQueueStatus(queueId, 'failed', e.message);
    }
  }
}
```

#### 3.3.2. Шаблоны уведомлений

**Шаблон: Перебитая ставка**
```javascript
function buildOutbidMessage(lot, newBid, newLeaderName) {
  return `🔔 Ваша ставка перебита!

Лот: ${lot.name} (#${lot.lot_id})
Ваша ставка: ${lot.current_price - 50}₽ (предыдущая)
Новая ставка: ${newBid}₽ (от ${newLeaderName})

Сделайте новую ставку здесь: https://vk.com/wall-${groupId}_${lot.post_id}`;
}
```

#### 3.3.3. Антиспам-логика

**Проблема:** Если за 1 минуту пришло 10 ставок на один лот, перебитому придёт 10 уведомлений.

**Решение:**
```javascript
// В NotificationQueue добавить дедупликацию
function queueNotification(data) {
  // Проверить: есть ли уже pending уведомление этому юзеру по этому лоту?
  const existing = findPendingNotification(data.user_id, data.lot_id);
  
  if (existing) {
    // Обновить существующее уведомление (новая цена)
    updateNotificationPayload(existing.queue_id, data.payload);
  } else {
    // Добавить новое
    insertNotification(data);
  }
}
```

---

### 3.4. ФУНКЦИЯ 4: Завершение аукциона

#### 3.4.1. Триггер
- **Тип:** Time-based trigger (Google Apps Script)
- **Расписание:** Каждую субботу в 21:00 МСК
- **Cron expression:** `0 21 * * 6` (в UTC: `0 18 * * 6`, если МСК = UTC+3)

#### 3.4.2. Алгоритм завершения

```javascript
function finalizeAuction() {
  const config = getSheet('Config');
  const winners = getSheet('Winners');
  const settings = getSettings();
  
  // 1. Получить все активные лоты
  const activeLots = config.getDataRange().getValues()
    .filter(row => row[6] === 'active'); // status column
  
  if (activeLots.length === 0) {
    Logger.log('No active lots to finalize');
    return;
  }

  const results = [];
  
  // 2. Для каждого лота определить победителя
  for (const lot of activeLots) {
    const [lotId, postId, name, startPrice, currentPrice, leaderId, status] = lot;
    
    if (!leaderId) {
      // Нет ставок → лот не продан
      updateLotStatus(lotId, 'unsold');
      postCommentToLot(postId, '❌ Лот не продан (не было ставок)');
      continue;
    }

    // Есть победитель
    const winner = getUserInfo(leaderId); // VK API: users.get
    
    // 3. Записать в Winners
    winners.appendRow([
      lotId,
      name,
      currentPrice,
      leaderId,
      winner.first_name + ' ' + winner.last_name,
      new Date(),
      'pending_contact', // статус оформления
      null, // delivery_calculated
      null, // paid
      null  // shipped
    ]);

    // 4. Опубликовать комментарий под постом
    const commentText = `🏆 Победитель: @id${leaderId} (${winner.first_name} ${winner.last_name})
Финальная ставка: ${currentPrice}₽

Для оформления заказа напишите "АУКЦИОН" в ЛС группы @club${groupId}`;
    
    postCommentToLot(postId, commentText);

    // 5. Отправить победителю ЛС
    sendMessage(leaderId, buildWinnerCongratulationsMessage(lotId, name, currentPrice));

    // 6. Обновить статус лота
    updateLotStatus(lotId, 'sold');

    results.push({ lotId, name, price: currentPrice, winner: winner.first_name });
  }

  // 7. Отправить отчёт админам
  const adminIds = settings.admin_ids.split(',');
  const reportText = buildAuctionReport(results);
  
  for (const adminId of adminIds) {
    sendMessage(adminId.trim(), reportText);
  }

  Logger.log(`Auction finalized: ${results.length} lots sold`);
}
```

#### 3.4.3. Функция публикации комментария

```javascript
function postCommentToLot(postId, text) {
  const vkApi = getVKApi();
  
  try {
    vkApi.wall.createComment({
      owner_id: -GROUP_ID, // Отрицательный ID группы
      post_id: postId,
      message: text,
      from_group: 1 // От имени группы
    });
  } catch (e) {
    Logger.log(`Failed to post comment to ${postId}: ${e.message}`);
    // Записать в лог-лист для ручной обработки
    logError('post_comment_failed', { post_id: postId, error: e.message });
  }
}
```

#### 3.4.4. Обработка крайних случаев

**Случай 1: Одинаковые ставки (по времени)**
```javascript
// В Bids есть поле timestamp
// Если две ставки одинаковы по сумме → победитель определяется по timestamp (раньше = победил)

const maxBid = Math.max(...bids.map(b => b.amount));
const winningBids = bids.filter(b => b.amount === maxBid);

if (winningBids.length > 1) {
  // Сортировка по timestamp (ascending)
  winningBids.sort((a, b) => a.timestamp - b.timestamp);
}

const winner = winningBids[0];
```

**Случай 2: Победитель удалил комментарий со ставкой**
- Ставка уже записана в Bids → остаётся валидной
- Проверка существования комментария не требуется (данные в Bids = источник истины)

**Случай 3: Победитель заблокирован/удалён**
```javascript
try {
  const winner = getUserInfo(leaderId);
  if (winner.deactivated) {
    // Пользователь удалён/заблокирован
    // Перейти к следующей по величине ставке
    const nextBid = getNextHighestBid(lotId, leaderId);
    if (nextBid) {
      // Повторить процесс с новым победителем
      processWinner(nextBid.user_id, lotId);
    } else {
      // Нет других ставок → лот не продан
      updateLotStatus(lotId, 'unsold');
    }
  }
} catch (e) {
  // Обработка ошибки VK API
}
```

---

### 3.5. ФУНКЦИЯ 5: Обработка команды "АУКЦИОН"

#### 3.5.1. Триггер
- **Тип:** Callback API event `message_new`
- **Условие:** Текст сообщения содержит слово "АУКЦИОН" (регистронезависимо)

#### 3.5.2. Алгоритм формирования сводки

```javascript
function handleAuctionCommand(event) {
  const userId = event.object.message.from_id;
  const text = event.object.message.text.trim().toLowerCase();

  if (!text.includes('аукцион')) return;

  // 1. Найти все лоты, выигранные этим пользователем
  const winners = getSheet('Winners');
  const userWins = winners.getDataRange().getValues()
    .filter(row => row[3] === userId && row[6] === 'pending_contact'); // leader_id, status

  if (userWins.length === 0) {
    sendMessage(userId, 'Вы не выиграли ни одного лота в последнем аукционе. 😔');
    return;
  }

  // 2. Рассчитать доставку
  const settings = getSettings();
  const deliveryRules = JSON.parse(settings.delivery_rules);
  // delivery_rules: {"1-3": 450, "4-6": 550, "7+": 650}

  const itemCount = userWins.length;
  let deliveryCost;

  if (itemCount <= 3) {
    deliveryCost = deliveryRules['1-3'];
  } else if (itemCount <= 6) {
    deliveryCost = deliveryRules['4-6'];
  } else {
    deliveryCost = deliveryRules['7+'];
  }

  // 3. Подсчитать общую сумму
  const lotsTotalCost = userWins.reduce((sum, row) => sum + row[2], 0); // price column
  const totalCost = lotsTotalCost + deliveryCost;

  // 4. Сформировать список лотов
  const lotsList = userWins.map((row, index) => {
    const [lotId, name, price] = row;
    return `${index + 1}. ${name} (#${lotId}) — ${price}₽`;
  }).join('\n');

  // 5. Получить шаблон сообщения
  const template = settings.order_summary_template;

  // 6. Заполнить шаблон переменными
  const message = template
    .replace('{LOTS_LIST}', lotsList)
    .replace('{LOTS_TOTAL}', lotsTotalCost)
    .replace('{DELIVERY_COST}', deliveryCost)
    .replace('{TOTAL_COST}', totalCost)
    .replace('{ITEM_COUNT}', itemCount)
    .replace('{PAYMENT_PHONE}', settings.payment_phone)
    .replace('{PAYMENT_BANK}', settings.payment_bank);

  // 7. Отправить сводку
  sendMessage(userId, message);

  // 8. Обновить статус в Winners (отметить, что сводка отправлена)
  updateWinnersStatus(userId, 'summary_sent');

  // 9. Логирование для статистики
  Logger.log(`Summary sent to user ${userId}: ${itemCount} items, ${totalCost}₽`);
}
```

#### 3.5.3. Шаблон сообщения (по умолчанию)

```javascript
const DEFAULT_ORDER_SUMMARY_TEMPLATE = `Добрый день!

Ваши выигранные лоты:
{LOTS_LIST}

Сумма за лоты: {LOTS_TOTAL}₽
Доставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽
━━━━━━━━━━━━━━━━━━━
ИТОГО К ОПЛАТЕ: {TOTAL_COST}₽

Для оформления отправки пришлите:
1. ФИО полностью
2. Город и адрес (или СДЭК/Почта России)
3. Номер телефона
4. Скриншот оплаты

💳 Реквизиты для оплаты:
{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}

📦 П.С. Можете копить фигурки! Аукцион каждую субботу.
Напишите "КОПИТЬ", если хотите накопить больше фигурок перед отправкой.`;
```

#### 3.5.4. Обработка команды "КОПИТЬ"

```javascript
function handleAccumulateCommand(event) {
  const userId = event.object.message.from_id;
  const text = event.object.message.text.trim().toLowerCase();

  if (!text.includes('копить')) return;

  // Обновить статус победителя → "accumulating"
  updateWinnersStatus(userId, 'accumulating');

  sendMessage(userId, `✅ Отлично! Ваши фигурки отложены для накопления.

При следующем выигрыше доставка будет рассчитана сразу на все фигурки.
Когда будете готовы оформить отправку — напишите снова "АУКЦИОН".`);
}
```

---

### 3.6. ФУНКЦИЯ 6: Управление через Google Sheets

#### 3.6.1. Структура таблицы

**Лист 1: Config**
```
| lot_id | post_id      | name              | start_price | current_price | leader_id | status   | created_at |
|--------|--------------|-------------------|-------------|---------------|-----------|----------|------------|
| 1691   | -123456_789  | Space Marine      | 450         | 600           | 123       | sold     | timestamp  |
| 1692   | -123456_790  | Ork Boyz          | 400         | 400           | null      | active   | timestamp  |
```

**Статусы лота:**
- `active` — аукцион идёт, принимаются ставки
- `sold` — продан, есть победитель
- `unsold` — не продан (нет ставок)
- `cancelled` — отменён админом вручную

**Лист 2: Bids**
```
| bid_id | lot_id | user_id | bid_amount | timestamp  | comment_id |
|--------|--------|---------|------------|------------|------------|
| 1      | 1691   | 123     | 500        | timestamp  | 12345      |
| 2      | 1691   | 456     | 550        | timestamp  | 12346      |
| 3      | 1691   | 123     | 600        | timestamp  | 12347      |
```

**Лист 3: Winners**
```
| lot_id | name         | price | winner_id | winner_name  | won_at    | status          | delivery | paid | shipped |
|--------|--------------|-------|-----------|--------------|-----------|-----------------|----------|------|---------|
| 1691   | Space Marine | 600   | 123       | Иван Иванов  | timestamp | summary_sent    | 450      | yes  | no      |
```

**Статусы оформления:**
- `pending_contact` — ожидает, что победитель напишет "АУКЦИОН"
- `summary_sent` — сводка отправлена
- `accumulating` — победитель копит фигурки
- `payment_pending` — ожидает оплаты
- `paid` — оплачено
- `shipped` — отправлено

**Лист 4: Settings**
```
| setting_key              | setting_value                       |
|--------------------------|-------------------------------------|
| group_id                 | 123456789                           |
| auction_end_time         | 21:00                               |
| auction_end_day          | 6 (суббота, 0=воскресенье)          |
| bid_step_enabled         | true                                |
| bid_step                 | 50                                  |
| min_bid_increment        | 50                                  |
| max_bid                  | 100000                              |
| delivery_rules           | {"1-3":450,"4-6":550,"7+":650}      |
| payment_phone            | +79110702193                        |
| payment_bank             | СБЕР                                |
| admin_ids                | 123,456,789                         |
| notification_enabled     | true                                |
| order_summary_template   | (длинный текст шаблона)             |
```

#### 3.6.2. Функции чтения/записи

```javascript
// Кеширование для уменьшения API calls
const CACHE_DURATION = 300; // 5 минут
const cache = CacheService.getScriptCache();

function getSettings() {
  const cached = cache.get('settings');
  if (cached) {
    return JSON.parse(cached);
  }

  const sheet = getSheet('Settings');
  const data = sheet.getDataRange().getValues();
  
  const settings = {};
  for (let i = 1; i < data.length; i++) { // skip header
    const [key, value] = data[i];
    settings[key] = value;
  }

  cache.put('settings', JSON.stringify(settings), CACHE_DURATION);
  return settings;
}

function updateLot(lotId, updates) {
  const sheet = getSheet('Config');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === lotId) { // lot_id column
      const rowIndex = i + 1; // Sheets 1-indexed
      
      // Обновить нужные столбцы
      if (updates.current_price !== undefined) {
        sheet.getRange(rowIndex, 5).setValue(updates.current_price);
      }
      if (updates.leader_id !== undefined) {
        sheet.getRange(rowIndex, 6).setValue(updates.leader_id);
      }
      if (updates.status !== undefined) {
        sheet.getRange(rowIndex, 7).setValue(updates.status);
      }
      
      break;
    }
  }
}

function recordBid(bidData) {
  const sheet = getSheet('Bids');
  sheet.appendRow([
    generateId(),
    bidData.lot_id,
    bidData.user_id,
    bidData.bid_amount,
    new Date(bidData.timestamp * 1000),
    bidData.comment_id
  ]);
}
```

#### 3.6.3. Ручные операции админа

**Сценарий 1: Изменить время окончания аукциона**
1. Админ открывает таблицу → лист Settings
2. Находит строку `auction_end_time`
3. Меняет значение с `21:00` на `20:00`
4. Сохраняет (автоматически)
5. Бот при следующем запуске триггера прочитает новое время

**Сценарий 2: Дисквалифицировать победителя**
1. Админ открывает лист Winners
2. Находит строку с лотом и победителем
3. Удаляет строку ИЛИ меняет `winner_id` на ID нового победителя
4. Запускает функцию `reprocessWinners()` вручную (через меню Apps Script)
   - Функция отправит уведомление новому победителю
   - Опубликует новый комментарий под постом

**Сценарий 3: Снять лот с аукциона**
1. Админ открывает лист Config
2. Находит строку с лотом
3. Меняет статус с `active` на `cancelled`
4. Бот перестанет принимать ставки по этому лоту

---

## 4. VK API ИНТЕГРАЦИЯ

### 4.1. Настройка Callback API

#### 4.1.1. Получение токена
1. Зайти в группу → Управление → Работа с API → Ключи доступа
2. Создать новый ключ с правами:
   - ✅ Сообщения сообщества
   - ✅ Управление сообществом (для wall.createComment)
3. Скопировать токен → сохранить в Google Apps Script PropertiesService

#### 4.1.2. Настройка Callback сервера
1. В группе: Управление → Работа с API → Callback API
2. Указать URL: `https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec`
3. Получить строку подтверждения (confirmation string)
4. В коде Apps Script обработать событие `confirmation`:
   ```javascript
   function doPost(e) {
     const event = JSON.parse(e.postData.contents);
     
     if (event.type === 'confirmation') {
       return ContentService.createTextOutput(CONFIRMATION_STRING);
     }
     
     // Обработка других событий
     processEvent(event);
     
     return ContentService.createTextOutput('ok');
   }
   ```

#### 4.1.3. Выбор событий
Включить в настройках Callback API:
- ✅ Новая запись на стене (`wall_post_new`)
- ✅ Новый комментарий на стене (`wall_reply_new`)
- ✅ Новое сообщение (`message_new`)

### 4.2. Использование VK API методов

#### 4.2.1. Обёртка для API вызовов

```javascript
function callVKApi(method, params) {
  const TOKEN = PropertiesService.getScriptProperties().getProperty('VK_TOKEN');
  const API_VERSION = '5.131';
  
  const url = `https://api.vk.com/method/${method}`;
  const payload = {
    ...params,
    access_token: TOKEN,
    v: API_VERSION
  };

  const options = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error) {
      throw new Error(`VK API Error ${json.error.error_code}: ${json.error.error_msg}`);
    }
    
    return json.response;
  } catch (e) {
    Logger.log(`VK API call failed: ${method} - ${e.message}`);
    throw e;
  }
}
```

#### 4.2.2. Отправка сообщений (с учётом лимитов)

```javascript
function sendMessage(userId, text, keyboard = null) {
  const params = {
    user_id: userId,
    message: text,
    random_id: Math.floor(Math.random() * 1000000)
  };

  if (keyboard) {
    params.keyboard = JSON.stringify(keyboard);
  }

  try {
    callVKApi('messages.send', params);
  } catch (e) {
    if (e.message.includes('901')) {
      // User privacy settings (can't send message)
      Logger.log(`Can't send message to user ${userId}: privacy settings`);
      return false;
    }
    throw e;
  }

  return true;
}
```

#### 4.2.3. Получение информации о пользователях (batch)

```javascript
function getUsersInfo(userIds) {
  // VK API позволяет запрашивать до 1000 пользователей за раз
  const batches = chunkArray(userIds, 1000);
  const results = [];

  for (const batch of batches) {
    const response = callVKApi('users.get', {
      user_ids: batch.join(','),
      fields: 'first_name,last_name,deactivated'
    });
    results.push(...response);
  }

  return results;
}
```

---

## 5. ОБРАБОТКА ОШИБОК И ЛОГИРОВАНИЕ

### 5.1. Централизованная обработка ошибок

```javascript
function safeExecute(fn, context = '') {
  try {
    return fn();
  } catch (e) {
    const errorLog = {
      context: context,
      message: e.message,
      stack: e.stack,
      timestamp: new Date()
    };

    // Записать в лист Errors
    logError(errorLog);

    // Уведомить админов (только для критических ошибок)
    if (isCriticalError(e)) {
      notifyAdmins(`🚨 Критическая ошибка в боте:\n${e.message}`);
    }

    // Для Callback API всегда возвращаем 'ok'
    return null;
  }
}

function isCriticalError(error) {
  const criticalPatterns = [
    'quota exceeded',
    'authentication',
    'permission denied',
    'service unavailable'
  ];

  return criticalPatterns.some(pattern => 
    error.message.toLowerCase().includes(pattern)
  );
}
```

### 5.2. Структура лога ошибок

**Лист: Errors**
```
| timestamp  | context           | error_type       | message                    | stack_trace |
|------------|-------------------|------------------|----------------------------|-------------|
| timestamp  | processBid        | VKApiError       | Error 901: Can't send...   | (stack)     |
| timestamp  | finalizeAuction   | SheetsQuotaError | Quota exceeded             | (stack)     |
```

### 5.3. Мониторинг и алерты

```javascript
// Trigger: каждые 6 часов
function checkSystemHealth() {
  const errors = getRecentErrors(6 * 60 * 60); // За последние 6 часов

  if (errors.length > 50) {
    notifyAdmins(`⚠️ Обнаружено ${errors.length} ошибок за последние 6 часов.
Проверьте лист Errors.`);
  }

  // Проверить доступность VK API
  try {
    callVKApi('groups.getById', { group_id: GROUP_ID });
  } catch (e) {
    notifyAdmins('🚨 VK API недоступен! Бот не работает.');
  }
}
```

---

## 6. ПРОИЗВОДИТЕЛЬНОСТЬ И ОПТИМИЗАЦИЯ

### 6.1. Квоты Google Apps Script

**Ограничения (2026):**
- **Execution time:** 6 минут на выполнение одного скрипта
- **Triggers:** 90 минут суммарно в день (для бесплатного аккаунта)
- **UrlFetch calls:** 20,000 в день
- **Spreadsheet reads/writes:** нет жёсткого лимита, но есть rate limiting

**Оптимизация:**
1. **Батчевое чтение/запись:**
   ```javascript
   // ❌ Медленно (15 отдельных вызовов)
   for (let i = 0; i < 15; i++) {
     sheet.getRange(i, 1).setValue(lots[i].name);
   }

   // ✅ Быстро (1 вызов)
   const values = lots.map(lot => [lot.name]);
   sheet.getRange(1, 1, values.length, 1).setValues(values);
   ```

2. **Кеширование Settings:**
   - Читать Settings 1 раз в 5 минут
   - Хранить в CacheService

3. **Асинхронная обработка очереди:**
   - Не блокировать Callback API ответ на отправку уведомлений
   - Использовать отдельный триггер для обработки очереди

### 6.2. VK API Rate Limits

**Лимиты (2026):**
- **messages.send:** 20 сообщений/секунду
- **wall.createComment:** 3 запроса/секунду
- **Общий лимит:** 3 запроса/секунду на обычные методы

**Реализация Exponential Backoff:**
```javascript
function callVKApiWithRetry(method, params, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return callVKApi(method, params);
    } catch (e) {
      if (e.message.includes('Too many requests per second')) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        Utilities.sleep(delay);
        continue;
      }
      throw e; // Другая ошибка — прокинуть выше
    }
  }
  throw new Error('Max retries exceeded for VK API call');
}
```

---

## 7. БЕЗОПАСНОСТЬ

### 7.1. Хранение токенов

```javascript
// ❌ НИКОГДА не храните токены в коде
const VK_TOKEN = 'abc123...'; // НЕТ!

// ✅ Используйте PropertiesService
const TOKEN = PropertiesService.getScriptProperties().getProperty('VK_TOKEN');
```

**Установка токена (один раз, вручную):**
```javascript
function setupToken() {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('VK_TOKEN', 'ваш_токен_сюда');
  properties.setProperty('CONFIRMATION_STRING', 'строка_подтверждения');
}
```

### 7.2. Валидация входящих данных

```javascript
function validateCallbackEvent(event) {
  // Проверка secret_key (опционально, но рекомендуется)
  const SECRET_KEY = PropertiesService.getScriptProperties().getProperty('VK_SECRET');
  
  if (SECRET_KEY && event.secret !== SECRET_KEY) {
    throw new Error('Invalid secret key');
  }

  // Проверка структуры события
  if (!event.type || !event.object) {
    throw new Error('Invalid event structure');
  }

  // Проверка group_id (защита от подделки от имени другой группы)
  if (event.group_id !== parseInt(GROUP_ID)) {
    throw new Error('Invalid group_id');
  }

  return true;
}
```

### 7.3. Защита от инъекций

```javascript
// При формировании сообщений экранировать пользовательский ввод
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Использование:
const userName = escapeHtml(user.first_name);
const message = `Привет, ${userName}!`; // Безопасно
```

---

## 8. ТЕСТИРОВАНИЕ

### 8.1. Unit-тесты (Google Apps Script Test Framework)

```javascript
function testParseBid() {
  const testCases = [
    { input: '500', expected: 500 },
    { input: '500₽', expected: 500 },
    { input: '1 000', expected: 1000 },
    { input: '1000 рублей', expected: 1000 },
    { input: 'Ставлю 500', expected: 500 },
    { input: 'Не ставка', expected: null }
  ];

  for (const test of testCases) {
    const result = parseBid(test.input);
    if (result !== test.expected) {
      throw new Error(`parseBid("${test.input}") = ${result}, expected ${test.expected}`);
    }
  }

  Logger.log('✅ testParseBid passed');
}

function runAllTests() {
  testParseBid();
  testValidateBid();
  testCalculateDelivery();
  // ...
}
```

### 8.2. Интеграционные тесты

**Тест 1: Полный цикл аукциона**
```javascript
function integrationTestFullAuction() {
  // 1. Создать тестовые лоты
  const testLot = createTestLot({
    lot_id: 9999,
    name: 'TEST ITEM',
    start_price: 100
  });

  // 2. Симулировать ставки
  simulateBid(9999, 123, 150); // User 123, bid 150
  simulateBid(9999, 456, 200); // User 456, bid 200
  simulateBid(9999, 123, 250); // User 123, bid 250

  // 3. Проверить текущего лидера
  const lot = getLot(9999);
  assert(lot.leader_id === 123, 'Leader should be user 123');
  assert(lot.current_price === 250, 'Price should be 250');

  // 4. Завершить аукцион
  finalizeLot(9999);

  // 5. Проверить победителя в таблице Winners
  const winner = getWinner(9999);
  assert(winner.winner_id === 123, 'Winner should be user 123');

  // 6. Очистка
  deleteLot(9999);

  Logger.log('✅ Integration test passed');
}
```

### 8.3. Тестирование в песочнице

**Рекомендация:** Создать отдельную тестовую группу ВК для разработки:
1. Создать новую группу "Тестовый аукцион"
2. Подключить бота к тестовой группе
3. Провести несколько тестовых аукционов
4. После успешного теста → переключить на боевую группу

---

## 9. РАЗВЁРТЫВАНИЕ И НАСТРОЙКА

### 9.1. Пошаговая инструкция

**Шаг 1: Создание Google Sheets**
1. Создать новую таблицу "Аукцион ВК - База данных"
2. Создать 4 листа: Config, Bids, Winners, Settings
3. Заполнить заголовки столбцов (см. раздел 3.6.1)
4. Заполнить лист Settings начальными значениями

**Шаг 2: Создание Apps Script проекта**
1. В таблице: Extensions → Apps Script
2. Вставить код бота (все функции из этого ТЗ)
3. Сохранить проект

**Шаг 3: Настройка триггеров**
1. В Apps Script: Triggers (слева) → Add Trigger
2. Создать триггеры:
   - `finalizeAuction` → Time-driven → Week timer → Saturday → 21:00-22:00
   - `processNotificationQueue` → Time-driven → Minutes timer → Every 5 minutes
   - `checkSystemHealth` → Time-driven → Hour timer → Every 6 hours

**Шаг 4: Deployment**
1. Deploy → New deployment
2. Type: Web app
3. Execute as: Me
4. Who has access: Anyone
5. Deploy → Копировать URL

**Шаг 5: Настройка VK**
1. Получить токен доступа (см. 4.1.1)
2. Запустить `setupToken()` в Apps Script для сохранения токена
3. Настроить Callback API (см. 4.1.2)
4. Вставить URL из Шага 4
5. Подтвердить сервер

**Шаг 6: Тестирование**
1. Опубликовать тестовый пост с хештегом `#аукцион`
2. Проверить: появился в Config?
3. Написать тестовую ставку в комментарии
4. Проверить: записалась в Bids?
5. Запустить `finalizeAuction()` вручную
6. Проверить: победитель определён?

---

## 10. ПОДДЕРЖКА И ОБСЛУЖИВАНИЕ

### 10.1. Регулярные задачи

**Еженедельно (после каждого аукциона):**
- Проверить лист Errors на наличие ошибок
- Убедиться, что все победители получили уведомления
- Очистить старые записи из Bids (старше 30 дней)

**Ежемесячно:**
- Сделать резервную копию Google Sheets
- Проверить квоты Apps Script (Usage dashboard)
- Обновить документацию Settings (если были изменения)

### 10.2. Частые проблемы и решения

**Проблема:** Бот не отвечает на события VK
- **Причина:** Callback URL неверный или Apps Script deployment устарел
- **Решение:** Пересоздать deployment, обновить URL в VK

**Проблема:** Уведомления не приходят пользователям
- **Причина:** Превышен лимит VK API или очередь не обрабатывается
- **Решение:** Проверить триггер `processNotificationQueue`, увеличить интервал

**Проблема:** Победители не определены после 21:00
- **Причина:** Триггер не сработал или ошибка в `finalizeAuction`
- **Решение:** Запустить `finalizeAuction()` вручную, проверить Errors

### 10.3. Обновление версии

**При добавлении новых функций:**
1. Создать новую ветку кода (сохранить старую версию)
2. Внести изменения
3. Протестировать в тестовой группе
4. Обновить Settings (если добавлены новые параметры)
5. Сделать новый deployment
6. Обновить Callback URL в VK (если изменился)
7. Мониторить работу 24 часа

---

## 11. ПРИЛОЖЕНИЯ

### 11.1. Полный список VK API методов

| Метод | Назначение | Частота использования |
|-------|------------|----------------------|
| `messages.send` | Отправка ЛС пользователям | Высокая (каждое уведомление) |
| `wall.createComment` | Публикация комментария | Средняя (завершение аукциона) |
| `users.get` | Получение данных пользователей | Средняя (определение победителей) |
| `groups.getById` | Проверка доступности API | Низкая (health check) |

### 11.2. Полный список Apps Script Triggers

| Функция | Тип триггера | Расписание |
|---------|--------------|------------|
| `doPost` | Web app | On request (VK Callback) |
| `finalizeAuction` | Time-driven | Суббота, 21:00 |
| `processNotificationQueue` | Time-driven | Каждые 5 минут |
| `checkSystemHealth` | Time-driven | Каждые 6 часов |

### 11.3. Переменные окружения (Properties)

```javascript
// Обязательные
VK_TOKEN              // Токен доступа VK
CONFIRMATION_STRING   // Строка подтверждения Callback
GROUP_ID              // ID группы (число)

// Опциональные
VK_SECRET             // Секретный ключ Callback API
DEBUG_MODE            // true/false (логирование в консоль)
```

---

## 12. ЧЕКЛИСТ ГОТОВНОСТИ К ЗАПУСКУ

### 12.1. Технические требования

- [ ] Google Sheets создана, структура соответствует спецификации
- [ ] Apps Script проект создан, код загружен
- [ ] Токен VK получен и сохранён в PropertiesService
- [ ] Callback API настроен, подтверждение успешно
- [ ] Все триггеры созданы и активны
- [ ] Web app deployment создан, URL работает
- [ ] Тестовый пост → комментарий → уведомление работают

### 12.2. Настройки бота

- [ ] GROUP_ID указан корректно
- [ ] auction_end_time установлен (21:00)
- [ ] delivery_rules заполнены
- [ ] payment_phone и payment_bank указаны
- [ ] admin_ids заполнены (для алертов)
- [ ] order_summary_template проверен

### 12.3. Документация

- [ ] Инструкция для админа создана
- [ ] Список команд бота задокументирован
- [ ] Контакты для техподдержки указаны

---

## 13. РАСШИРЕНИЯ (БУДУЩИЕ ВЕРСИИ)

### 13.1. Возможные улучшения

**V2.0:**
- Автоматические напоминания победителям (через 3 дня)
- Статистика и аналитика (графики продаж)
- Интеграция с CRM (экспорт данных)

**V3.0:**
- Веб-админка (вместо Google Sheets)
- Онлайн-оплата (ЮKassa/Robokassa)
- Мобильное приложение для управления

### 13.2. Альтернативные архитектуры

**Если Google Apps Script не подходит:**
- Миграция на Node.js + PostgreSQL + Heroku/Railway
- Использование VK Hosting (VK Mini Apps)
- Serverless: AWS Lambda + DynamoDB

---

**КОНЕЦ ТЕХНИЧЕСКОГО ЗАДАНИЯ**

---

**Примечания для разработчика:**
1. Код должен быть покрыт try-catch блоками
2. Все внешние вызовы (VK API, Sheets) должны иметь retry логику
3. Логирование критически важных операций обязательно
4. Код должен быть читаемым (комментарии на русском)
5. Использовать ES6+ синтаксис (const/let, стрелочные функции)

**Вопросы к уточнению перед стартом:**
- Текущий размер сообщества (для оценки нагрузки)
- Средняя посещаемость аукционов (количество участников)
- Пиковое количество ставок за минуту (для настройки очередей)
- Требования к SLA (допустимое время простоя)