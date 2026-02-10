/**
 * @fileoverview Функции для проверки и исправления настроек системы
 */

/**
 * Проверяет и при необходимости исправляет настройки системы
 */
function checkAndFixSettings() {
  try {
    console.log("Проверка настроек системы...");
    
    // Получаем все настройки
    const settings = getSettings();
    
    // Проверяем критические настройки
    const criticalSettings = {
      'bid_step_enabled': true,
      'bid_step': 50,
      'min_bid_increment': 50,
      'max_bid': 1000000,
      'require_subscription': false,
      'delivery_rules': JSON.stringify({ "1-3": 450, "4-6": 550, "7+": 650 }),
      'order_summary_template': "Добрый день!\n\nВаши выигранные лоты:\n{LOTS_LIST}\n\nСумма за лоты: {LOTS_TOTAL}₽\nДоставка ({ITEM_COUNT} фигурок): {DELIVERY_COST}₽\n━━━━━━━━━━━━━━━━━━━\nИТОГО К ОПЛАТЕ: {TOTAL_COST}₽\n\nДля оформления отправки пришлите:\n1. ФИО полностью\n2. Город и адрес (или СДЭК/Почта России)\n3. Номер телефона\n4. Скриншот оплаты\n\n💳 Реквизиты для оплаты:\n{PAYMENT_BANK} (СБП): {PAYMENT_PHONE}\n\n📦 П.С. Можете копить фигурки! Аукцион каждую субботу.\nНапишите \"КОПИТЬ\", если хотите накопить больше фигурок перед отправкой.",
      'ADMIN_IDS': ""
    };
    
    // Проверяем каждую настройку
    let needsUpdate = false;
    for (const [key, defaultValue] of Object.entries(criticalSettings)) {
      if (settings[key] === undefined || settings[key] === null || settings[key] === "") {
        console.log(`Настройка ${key} отсутствует или пуста, будет установлена в значение по умолчанию: ${defaultValue}`);
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      console.log("Обновляем настройки...");
      const settingsSheet = getSheet("Settings");
      
      // Получаем существующие данные
      const values = settingsSheet.getDataRange().getValues();
      const existingSettings = {};
      
      if (values.length > 1) {
        values.slice(1).forEach(row => {
          if (row[0]) existingSettings[row[0]] = row[1];
        });
      }
      
      // Обновляем недостающие настройки
      for (const [key, defaultValue] of Object.entries(criticalSettings)) {
        if (existingSettings[key] === undefined || existingSettings[key] === null || existingSettings[key] === "") {
          // Найдем строку с этой настройкой или добавим новую
          let found = false;
          for (let i = 1; i < values.length; i++) {
            if (values[i][0] === key) {
              settingsSheet.getRange(i + 1, 2).setValue(defaultValue);
              found = true;
              break;
            }
          }
          
          if (!found) {
            // Добавляем новую строку
            settingsSheet.appendRow([key, defaultValue, SETTINGS_DESCRIPTIONS[key] || ""]);
          }
        }
      }
      
      // Очищаем кэш настроек
      CacheService.getScriptCache().remove("settings");
      console.log("Настройки обновлены и кэш очищен");
    } else {
      console.log("Все критические настройки присутствуют");
    }
    
    // Проверяем, что настройки теперь корректны
    const updatedSettings = getSettings();
    console.log(`bid_step: ${updatedSettings.bid_step} (тип: ${typeof updatedSettings.bid_step})`);
    console.log(`bid_step_enabled: ${updatedSettings.bid_step_enabled} (тип: ${typeof updatedSettings.bid_step_enabled})`);
    
    return { success: true, message: "Проверка настроек завершена" };
  } catch (error) {
    console.error("Ошибка при проверке настроек:", error);
    return { success: false, message: error.message };
  }
}

/**
 * Тестирует функцию validateBid с различными параметрами
 */
function testValidateBidFunction() {
  try {
    console.log("Тестирование функции validateBid...");
    
    // Создаем тестовый лот
    const testLot = {
      lot_id: "TEST123",
      start_price: 100,
      current_price: 100,
      status: "active",
      bid_step: 50
    };
    
    // Проверяем настройки
    const settings = getSettings();
    console.log("Текущие настройки:");
    console.log("- bid_step:", settings.bid_step, typeof settings.bid_step);
    console.log("- bid_step_enabled:", settings.bid_step_enabled, typeof settings.bid_step_enabled);
    
    // Тестируем валидацию
    const result1 = validateBid(150, testLot); // Должна быть валидной (150 > 100)
    console.log("Результат валидации ставки 150:", result1);
    
    const result2 = validateBid(125, testLot); // Должна быть невалидной (не кратна шагу 50 от start_price 100)
    console.log("Результат валидации ставки 125:", result2);
    
    return { success: true, message: "Тестирование завершено" };
  } catch (error) {
    console.error("Ошибка при тестировании validateBid:", error);
    return { success: false, message: error.message };
  }
}