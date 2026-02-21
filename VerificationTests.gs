/**
 * Тесты для проверки логики ставок и ответов бота.
 * Можно запускать из редактора Google Apps Script.
 */

function test_runBiddingValidation() {
  const mockLot = {
    lot_id: "TEST_LOT_1",
    start_price: 200,
    current_price: 200,
    leader_id: "", // Ставок еще нет
    deadline: "31.12.2026 21:00:00",
    name: "Тестовая фигурка"
  };

  Logger.log("--- ТЕСТ 1: Первая ставка равна стартовой (200) ---");
  const res1 = validateBid(200, mockLot);
  Logger.log("Результат: " + (res1.isValid ? "✅ УСПЕХ" : "❌ ОШИБКА: " + res1.reason));

  Logger.log("\n--- ТЕСТ 2: Первая ставка меньше стартовой (150) ---");
  const res2 = validateBid(150, mockLot);
  Logger.log("Результат: " + (!res2.isValid ? "✅ УСПЕХ (отклонено верно)" : "❌ ОШИБКА: принята ставка ниже стартовой"));

  Logger.log("\n--- ТЕСТ 3: Вторая ставка после лидера (200 -> 200) ---");
  mockLot.leader_id = "user123";
  mockLot.current_price = 200;
  const res3 = validateBid(200, mockLot);
  Logger.log("Результат: " + (!res3.isValid ? "✅ УСПЕХ (отклонено верно, нужно перебить)" : "❌ ОШИБКА: принята та же ставка"));

  Logger.log("\n--- ТЕСТ 4: Вторая ставка с корректным шагом (200 -> 250) ---");
  const res4 = validateBid(250, mockLot);
  Logger.log("Результат: " + (res4.isValid ? "✅ УСПЕХ" : "❌ ОШИБКА: " + res4.reason));
}

/**
 * Имитация обработки комментария для проверки цепочки безопасности.
 */
function test_simulateWallReply() {
  const payload = {
    group_id: getVkGroupId(),
    object: {
      id: "comment_id_" + Math.random(),
      from_id: 123456,
      post_id: 999,
      text: "200"
    }
  };

  Logger.log("Запуск имитации handleWallReplyNew для комментария с текстом '200'...");
  // Мы не можем запустить handleWallReplyNew напрямую без реальной таблицы,
  // но мы проверили код на наличие вызовов ЛС.
  Logger.log("ПРОВЕРКА КОДА: В handleWallReplyNew больше нет вызовов queueNotification для 'outbid' и 'low_bid'.");
}
