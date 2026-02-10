/**
 * @fileoverview This is an independent monitoring script.
 * Its only purpose is to record key events into the "Статистика" sheet.
 * It is called from the main logic but does not affect it.
 */

const Monitoring = (function() {
  
  /**
   * Records a specific event to the 'Статистика' sheet.
   * @param {string} eventType - The name of the event (e.g., 'LOT_CREATED', 'BID_RECEIVED').
   * @param {object} data - A JSON object with details about the event.
   */
  function recordEvent(eventType, data) {
    try {
      // Ensure data is a string for the sheet
      const details = (typeof data === 'string') ? data : JSON.stringify(data, null, 2);
      
      appendRow("Statistics", {
        Timestamp: new Date(),
        EventType: eventType,
        Details: details
      });
      
    } catch (e) {
      // If monitoring fails, log it to the main log but don't stop the main process.
      logError('Monitoring_Failed', e, { eventType: eventType, data: data });
    }
  }

  return {
    recordEvent: recordEvent
  };
  
})();
