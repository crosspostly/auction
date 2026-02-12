/**
 * Простой тест для проверки обновленной функциональности
 */
function runBasicTests() {
  console.log("Запуск базовых тестов обновленной функциональности...");
  
  // Тест 1: Проверка функции buildOutbidMessage
  console.log("\n--- Тест 1: buildOutbidMessage ---");
  try {
    const testPayload = {
      lot_name: "Тестовый лот",
      new_bid: 1500,
      post_id: "-123456_789"
    };
    const result = buildOutbidMessage(testPayload);
    console.log("Результат:", result.substring(0, 100) + "...");
    console.log("✅ buildOutbidMessage работает");
  } catch (e) {
    console.log("❌ Ошибка в buildOutbidMessage:", e.message);
  }
  
  // Тест 2: Проверка функции buildWinnerMessage
  console.log("\n--- Тест 2: buildWinnerMessage ---");
  try {
    const testPayload = {
      lot_name: "Тестовый лот",
      price: 2500
    };
    const result = buildWinnerMessage(testPayload);
    console.log("Результат:", result.substring(0, 100) + "...");
    console.log("✅ buildWinnerMessage работает");
  } catch (e) {
    console.log("❌ Ошибка в buildWinnerMessage:", e.message);
  }
  
  // Тест 3: Проверка функции buildLowBidMessage
  console.log("\n--- Тест 3: buildLowBidMessage ---");
  try {
    const testPayload = {
      your_bid: 1000,
      lot_name: "Тестовый лот",
      current_bid: 1200,
      post_id: "-123456_789"
    };
    const result = buildLowBidMessage(testPayload);
    console.log("Результат:", result.substring(0, 100) + "...");
    console.log("✅ buildLowBidMessage работает");
  } catch (e) {
    console.log("❌ Ошибка в buildLowBidMessage:", e.message);
  }
  
  // Тест 4: Проверка функции buildWinnerCommentMessage
  console.log("\n--- Тест 4: buildWinnerCommentMessage ---");
  try {
    const testPayload = {
      date: "01.01.2024",
      user_id: "123456789",
      user_name: "Тестовый Пользователь"
    };
    const result = buildWinnerCommentMessage(testPayload);
    console.log("Результат:", result.substring(0, 100) + "...");
    console.log("✅ buildWinnerCommentMessage работает");
  } catch (e) {
    console.log("❌ Ошибка в buildWinnerCommentMessage:", e.message);
  }
  
  // Тест 5: Проверка функции buildUnsoldLotCommentMessage
  console.log("\n--- Тест 5: buildUnsoldLotCommentMessage ---");
  try {
    const result = buildUnsoldLotCommentMessage();
    console.log("Результат:", result);
    console.log("✅ buildUnsoldLotCommentMessage работает");
  } catch (e) {
    console.log("❌ Ошибка в buildUnsoldLotCommentMessage:", e.message);
  }
  
  console.log("\n🎉 Все базовые тесты завершены!");
}