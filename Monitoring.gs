/**
 * @fileoverview Monitoring script for recording events and statistics.
 */

const MONITORING_SETTINGS = {
  sheetName: 'Статистика',
  header: ['Timestamp', 'EventType', 'Data']
};

/**
 * Records an event to the monitoring sheet.
 * @param {string} eventType - The type of event (e.g., 'SIMULATOR_START', 'BID_PLACED').
 * @param {object} data - A JSON object with event details.
 */
function recordEvent(eventType, data) {
  try {
    const sheet = getSheet(MONITORING_SETTINGS.sheetName, MONITORING_SETTINGS.header);
    const timestamp = new Date();
    const dataString = JSON.stringify(data);
    sheet.appendRow([timestamp, eventType, dataString]);
  } catch (e) {
    Logger.log(`Failed to record event: ${e.message}`);
  }
}
