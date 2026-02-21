/**
 * Скрипт для тестирования финализации аукциона.
 * Эмулирует ситуацию "Аукцион закончился 5 минут назад, есть победитель".
 * Запускается вручную из редактора. Не использует UI (alert/prompt), только логи.
 */

function runFinalizationTest() {
  console.log("🚀 [TEST] Запуск теста финализации...");
  
  // 1. Проверка настроек
  const settings = getSettings();
  if (!settings.ADMIN_IDS) {
    console.error('❌ Ошибка: В листе "Настройки" не указаны ADMIN_IDS. Бот не сможет отправить отчет.');
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

  console.log("🧪 [TEST] Создаю тестовые данные...");

  // 2. Вставляем Лот (Config)
  // Используем более реалистичный ID поста
  const newLot = {
    lot_id: testLotId,
    post_id: "-1_123456789", // Фейковый, но не нулевой пост
    name: "Тестовый Лот для Финала",
    start_price: 100,
    current_price: 500,
    leader_id: testUserId,
    status: "active", 
    created_at: createdDate,
    deadline: deadlineStr, 
    bid_step: 50,
    image_url: "",
    attachment_id: ""
  };
  appendRow("Config", newLot);
  console.log("✅ Добавлен лот:", testLotId);

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
  console.log("✅ Добавлена ставка: 500 руб");

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
  console.log("✅ Добавлен пользователь:", testUserName);

  // 5. Запуск финализации
  console.log("🔄 [TEST] Запускаю finalizeAuction()...");
  try {
    finalizeAuction();
    console.log("✅ finalizeAuction() выполнена успешно.");
    console.log("📋 ПРОВЕРЬТЕ РЕЗУЛЬТАТЫ:");
    console.log(`   1. В листе "Заказы" должна появиться строка с lot_id=${testLotId}`);
    console.log(`   2. В листе "Лоты" статус лота ${testLotId} должен смениться на 'sold'`);
    console.log(`   3. Администраторы (ID: ${settings.ADMIN_IDS}) должны получить ЛС в ВКонтакте.`);
  } catch (e) {
    console.error("❌ Ошибка при выполнении finalizeAuction():", e);
  }
}

/**
 * Простая проверка связи с админом.
 */
function testAdminMessage() {
  console.log("🚀 Запуск теста связи с администратором...");
  const settings = getSettings();
  const adminIds = String(settings.ADMIN_IDS || "").split(',').map(id => id.trim()).filter(id => id);
  
  if (adminIds.length === 0) {
    console.error("❌ ADMIN_IDS не настроены!");
    return;
  }

  adminIds.forEach(id => {
    console.log(`📡 Отправляю тестовое сообщение админу ${id}...`);
    const res = sendMessage(id, "🧪 Проверка связи! Если вы видите это сообщение, значит бот может писать вам в ЛС.");
    if (res && res.error) {
      console.error(`❌ Ошибка ВК для ID ${id}: [${res.error.error_code}] ${res.error.error_msg}`);
      if (res.error.error_code === 901) {
        console.warn("⚠️ СОВЕТ: Напишите любое сообщение в ЛС группы, чтобы разрешить боту писать вам.");
      }
    } else {
      console.log(`✅ Сообщение успешно отправлено админу ${id}`);
    }
  });
}

/**
 * Тестирует команду КОПИТЬ.
 * Симулирует входящее сообщение от пользователя.
 */
function testAccumulateCommand() {
  console.log("🚀 Запуск теста команды КОПИТЬ...");
  
  // Берем ID первого попавшегося пользователя из базы для теста
  const users = getSheetData("Users");
  if (users.length === 0) {
    console.error("❌ В листе Пользователи нет данных для теста.");
    return;
  }
  
  const testUser = users[0].data;
  console.log(`👤 Тестируем для пользователя: ${testUser.user_name} (ID: ${testUser.user_id})`);
  console.log(`   Статус ДО: ${testUser.shipping_status}`);

  // Эмулируем структуру события VK message_new
  const payload = {
    type: "message_new",
    object: {
      message: {
        from_id: testUser.user_id,
        text: "КОПИТЬ"
      }
    }
  };

  try {
    handleMessageNew(payload);
    
    // Перечитываем данные
    Utilities.sleep(1000);
    const updatedUsers = getSheetData("Users");
    const updatedUser = updatedUsers.find(u => String(u.data.user_id) === String(testUser.user_id));
    
    console.log(`   Статус ПОСЛЕ: ${updatedUser.data.shipping_status}`);
    
    if (updatedUser.data.shipping_status === "Накопление") {
      console.log("✅ УСПЕХ: Статус успешно изменен на 'Накопление'.");
    } else {
      console.log("❌ ОШИБКА: Статус не изменился.");
    }
    
  } catch (e) {
    console.error("❌ Ошибка при тесте команды КОПИТЬ:", e);
  }
}

// Вспомогательная функция форматирования даты как в Sheets.gs, 
// но дублируем тут, чтобы не зависеть от приватных функций, если они есть.
function formatDateForSheets(date) {
  const d = new Date(date);
  const pad = (num) => num.toString().padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
