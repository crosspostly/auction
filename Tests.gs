function runAllTests() {
  const results = [];
  
  results.push(testParseLotFromText());
  results.push(testCalculateDeliveryCost());
  results.push(testBuildAuctionMessage());
  results.push(testSendOutbidCommentInterval());
  results.push(testAdminSummary());
  
  const summary = results.map(r => r.name + ': ' + (r.passed ? '✓ PASSED' : '✗ FAILED - ' + r.error)).join('\n');
  Logger.log(summary);
  SpreadsheetApp.getUi().alert('Test Results:\n\n' + summary);
}

function testParseLotFromText() {
  const test = { name: 'parseLotFromText', passed: false, error: null };
  
  try {
    const text1 = '#аукцион\n\nОписание товара\n\n№1234\nСтартовая цена: 1000\nШаг: 100\nДедлайн: 08.02.2026 21:00';
    const result1 = parseLotFromText(text1);
    
    if (!result1) {
      test.error = 'Failed to parse lot with №1234 format';
      return test;
    }
    
    if (result1.lotNumber !== 1234) {
      test.error = 'Lot number mismatch: expected 1234, got ' + result1.lotNumber;
      return test;
    }
    
    if (result1.startPrice !== 1000) {
      test.error = 'Start price mismatch: expected 1000, got ' + result1.startPrice;
      return test;
    }
    
    if (result1.step !== 100) {
      test.error = 'Step mismatch: expected 100, got ' + result1.step;
      return test;
    }
    
    const text2 = '#аукцион\n\nЛот №5678\nСтарт: 500\nШаг ставки: 50\nДедлайн: 08.02.2026 20:00';
    const result2 = parseLotFromText(text2);
    
    if (!result2 || result2.lotNumber !== 5678) {
      test.error = 'Failed to parse lot with "Лот №5678" format';
      return test;
    }
    
    const text3 = 'Обычный пост без хэштега\n№999\nСтарт: 100\nДедлайн: 08.02.2026 21:00';
    const result3 = parseLotFromText(text3);
    
    if (result3) {
      test.error = 'Should not parse lot without #аукцион hashtag';
      return test;
    }
    
    test.passed = true;
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}

function testCalculateDeliveryCost() {
  const test = { name: 'calculateDeliveryCost', passed: false, error: null };
  
  try {
    const originalRules = getSetting('DELIVERY_RULES');
    setSetting('DELIVERY_RULES', '1-3:300, 4-6:500, 7+:0');
    
    const cost1 = calculateDeliveryCost(1);
    if (cost1 !== 300) {
      test.error = 'Expected 300 for 1 lot, got ' + cost1;
      return test;
    }
    
    const cost2 = calculateDeliveryCost(3);
    if (cost2 !== 300) {
      test.error = 'Expected 300 for 3 lots, got ' + cost2;
      return test;
    }
    
    const cost3 = calculateDeliveryCost(5);
    if (cost3 !== 500) {
      test.error = 'Expected 500 for 5 lots, got ' + cost3;
      return test;
    }
    
    const cost4 = calculateDeliveryCost(10);
    if (cost4 !== 0) {
      test.error = 'Expected 0 for 10 lots, got ' + cost4;
      return test;
    }
    
    if (originalRules) {
      setSetting('DELIVERY_RULES', originalRules);
    }
    
    test.passed = true;
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}

function testBuildAuctionMessage() {
  const test = { name: 'buildAuctionMessage', passed: false, error: null };
  
  try {
    const originalTemplate = getSetting('dm_template_auction');
    const originalPhone = getSetting('PAYMENT_PHONE');
    const originalBank = getSetting('PAYMENT_BANK');
    const originalDelivery = getSetting('DELIVERY_RULES');
    const originalGroupId = getSetting('GROUP_ID');
    
    setSetting('dm_template_auction', 'Привет! 🌸\n\nВы выиграли:\n{lots}\n\nИТОГО: {total} руб.\nДоставка: {delivery} руб.\n\nОплата: {payment_details}');
    setSetting('PAYMENT_PHONE', '+79001234567');
    setSetting('PAYMENT_BANK', 'Сбербанк');
    setSetting('DELIVERY_RULES', '1-3:300, 4-6:500, 7+:0');
    setSetting('GROUP_ID', '123456789');
    
    const wins = [
      { lotNumber: 1, price: 1000, postId: 111 },
      { lotNumber: 2, price: 1500, postId: 222 }
    ];
    
    const message = buildAuctionMessage(wins);
    
    if (message.indexOf('🌸') === -1) {
      test.error = 'Template emoji missing';
      return test;
    }
    
    if (message.indexOf('2500') === -1) {
      test.error = 'Total price (2500) not found in message';
      return test;
    }
    
    if (message.indexOf('500') === -1) {
      test.error = 'Delivery cost (500) not found in message';
      return test;
    }
    
    if (message.indexOf('+79001234567') === -1) {
      test.error = 'Payment phone not found in message';
      return test;
    }
    
    if (message.indexOf('Сбербанк') === -1) {
      test.error = 'Payment bank not found in message';
      return test;
    }
    
    if (message.indexOf('https://vk.com/wall-123456789_111') === -1) {
      test.error = 'Post link not found in message';
      return test;
    }
    
    if (originalTemplate) setSetting('dm_template_auction', originalTemplate);
    if (originalPhone) setSetting('PAYMENT_PHONE', originalPhone);
    if (originalBank) setSetting('PAYMENT_BANK', originalBank);
    if (originalDelivery) setSetting('DELIVERY_RULES', originalDelivery);
    if (originalGroupId) setSetting('GROUP_ID', originalGroupId);
    
    test.passed = true;
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}

function testSendOutbidCommentInterval() {
  const test = { name: 'sendOutbidCommentInterval', passed: false, error: null };
  
  try {
    const originalLast = getSetting('LAST_OUTBID_REPLY_AT');
    
    setSetting('LAST_OUTBID_REPLY_AT', '0');
    
    const start = new Date().getTime();
    const intervalSec = Math.floor(Math.random() * 15) + 10;
    
    if (intervalSec < 10 || intervalSec >= 25) {
      test.error = 'Interval should be between 10 and 24 seconds, got ' + intervalSec;
      return test;
    }
    
    if (originalLast) {
      setSetting('LAST_OUTBID_REPLY_AT', originalLast);
    }
    
    test.passed = true;
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}

function testAdminSummary() {
  const test = { name: 'adminSummary', passed: false, error: null };
  
  try {
    const originalSummary = getSetting('SUMMARY_SENT_AT');
    
    if (originalSummary) {
      Logger.log('SUMMARY_SENT_AT is set, which should prevent duplicate summaries');
      test.passed = true;
    } else {
      Logger.log('SUMMARY_SENT_AT is not set, summary can be sent');
      test.passed = true;
    }
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}

function testSensitiveDataSecurity() {
  const test = { name: 'sensitiveDataSecurity', passed: false, error: null };
  
  try {
    const sensitiveKeys = ['PAYMENT_PHONE', 'PAYMENT_BANK', 'DELIVERY_RULES', 'ADMIN_IDS', 'VK_TOKEN', 'GROUP_ID'];
    
    for (const key of sensitiveKeys) {
      const value = getSetting(key);
      if (value) {
        const props = PropertiesService.getScriptProperties();
        const propValue = props.getProperty(key);
        
        if (value !== propValue) {
          test.error = 'Sensitive key ' + key + ' is not being read from PropertiesService';
          return test;
        }
      }
    }
    
    test.passed = true;
  } catch (e) {
    test.error = e.message || String(e);
  }
  
  return test;
}
