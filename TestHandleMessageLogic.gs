/**
 * Тест для проверки корректности обработки сообщений от пользователя
 * и предотвращения ложных срабатываний
 */
function testHandleMessageNewLogic() {
  console.log("=== Тестирование логики handleMessageNew ===");
  
  // Создадим тестовые данные
  const testUserId = "999999999";
  const testLotId = "TEST999";
  
  // Очистим старые данные пользователя
  const allUsers = getSheetData("Users");
  const existingUser = allUsers.find(u => String(u.data.user_id) === testUserId);
  if (existingUser) {
    updateRow("Users", existingUser.rowIndex, { 
      shipping_details: '', 
      shipping_status: 'accumulating' 
    });
  } else {
    appendRow("Users", {
      user_id: testUserId,
      user_name: "Test User",
      first_win_date: new Date(),
      last_win_date: new Date(),
      total_lots_won: 1,
      total_lots_paid: 0,
      shipping_status: 'accumulating',
      shipping_details: ''
    });
  }
  
  // Создадим тестовый заказ
  const testOrder = {
    order_id: `${testLotId}-${testUserId}`,
    lot_id: testLotId,
    lot_name: "Тестовый лот",
    post_id: "-123456_789",
    user_id: testUserId,
    win_date: new Date(),
    win_price: 1000,
    status: 'unpaid',
    shipping_batch_id: ''
  };
  
  // Удалим старые тестовые заказы
  const allOrders = getSheetData("Orders");
  allOrders.forEach(order => {
    if (String(order.data.user_id) === testUserId && order.data.lot_id === testLotId) {
      updateRow("Orders", order.rowIndex, { status: "test_deleted" });
    }
  });
  
  // Создадим новый тестовый заказ
  appendRow("Orders", testOrder);
  
  console.log("Тестовые данные созданы");
  
  // Тестируем различные сценарии
  
  // 1. Пустое сообщение
  console.log("\n--- Тест 1: Пустое сообщение ---");
  const emptyPayload = {
    object: {
      message: {
        from_id: testUserId,
        text: "",
        peer_id: testUserId
      }
    }
  };
  try {
    handleMessageNew(emptyPayload);
    console.log("handleMessageNew выполнена для пустого сообщения - OK");
  } catch (e) {
    console.log("Ошибка при обработке пустого сообщения:", e.message);
  }
  
  // 2. Сообщение с командой "АУКЦИОН"
  console.log("\n--- Тест 2: Команда АУКЦИОН ---");
  const auctionPayload = {
    object: {
      message: {
        from_id: testUserId,
        text: "АУКЦИОН",
        peer_id: testUserId
      }
    }
  };
  try {
    handleMessageNew(auctionPayload);
    console.log("handleMessageNew выполнена для команды АУКЦИОН - OK");
  } catch (e) {
    console.log("Ошибка при обработке команды АУКЦИОН:", e.message);
  }
  
  // 3. Сообщение с простым текстом (не информацией для доставки)
  console.log("\n--- Тест 3: Простой текст ---");
  const simpleTextPayload = {
    object: {
      message: {
        from_id: testUserId,
        text: "Просто какой-то текст без информации для доставки",
        peer_id: testUserId
      }
    }
  };
  try {
    handleMessageNew(simpleTextPayload);
    console.log("handleMessageNew выполнена для простого текста - OK");
  } catch (e) {
    console.log("Ошибка при обработке простого текста:", e.message);
  }
  
  // 4. Сообщение с потенциальной информацией для доставки
  console.log("\n--- Тест 4: Потенциальная информация для доставки ---");
  const shippingInfoPayload = {
    object: {
      message: {
        from_id: testUserId,
        text: "Иванов Иван Иванович, +79123456789, г. Москва, ул. Тестовая, д. 1, кв. 1",
        peer_id: testUserId
      }
    }
  };
  try {
    handleMessageNew(shippingInfoPayload);
    console.log("handleMessageNew выполнена для информации доставки - OK");
  } catch (e) {
    console.log("Ошибка при обработке информации доставки:", e.message);
  }
  
  console.log("\n=== Тестирование завершено ===");
}