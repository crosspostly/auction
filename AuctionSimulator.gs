/**
 * @fileoverview Auction Simulator V4: Hard Stress Test.
 * Publishes 4 lots and runs 6 diverse scenarios per lot (24 comments total).
 * Verifies bot responses and final results.
 */

/**
 * TASK 1: CLEANUP AND HEADER VERIFICATION
 * Clears all operational data while preserving settings.
 * Ensures headers are correct across all sheets.
 */
function prepareForStressTest() {
  console.log("🧹 Starting Global Cleanup...");
  
  const sheetsToClear = [
    "Config",            // Лоты
    "Bids",              // Ставки
    "Users",             // Пользователи
    "Orders",            // Заказы
    "EventQueue",        // Очередь событий
    "NotificationQueue", // Очередь (уведомления)
    "Incoming",          // Входящие
    "Logs"               // Журнал
  ];

  sheetsToClear.forEach(sheetKey => {
    try {
      const config = SHEETS[sheetKey];
      const sheet = getSheet(sheetKey);
      
      // 1. Clear all contents
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, config.headers.length)).clearContent();
      }
      
      // 2. Enforce Headers (V3.2 logic)
      ensureHeaders(sheet, config.headers);
      
      console.log(`✅ Sheet "${config.name}" cleared and verified.`);
    } catch (e) {
      console.error(`❌ Error cleaning sheet ${sheetKey}: ${e.message}`);
    }
  });

  // Clear Cache to avoid idempotency issues during test
  CacheService.getScriptCache().removeAll(["settings"]);
  _settings_mem_cache = null; // Reset settings memory cache
  _sheet_data_mem_cache = {}; // Reset memory cache
  _headers_verified = {};    // Reset header verification cache
  console.log("🏁 Cleanup complete. Ready for simulation.");
}

function runFullAuctionSimulation() {
  console.log("🚀 Starting V4 Stress Test (Live Mode)...");
  
  // 1. Cleanup and Prepare
  prepareForStressTest();
  const settings = getSettings();
  const groupId = getVkGroupId();
  const adminToken = getVkToken(true); // USER_TOKEN
  
  if (!adminToken) {
    console.error("⛔ ERROR: USER_TOKEN is missing.");
    return;
  }

  // Ensure Test Mode is ON for fast 5-min finalization
  if (getSetting('test_mode_enabled') !== 'ВКЛ') {
    console.warn("⚠️ Warning: test_mode_enabled is OFF. Testing manually.");
  }

  const imageLink = "https://sun9-79.userapi.com/s/v1/ig2/KWGWBq-Zn2CW37VRrJhf8mbSGKjN-m7K6iDczw4d0-MWWNUAGvK-fqMeD3p3i4lzDsdyqeLdHSej32xfJEx3m9NJ.jpg?quality=96&as=32x32,48x48,72x72,108x108,160x160,240x240,360x360,480x480,540x540,640x640,720x720,1080x1080,1280x1280&from=bu&u=sI9TNqXkSqWq4S_LeGyCiV2N6HrNrrSzXCzPZLqANII&cs=640x0";

  const lotTemplate = (num) => `#аукцион@dndpotustoronu №${2000 + num}
При поддержке GABRIGAME-WORKSHOP!
Дедлайн 20.02.2026 в 21:00 по МСК!
🎁Лот - Тестовая фигурка #${num} (Стресс-тест)

👀Старт 200р и шаг - 50р.
Каждая миниатюра аукциона масштабом 32-35мм.
Дата окончания аукциона 20.02.2026 (суббота) в 21:00 по Москве.

После аукциона пиши ТОЛЬКО в ЛС группы.
Оплата на карту в течение 3 дней после победы. ${imageLink}`;

  const publishedLots = [];

  // 2. Publish 4 Lots to VK
  console.log("📤 Publishing 4 real lots to VK...");
  for (let i = 1; i <= 4; i++) {
    const message = lotTemplate(i);
    const res = callVk("wall.post", { owner_id: "-" + groupId, from_group: 1, message: message }, adminToken);

    if (res?.response?.post_id) {
      const vkId = res.response.post_id;
      publishedLots.push({ num: 2000+i, vkId: vkId, postKey: `-${groupId}_${vkId}` });
      console.log(`✅ Lot #${2000+i} posted to VK (ID: ${vkId}). Bot will process via Callback.`);
      
      // DELETED: manual handleWallPostNew call. Let Callback API handle it.
    }
    Utilities.sleep(1000); // 1.0s wait for VK to send Callback
  }

  // 3. Run 6 Scenarios PER LOT (24 comments total)
  console.log("\n💬 Starting Massive Bidding (6 per lot)...");
  
  const scenarios = [
    { bid: "100", label: "Too low (Start 200)" },
    { bid: "200", label: "Valid First Bid" },
    { bid: "210", label: "Invalid Step" },
    { bid: "250", label: "Valid Outbid" },
    { bid: "250", label: "Duplicate (Same User/Price)" },
    { bid: "10000000", label: "Over Max Bid" }
  ];

  publishedLots.forEach(lot => {
    console.log(`\n--- Testing Lot #${lot.num} ---`);
    scenarios.forEach((sc, idx) => {
      console.log(`🗯 [Step ${idx+1}] User -> ${sc.bid} (${sc.label})`);
      
      const res = callVk("wall.createComment", { owner_id: "-" + groupId, post_id: lot.vkId, message: sc.bid }, adminToken);
      
      if (res?.response?.comment_id) {
        console.log(`✅ Comment ${res.response.comment_id} created. Bot will process via Callback.`);
        // DELETED: manual handleWallReplyNew call. Let Callback API handle it.
      }
      Utilities.sleep(500); // 0.5s wait for VK to send Callback
    });
  });

  console.log("\n📊 Verification Phase...");
  Utilities.sleep(1000); // 1s instead of 3s
  
  const bids = getSheetData("Bids");
  console.log(`📝 Total bids in sheet: ${bids.length}`);
  
  const leaders = bids.filter(b => b.data.status === "лидер").length;
  console.log(`👑 Current Leaders identified: ${leaders} / 4`);

  const errors = bids.filter(b => b.data.status === "некорректная").length;
  console.log(`❌ Rejected bids recorded: ${errors}`);

  console.log("\n🏁 Stress Test Part 1 (Bidding) Finished.");
  console.log("WAIT 5 MINUTES for Test Finalization to run and check your DMs.");
}
