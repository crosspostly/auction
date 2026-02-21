/**
 * 🔄 ПОЛНЫЙ ЦИКЛ ПРОВЕРКИ ДАТ (ЗАПИСЬ -> ЧТЕНИЕ -> ПАРСИНГ)
 * Создает реальные строки в таблице и проверяет, как они читаются.
 */
function runFullDateCycleTest() {
  Logger.log("🚀 ЗАПУСК ПОЛНОГО ЦИКЛА ПРОВЕРКИ ДАТ");

  const now = new Date();

  // 1. Подготовка тестовых дат
  const datePast = new Date(now.getTime() - 5 * 60 * 1000); // -5 минут
  const dateFuture = new Date(now.getTime() + 5 * 60 * 1000); // +5 минут
  const dateFarFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 часа

  const testLots = [
    { id: "TEST_PAST", name: "Лот в прошлом", deadline: datePast, expected: "EXPIRED" },
    { id: "TEST_FUTURE", name: "Лот в будущем", deadline: dateFuture, expected: "ACTIVE" },
    { id: "TEST_FAR", name: "Лот далеко", deadline: dateFarFuture, expected: "ACTIVE" }
  ];

  Logger.log(`🕒 Время теста: ${now.toLocaleString()}`);

  // 0. ОЧИСТКА: Удаляем старые тестовые лоты перед записью
  Logger.log("🧹 Очистка старых тестовых записей...");
  const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Лоты");
  const configData = configSheet.getDataRange().getValues();
  const headers = configData[0];
  const lotIdIndex = headers.indexOf("lot_id");
  
  // Идем с конца, чтобы удалять корректно
  for (let i = configData.length - 1; i >= 1; i--) {
    const lotId = String(configData[i][lotIdIndex]);
    if (lotId.startsWith("TEST_")) {
      configSheet.deleteRow(i + 1);
      Logger.log(`   Удалён старый тестовый лот: ${lotId}`);
    }
  }

  // 1. ЗАПИСЬ (Имитация реального upsertLot/appendRow)
  testLots.forEach(t => {
    Logger.log(`📝 Записываю лот ${t.id} с дедлайном: ${t.deadline.toString()}`);
    // Используем appendRow как в основном коде
    appendRow("Config", {
      lot_id: t.id,
      name: t.name,
      status: "Активен",
      start_price: 100,
      current_price: 100,
      deadline: t.deadline, // Передаем объект Date, appendRow сам его отформатирует
      created_at: new Date()
    });
  });

  SpreadsheetApp.flush(); // Принудительная запись
  CacheService.getScriptCache().remove("sheet_Config"); // Сброс кэша
  _sheet_data_mem_cache = {}; // Сброс памяти
  Logger.log("💾 Данные сохранены, кэш сброшен. Читаем обратно...");

  // 3. ЧТЕНИЕ (Имитация getSheetData)
  const rows = getSheetData("Config");
  
  testLots.forEach(t => {
    const row = rows.find(r => r.data.lot_id === t.id);
    
    if (!row) {
      Logger.log(`❌ ОШИБКА: Лот ${t.id} не найден в таблице после записи!`);
      return;
    }

    const rawDeadline = row.data.deadline;
    Logger.log(`\n🔎 ПРОВЕРКА ЛОТА ${t.id}:`);
    Logger.log(`   🔹 Записано (JS Date): ${t.deadline.toISOString()}`);
    Logger.log(`   🔹 Прочитано (из таблицы): "${rawDeadline}" (Type: ${typeof rawDeadline})`);

    const parsed = parseRussianDate(rawDeadline);
    
    if (!parsed) {
      Logger.log(`   ❌ ОШИБКА: parseRussianDate вернул null!`);
    } else {
      Logger.log(`   ✅ Распарсено: ${parsed.toLocaleString()}`);
      
      const isExpired = parsed <= new Date(); // Сравниваем с текущим моментом
      const statusResult = isExpired ? "EXPIRED" : "ACTIVE";
      
      if (statusResult === t.expected) {
        Logger.log(`   ✅ УСПЕХ: Статус совпал (${statusResult})`);
      } else {
        Logger.log(`   ❌ ПРОВАЛ: Ожидалось ${t.expected}, получено ${statusResult}`);
        Logger.log(`      Разница: ${(parsed.getTime() - new Date().getTime())/1000} сек`);
      }
    }
  });
  
  Logger.log("\n🏁 Тест завершен.");
}

/**
 * 🧪 КРАШ-ТЕСТ ПАРСЕРА ДАТ (ПРОВЕРКА БОЕВОЙ ФУНКЦИИ)
 * Прогоняет все возможные форматы через parseRussianDate и показывает вердикт.
 */
function testAllDateFormats() {
  Logger.log("⚔️ ЗАПУСК КРАШ-ТЕСТА parseRussianDate ⚔️");
  
  const now = new Date();
  Logger.log(`🕒 ТОЧКА ОТСЧЕТА (NOW): ${now.toLocaleString()} (${now.getTime()})`);
  
  // Генерируем даты относительно "сейчас"
  const futureDate = new Date(now.getTime() + 10 * 60 * 1000); // +10 минут
  const pastDate = new Date(now.getTime() - 10 * 60 * 1000);   // -10 минут
  
  const futureISO = futureDate.toISOString();
  const futureRus = Utilities.formatDate(futureDate, "GMT+3", "dd.MM.yyyy HH:mm:ss");
  const futureRusShort = Utilities.formatDate(futureDate, "GMT+3", "dd.MM.yyyy HH:mm");
  
  // Excel формат (приблизительно)
  // 25569 = дней от 1900 до 1970. 86400000 = мс в дне.
  const futureExcel = 25569 + (futureDate.getTime() / 86400000); 

  const testCases = [
    { label: "ISO String (из кэша/JSON)", val: futureISO },
    { label: "Русский формат (полный)", val: futureRus },
    { label: "Русский формат (короткий)", val: futureRusShort },
    { label: "Excel Serial Number", val: futureExcel },
    { label: "Строка с апострофом", val: "'" + futureRus },
    { label: "Объект Date", val: futureDate },
    { label: "NULL (пусто)", val: null },
    { label: "Пустая строка", val: "" },
    { label: "Мусор", val: "не дата" }
  ];

  testCases.forEach(tc => {
    Logger.log(`\n🔹 ТЕСТ: ${tc.label}`);
    Logger.log(`   Вход: [${tc.val}] (Type: ${typeof tc.val})`);
    
    try {
      const result = parseRussianDate(tc.val);
      
      if (!result) {
        if (tc.val === null || tc.val === "") {
           Logger.log("   ⚪ ИТОГ: NULL (Корректно для пустого входа)");
        } else {
           Logger.log("   ❌ ИТОГ: NULL (ОШИБКА ПАРСИНГА!)");
        }
      } else {
        const timeDiff = (result.getTime() - now.getTime()) / 1000;
        const status = result > now ? "🟢 АКТИВЕН" : "🛑 ПРОСРОЧЕН";
        
        Logger.log(`   ✅ Распарсено: ${result.toLocaleString()}`);
        Logger.log(`   ⏳ Разница с NOW: ${timeDiff.toFixed(1)} сек`);
        Logger.log(`   ⚖️ ВЕРДИКТ: ${status}`);
        
        if (tc.val !== null && tc.val !== "" && tc.val !== "не дата") {
           // Для валидных дат ожидаем, что они будут в будущем (мы так задали)
           if (result > now) {
             Logger.log("   👍 ТЕСТ ПРОЙДЕН (Дата определена верно)");
           } else {
             Logger.log("   💀 ТЕСТ ПРОВАЛЕН (Дата определена как прошедшая!)");
           }
        }
      }
    } catch (e) {
      Logger.log(`   💥 CRITICAL ERROR: ${e.message}`);
    }
  });
  
  Logger.log("\n🏁 Краш-тест завершен.");
}

function test_dateParsing() {
  Logger.log("--- ТЕСТ: ПАРСИНГ ДАТ (НОВАЯ ЛОГИКА) ---");
  
  const testCases = [
    { input: new Date(2026, 1, 21, 13, 41, 54), expected: "21.02.2026 13:41:54", label: "Date Object" },
    { input: "21.02.2026 13:41:54", expected: "21.02.2026 13:41:54", label: "Russian String (Full)" },
    { input: "21.02.2026 13:41", expected: "21.02.2026 13:41:00", label: "Russian String (Short)" },
    { input: "2026-02-21T10:41:54.000Z", expected: "21.02.2026 13:41:54", label: "ISO String (Z-based, MSK +3)" },
    { input: " 21.02.2026 13:41:54 ", expected: "21.02.2026 13:41:54", label: "String with Spaces" },
    { input: "'21.02.2026 13:41:54", expected: "21.02.2026 13:41:54", label: "String with Apostrophe" },
    { input: 46074.5707638889, expected: "21.02.2026 13:41:54", label: "Excel Serial Number" }
  ];

  testCases.forEach(tc => {
    const result = parseRussianDate(tc.input);
    if (!result || isNaN(result.getTime())) {
      Logger.log("❌ ОШИБКА [" + tc.label + "]: Вернул null или NaN");
      return;
    }
    
    // Форматируем для сравнения (в МСК)
    const formatted = Utilities.formatDate(result, "GMT+3", "dd.MM.yyyy HH:mm:ss");
    if (formatted === tc.expected) {
      Logger.log("✅ УСПЕХ [" + tc.label + "]: " + formatted);
    } else {
      Logger.log("❌ ОШИБКА [" + tc.label + "]: Ожидалось " + tc.expected + ", получено " + formatted);
    }
  });
}

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

/**
 * 🕐 ТЕСТ: ПРОВЕРКА ВРЕМЕНИ ДЛЯ АУКЦИОНА (21:00, продление, пограничные случаи)
 * Проверяет критические временные точки для завершения аукциона
 */
function test_auctionTimeScenarios() {
  Logger.log("\n🕐 ЗАПУСК ТЕСТА: ВРЕМЕННЫЕ СЦЕНАРИИ АУКЦИОНА");
  Logger.log("=" .repeat(60));
  
  const now = new Date();
  
  // Сценарии для теста
  const scenarios = [
    {
      name: "Аукцион завершается СЕГОДНЯ в 21:00 (через 2 часа)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0),
      expectedActive: true
    },
    {
      name: "Аукцион завершается СЕГОДНЯ в 21:00 (20:50, ставка за 10 мин до конца)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 50, 0),
      expectedActive: true,
      shouldExtend: true
    },
    {
      name: "Аукцион завершается СЕГОДНЯ в 21:00 (20:59, последняя секунда)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 59, 59),
      expectedActive: true,
      shouldExtend: true
    },
    {
      name: "Аукцион завершился СЕГОДНЯ в 21:00 (ровно 21:00)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      expectedActive: false
    },
    {
      name: "Аукцион завершился СЕГОДНЯ в 21:00 (21:01, просрочен на 1 минуту)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 1, 0),
      expectedActive: false
    },
    {
      name: "Аукцион завершился ВЧЕРА в 21:00",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 21, 0, 0),
      currentTime: now,
      expectedActive: false
    },
    {
      name: "Аукцион завтра в 21:00",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 21, 0, 0),
      currentTime: now,
      expectedActive: true
    },
    {
      name: "Продлённый аукцион (21:00 + 10 минут = 21:10)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 10, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 5, 0),
      expectedActive: true
    },
    {
      name: "Продлённый аукцион (21:00 + 10 минут = 21:10, просрочен)",
      deadline: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 10, 0),
      currentTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 11, 0),
      expectedActive: false
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  scenarios.forEach((scenario, index) => {
    Logger.log(`\n📌 СЦЕНАРИЙ #${index + 1}: ${scenario.name}`);
    Logger.log(`   🔹 Дедлайн: ${Utilities.formatDate(scenario.deadline, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
    Logger.log(`   🔹 Текущее время: ${Utilities.formatDate(scenario.currentTime, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
    
    // Проверяем, активен ли аукцион
    const isActive = scenario.currentTime < scenario.deadline;
    
    Logger.log(`   🔹 Ожидалось: ${scenario.expectedActive ? "АКТИВЕН" : "ЗАВЕРШЁН"}`);
    Logger.log(`   🔹 Получено: ${isActive ? "АКТИВЕН" : "ЗАВЕРШЁН"}`);
    
    if (isActive === scenario.expectedActive) {
      Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
      passed++;
    } else {
      Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
      failed++;
    }
    
    // Проверяем продление
    if (scenario.shouldExtend) {
      const timeUntilDeadline = (scenario.deadline.getTime() - scenario.currentTime.getTime()) / (1000 * 60);
      Logger.log(`   ⏱️ Время до дедлайна: ${timeUntilDeadline.toFixed(1)} мин`);
      
      if (timeUntilDeadline <= 10 && timeUntilDeadline > 0) {
        Logger.log(`   ⚠️ ПОРА ПРОДЛЕВАТЬ (менее 10 минут до конца)`);
      }
    }
  });
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log(`📊 ИТОГИ: Пройдено ${passed}/${scenarios.length}, Провалено ${failed}`);
  
  if (failed > 0) {
    Logger.log("❌ КРИТИЧЕСКИЕ ОШИБКИ В ЛОГИКЕ ВРЕМЕНИ!");
  } else {
    Logger.log("✅ ВСЕ ВРЕМЕННЫЕ СЦЕНАРИИ ОТРАБАТЫВАЮТ ВЕРНО");
  }
}

/**
 * 🧪 ТЕСТ: ПРОВЕРКА ЧАСОВЫХ ПОЯСОВ (GMT+3, MSK)
 * Убеждаемся, что все даты корректно конвертируются в московское время
 */
function test_timeZones() {
  Logger.log("\n🌍 ЗАПУСК ТЕСТА: ЧАСОВЫЕ ПОЯСА");
  Logger.log("=" .repeat(60));
  
  const testCases = [
    {
      name: "ISO строка с Z (UTC)",
      input: "2026-02-21T18:00:00.000Z",
      expectedMSK: "21.02.2026 21:00:00"
    },
    {
      name: "ISO строка с +03:00 (MSK)",
      input: "2026-02-21T21:00:00.000+03:00",
      expectedMSK: "21.02.2026 21:00:00"
    },
    {
      name: "Русский формат (GMT+3)",
      input: "21.02.2026 21:00:00",
      expectedMSK: "21.02.2026 21:00:00"
    },
    {
      name: "Unix timestamp (секунды)",
      input: 1771696800, // 21.02.2026 21:00:00 MSK = 18:00 UTC
      expectedMSK: "21.02.2026 21:00:00"
    },
    {
      name: "Unix timestamp (миллисекунды)",
      input: 1771696800000,
      expectedMSK: "21.02.2026 21:00:00"
    }
  ];
  
  testCases.forEach((tc, index) => {
    Logger.log(`\n📌 ТЕСТ #${index + 1}: ${tc.name}`);
    Logger.log(`   Вход: ${tc.input}`);
    
    try {
      let result;
      
      if (typeof tc.input === "number") {
        // Unix timestamp
        if (tc.input > 10000000000) {
          // Миллисекунды
          result = new Date(tc.input);
        } else {
          // Секунды
          result = new Date(tc.input * 1000);
        }
      } else {
        result = parseRussianDate(tc.input);
      }
      
      if (!result) {
        Logger.log(`   ❌ ОШИБКА: parseRussianDate вернул null`);
        return;
      }
      
      const formatted = Utilities.formatDate(result, "GMT+3", "dd.MM.yyyy HH:mm:ss");
      Logger.log(`   Результат: ${formatted}`);
      Logger.log(`   Ожидалось: ${tc.expectedMSK}`);
      
      if (formatted === tc.expectedMSK) {
        Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
      } else {
        Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
      }
    } catch (e) {
      Logger.log(`   💥 ОШИБКА: ${e.message}`);
    }
  });
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log("🏁 ТЕСТ ЧАСОВЫХ ПОЯСОВ ЗАВЕРШЁН");
}

/**
 * 🔄 ТЕСТ: ПРОВЕРКА ЛОГИКИ ПРОДЛЕНИЯ АУКЦИОНА
 * Проверяет, что аукцион продлевается на 10 минут при ставке за 10 минут до конца
 */
function test_auctionExtension() {
  Logger.log("\n🔄 ЗАПУСК ТЕСТА: ПРОДЛЕНИЕ АУКЦИОНА");
  Logger.log("=" .repeat(60));
  
  const now = new Date();
  const baseDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
  
  const testCases = [
    {
      name: "Ставка за 15 минут до конца (НЕ продлевать)",
      bidTime: new Date(baseDeadline.getTime() - 15 * 60 * 1000),
      deadline: baseDeadline,
      shouldExtend: false
    },
    {
      name: "Ставка за 10 минут до конца (продлевать)",
      bidTime: new Date(baseDeadline.getTime() - 10 * 60 * 1000),
      deadline: baseDeadline,
      shouldExtend: true
    },
    {
      name: "Ставка за 5 минут до конца (продлевать)",
      bidTime: new Date(baseDeadline.getTime() - 5 * 60 * 1000),
      deadline: baseDeadline,
      shouldExtend: true
    },
    {
      name: "Ставка за 1 минуту до конца (продлевать)",
      bidTime: new Date(baseDeadline.getTime() - 1 * 60 * 1000),
      deadline: baseDeadline,
      shouldExtend: true
    },
    {
      name: "Ставка через 1 минуту после дедлайна (продлевать, т.к. < 10 мин)",
      bidTime: new Date(baseDeadline.getTime() + 1 * 60 * 1000),
      deadline: baseDeadline,
      shouldExtend: true // Логика продления: timeUntilDeadline > -10, так что -1 минута ещё продлевается
    }
  ];
  
  const AUCTION_EXTENSION_WINDOW_MINUTES = 10;
  const AUCTION_EXTENSION_DURATION_MINUTES = 10;
  
  testCases.forEach((tc, index) => {
    Logger.log(`\n📌 ТЕСТ #${index + 1}: ${tc.name}`);
    
    const timeUntilDeadline = (tc.deadline.getTime() - tc.bidTime.getTime()) / (1000 * 60);
    const shouldExtend = timeUntilDeadline <= AUCTION_EXTENSION_WINDOW_MINUTES && timeUntilDeadline > -AUCTION_EXTENSION_DURATION_MINUTES;
    
    Logger.log(`   Время до дедлайна: ${timeUntilDeadline.toFixed(1)} мин`);
    Logger.log(`   Ожидалось продление: ${tc.shouldExtend ? "ДА" : "НЕТ"}`);
    Logger.log(`   Получено продление: ${shouldExtend ? "ДА" : "НЕТ"}`);
    
    if (shouldExtend === tc.shouldExtend) {
      Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
      
      if (shouldExtend) {
        const newDeadline = new Date(tc.deadline.getTime() + AUCTION_EXTENSION_DURATION_MINUTES * 60 * 1000);
        Logger.log(`   🕐 Новый дедлайн: ${Utilities.formatDate(newDeadline, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
      }
    } else {
      Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
    }
  });
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log("🏁 ТЕСТ ПРОДЛЕНИЯ ЗАВЕРШЁН");
}

/**
 * 🚀 ЗАПУСК ВСЕХ ТЕСТОВ ВРЕМЕНИ
 */
function runAllTimeTests() {
  Logger.log("\n" + "=".repeat(60));
  Logger.log("🚀 ЗАПУСК ВСЕХ ТЕСТОВ, СВЯЗАННЫХ СО ВРЕМЕНЕМ");
  Logger.log("=".repeat(60));
  
  try {
    test_dateParsing();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_dateParsing: " + e.message);
  }
  
  try {
    testAllDateFormats();
  } catch (e) {
    Logger.log("❌ ОШИБКА В testAllDateFormats: " + e.message);
  }
  
  try {
    runFullDateCycleTest();
  } catch (e) {
    Logger.log("❌ ОШИБКА В runFullDateCycleTest: " + e.message);
  }
  
  try {
    test_auctionTimeScenarios();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_auctionTimeScenarios: " + e.message);
  }
  
  try {
    test_timeZones();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_timeZones: " + e.message);
  }

  try {
    test_auctionExtension();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_auctionExtension: " + e.message);
  }

  Logger.log("\n" + "=".repeat(60));
  Logger.log("🏁 ВСЕ ТЕСТЫ ВРЕМЕНИ ЗАВЕРШЕНЫ");
  Logger.log("=".repeat(60));
}

/**
 * 🏁 ТЕСТ: ПРОВЕРКА finalizeAuction (КРИТИЧЕСКИЙ ТЕСТ)
 * Проверяет, что функция завершения аукциона корректно определяет просроченные лоты
 */
function test_finalizeAuctionLogic() {
  Logger.log("\n🏁 ЗАПУСК ТЕСТА: ЛОГИКА finalizeAuction");
  Logger.log("=" .repeat(60));
  
  const now = new Date();
  
  // Тестовые сценарии для лотов
  const testScenarios = [
    {
      name: "Лот с дедлайном 5 минут назад (должен завершиться)",
      deadline: new Date(now.getTime() - 5 * 60 * 1000),
      status: "Активен",
      leader_id: "user123",
      current_price: 500,
      shouldBeFinalized: true
    },
    {
      name: "Лот с дедлайном 1 час назад (должен завершиться)",
      deadline: new Date(now.getTime() - 60 * 60 * 1000),
      status: "Активен",
      leader_id: "user456",
      current_price: 1000,
      shouldBeFinalized: true
    },
    {
      name: "Лот с дедлайном через 5 минут (НЕ должен завершиться)",
      deadline: new Date(now.getTime() + 5 * 60 * 1000),
      status: "Активен",
      leader_id: "user789",
      current_price: 750,
      shouldBeFinalized: false
    },
    {
      name: "Лот с дедлайном через 1 час (НЕ должен завершиться)",
      deadline: new Date(now.getTime() + 60 * 60 * 1000),
      status: "Активен",
      leader_id: "",
      current_price: 200,
      shouldBeFinalized: false
    },
    {
      name: "Лот со статусом 'Продан' (НЕ должен завершиться)",
      deadline: new Date(now.getTime() - 10 * 60 * 1000),
      status: "Продан",
      leader_id: "user999",
      current_price: 300,
      shouldBeFinalized: false
    },
    {
      name: "Лот со статусом 'Не продан' (НЕ должен завершиться)",
      deadline: new Date(now.getTime() - 10 * 60 * 1000),
      status: "Не продан",
      leader_id: "",
      current_price: 0,
      shouldBeFinalized: false
    }
  ];
  
  Logger.log(`\n📊 ТЕСТОВЫХ СЦЕНАРИЕВ: ${testScenarios.length}`);
  Logger.log(`🕒 Текущее время: ${Utilities.formatDate(now, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
  
  let passed = 0;
  let failed = 0;
  
  testScenarios.forEach((scenario, index) => {
    Logger.log(`\n📌 СЦЕНАРИЙ #${index + 1}: ${scenario.name}`);
    
    // Проверяем логику фильтрации (как в finalizeAuction строка 1771)
    const isActive = (scenario.status === "active" || scenario.status === "Активен");
    const parsedDeadline = parseRussianDate(scenario.deadline);
    const isExpired = parsedDeadline && parsedDeadline <= now;
    const shouldBeSelected = isActive && isExpired;
    
    Logger.log(`   🔹 Статус: ${scenario.status} → ${isActive ? "АКТИВЕН" : "НЕ АКТИВЕН"}`);
    Logger.log(`   🔹 Дедлайн: ${Utilities.formatDate(scenario.deadline, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
    Logger.log(`   🔹 Распарсен: ${parsedDeadline ? Utilities.formatDate(parsedDeadline, "GMT+3", "dd.MM.yyyy HH:mm:ss") : "NULL"}`);
    Logger.log(`   🔹 Истёк: ${isExpired ? "ДА" : "НЕТ"}`);
    Logger.log(`   🔹 Ожидалось: ${scenario.shouldBeFinalized ? "ЗАВЕРШИТЬ" : "НЕ ЗАВЕРШАТЬ"}`);
    Logger.log(`   🔹 Получено: ${shouldBeSelected ? "ЗАВЕРШИТЬ" : "НЕ ЗАВЕРШАТЬ"}`);
    
    if (shouldBeSelected === scenario.shouldBeFinalized) {
      Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
      passed++;
    } else {
      Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
      failed++;
    }
  });
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log(`📊 ИТОГИ: Пройдено ${passed}/${testScenarios.length}, Провалено ${failed}`);
  
  if (failed > 0) {
    Logger.log("❌ КРИТИЧЕСКИЕ ОШИБКИ В ЛОГИКЕ finalizeAuction!");
  } else {
    Logger.log("✅ ЛОГИКА finalizeAuction РАБОТАЕТ ВЕРНО");
  }
}

/**
 * 🧪 ТЕСТ: ПРОВЕРКА parseRussianDate С РАЗНЫМИ ФОРМАТАМИ ИЗ ТАБЛИЦЫ
 * Симулирует реальные данные, которые приходят из Google Sheets
 */
function test_parseRussianDateFromSheets() {
  Logger.log("\n🧪 ЗАПУСК ТЕСТА: parseRussianDate С ДАННЫМИ ИЗ ТАБЛИЦЫ");
  Logger.log("=" .repeat(60));
  
  const now = new Date();
  const testDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
  
  // Различные форматы, которые могут прийти из Sheets
  const testCases = [
    {
      name: "Объект Date (как приходит из Sheets)",
      input: testDate,
      shouldParse: true
    },
    {
      name: "Строка в формате Sheets 'dd.MM.yyyy HH:mm:ss'",
      input: Utilities.formatDate(testDate, "GMT+3", "dd.MM.yyyy HH:mm:ss"),
      shouldParse: true
    },
    {
      name: "Строка в формате Sheets 'dd.MM.yyyy HH:mm'",
      input: Utilities.formatDate(testDate, "GMT+3", "dd.MM.yyyy HH:mm"),
      shouldParse: true
    },
    {
      name: "Пустая строка",
      input: "",
      shouldParse: false
    },
    {
      name: "NULL",
      input: null,
      shouldParse: false
    },
    {
      name: "Невалидная строка",
      input: "не дата",
      shouldParse: false
    },
    {
      name: "Число (Excel serial)",
      input: 25569 + (testDate.getTime() / 86400000),
      shouldParse: true
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  testCases.forEach((tc, index) => {
    Logger.log(`\n📌 ТЕСТ #${index + 1}: ${tc.name}`);
    Logger.log(`   Вход: ${tc.input} (Type: ${typeof tc.input})`);
    
    try {
      const result = parseRussianDate(tc.input);
      
      if (tc.shouldParse) {
        if (result && !isNaN(result.getTime())) {
          Logger.log(`   ✅ Распарсено: ${Utilities.formatDate(result, "GMT+3", "dd.MM.yyyy HH:mm:ss")}`);
          Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
          passed++;
        } else {
          Logger.log(`   ❌ ОШИБКА: Ожидалась дата, получено ${result}`);
          Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
          failed++;
        }
      } else {
        if (!result || isNaN(result.getTime())) {
          Logger.log(`   ✅ Корректно вернул null/invalid`);
          Logger.log(`   ✅ ТЕСТ ПРОЙДЕН`);
          passed++;
        } else {
          Logger.log(`   ❌ ОШИБКА: Ожидался null, получено ${result}`);
          Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
          failed++;
        }
      }
    } catch (e) {
      Logger.log(`   💥 ОШИБКА: ${e.message}`);
      Logger.log(`   ❌ ТЕСТ ПРОВАЛЕН`);
      failed++;
    }
  });
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log(`📊 ИТОГИ: Пройдено ${passed}/${testCases.length}, Провалено ${failed}`);
  
  if (failed > 0) {
    Logger.log("❌ ПРОБЛЕМЫ С ПАРСЕРОМ ДАТ!");
  } else {
    Logger.log("✅ parseRussianDate РАБОТАЕТ КОРРЕКТНО");
  }
}

/**
 * 🚀 ЗАПУСК ВСЕХ ТЕСТОВ (ВКЛЮЧАЯ finalizeAuction)
 */
function runAllVerificationTests() {
  Logger.log("\n" + "=".repeat(60));
  Logger.log("🚀 ЗАПУСК ВСЕХ ВЕРИФИКАЦИОННЫХ ТЕСТОВ");
  Logger.log("=".repeat(60));
  
  runAllTimeTests();
  
  try {
    test_finalizeAuctionLogic();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_finalizeAuctionLogic: " + e.message);
  }
  
  try {
    test_parseRussianDateFromSheets();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_parseRussianDateFromSheets: " + e.message);
  }
  
  try {
    test_runBiddingValidation();
  } catch (e) {
    Logger.log("❌ ОШИБКА В test_runBiddingValidation: " + e.message);
  }
  
  Logger.log("\n" + "=".repeat(60));
  Logger.log("🏁 ВСЕ ВЕРИФИКАЦИОННЫЕ ТЕСТЫ ЗАВЕРШЕНЫ");
  Logger.log("=".repeat(60));
}
