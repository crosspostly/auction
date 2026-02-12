/**
 * @fileoverview Глобальный объект мониторинга.
 * Используем именованную функцию для гарантии инициализации (hoisting).
 */

/**
 * Записывает событие в лист "Статистика"
 * @param {string} type Тип события
 * @param {object|string} data Данные события
 */
function recordMonitoringEvent(type, data) {
  try {
    // Параметры листа
    var sheetName = 'Статистика';
    var header = ['Timestamp', 'EventType', 'Data'];
    
    // Получаем лист (функция getSheet находится в Sheets.gs)
    if (typeof getSheet !== 'function') return;
    
    var sheet = getSheet(sheetName, header);
    var timestamp = new Date();
    var dataString = (typeof data === 'object') ? JSON.stringify(data) : String(data);
    
    sheet.appendRow([timestamp, type, dataString]);
  } catch (e) {
    console.error('Monitoring Error: ' + e.message);
  }
}

// Создаем глобальный объект-обертку для совместимости с существующим кодом
var Monitoring = {
  recordEvent: function(type, data) {
    recordMonitoringEvent(type, data);
  }
};