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
    // Записываем в лист Журнал вместо Статистики
    var timestamp = new Date();
    var dataString = (typeof data === 'object') ? JSON.stringify(data) : String(data);
    
    // Используем существующую функцию log для записи в Журнал
    log("MONITORING", type, dataString);
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