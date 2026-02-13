/**
 * @fileoverview Глобальный объект мониторинга.
 * Перенаправляет события системного мониторинга в общий Журнал.
 */

/**
 * Записывает событие мониторинга в общий Журнал
 * @param {string} type Тип события
 * @param {object|string} data Данные события
 */
function recordMonitoringEvent(type, data) {
  try {
    var dataString = (typeof data === 'object') ? JSON.stringify(data) : String(data);
    
    // Записываем в Журнал под типом MONITORING
    // Если дебаг-режим выключен, некоторые события мониторинга можно подавлять здесь,
    // но сейчас мы пишем всё для обеспечения полной прослеживаемости.
    log("MONITORING", type, dataString);
  } catch (e) {
    console.error('Monitoring Error: ' + e.message);
  }
}

// Глобальный объект для совместимости с кодом
var Monitoring = {
  recordEvent: function(type, data) {
    recordMonitoringEvent(type, data);
  }
};