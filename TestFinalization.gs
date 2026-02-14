/**
 * Скрипт для тестирования финализации аукциона.
 * Эмулирует ситуацию "Аукцион закончился 5 минут назад, есть победитель".
 */
console.log("TestFinalization loaded");

function runFinalizationTest() {
  const ui = SpreadsheetApp.getUi();
  
  // 1. Проверка настроек
  const settings = getSettings();
  if (!settings.ADMIN_IDS) {
    ui.alert('❌ Ошибка', 'В листе "Настройки" не указаны ADMIN_IDS. Бот не сможет отправить отчет.', ui.ButtonSet.OK);
    return;
  }

  // Генерация уникальных ID для теста
  const timestamp = new Date().getTime();
  const testLotId = "TEST_LOT_" + timestamp;
  const testUserId = "100" + timestamp; // Фейковый ID пользователя
  const testUserName = "Тестовый Покупатель";
  
  // Дата дедлайна: 1 час назад (чтобы аукцион считался завершенным)
  const deadlineDate = new Date();
  deadlineDate.setHours(deadlineDate.getHours() - 1);
  const deadlineStr = formatDateForSheets(deadlineDate); // Используем формат dd.MM.yyyy HH:mm

  const createdDate = new Date();
  createdDate.setHours(createdDate.getHours() - 24);

  logInfo("🧪 [TEST] Начинаю подготовку данных для теста финализации...");

  // 2. Вставляем Лот (Config)
  // Статус active, но время вышло.
  const newLot = {
    lot_id: testLotId,
    post_id: "-1_000000", // Фейковый пост
    name: "Тестовый Лот для Финала",
    start_price: 100,
    current_price: 500,
    leader_id: testUserId,
    status: "active", // Важно: статус активен, чтобы скрипт его подхватил
    created_at: createdDate,
    deadline: deadlineStr, // Прошедшее время
    bid_step: 50,
    image_url: "",
    attachment_id: ""
  };
  appendRow("Config", newLot);
  console.log("Добавлен лот:", newLot);

  // 3. Вставляем Ставку (Bids)
  // Статус "лидер"
  const newBid = {
    bid_id: "bid_" + timestamp,
    lot_id: testLotId,
    post_id: "000000",
    user_id: testUserId,
    bid_amount: 500,
    timestamp: new Date(),
    comment_id: "999999",
    status: "лидер"
  };
  appendRow("Bids", newBid);
  console.log("Добавлена ставка:", newBid);

  // 4. Вставляем Пользователя (Users)
  // Чтобы проверить обновление статистики
  const newUser = {
    user_id: testUserId,
    user_name: testUserName,
    first_win_date: "",
    last_win_date: "",
    total_lots_won: 0,
    total_lots_paid: 0,
    shipping_status: "",
    shipping_details: "г. Тестоград, ул. Проверки, д. 1"
  };
  appendRow("Users", newUser);
  console.log("Добавлен пользователь:", newUser);

  // 5. Запуск финализации
  logInfo("🧪 [TEST] Данные готовы. Запускаю finalizeAuction()...");
  const response = ui.alert(
    'Данные созданы', 
    `Лот: ${testLotId}
Победитель: ${testUserId}

Нажмите ДА, чтобы запустить finalizeAuction().
Смотрите в лист "Заказы" и в свои ЛС ВК.`, 
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    finalizeAuction();
    ui.alert('✅ Функция завершена. Проверьте лист "Заказы" и сообщения администратора.');
  } else {
    ui.alert('Запуск отменен. Тестовые данные остались в таблице (можете удалить вручную).');
  }
}

// Вспомогательная функция форматирования даты как в Sheets.gs, 
// но дублируем тут, чтобы не зависеть от приватных функций, если они есть.
function formatDateForSheets(date) {
  const d = new Date(date);
  const pad = (num) => num.toString().padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
