/**
 * @fileoverview Utility functions for retrieving logs from Google Sheets
 * This is a separate utility file, not part of the main production code
 */

/**
 * Get recent logs from the Logs sheet
 * @param {number} count - Number of recent log entries to retrieve
 * @returns {Array} Array of log entries sorted by date descending
 */
function getRecentLogs(count) {
  try {
    const logsSheet = getSheet('Logs');
    const data = logsSheet.getDataRange().getValues();
    
    if (data.length <= 1) return [];
    
    const headers = data[0];
    const logs = [];
    
    // Get last N rows (excluding header)
    const startRow = Math.max(1, data.length - count);
    
    for (let i = data.length - 1; i >= startRow; i--) {
      const row = data[i];
      const logEntry = {};
      headers.forEach((h, idx) => {
        logEntry[h] = row[idx];
      });
      logs.push(logEntry);
    }
    
    // Sort by date descending (newest first)
    logs.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA; // Descending order
    });
    
    return logs;
  } catch (e) {
    return [{ error: e.message }];
  }
}

/**
 * Export logs to JSON format
 * @param {number} count - Number of logs to export
 * @returns {string} JSON string of logs
 */
function exportLogsToJson(count) {
  const logs = getRecentLogs(count || 50);
  return JSON.stringify(logs, null, 2);
}

/**
 * Print logs to console (for manual debugging)
 * @param {number} count - Number of logs to print
 */
function printLogs(count) {
  const logs = getRecentLogs(count || 20);
  console.log('=== RECENT LOGS ===');
  logs.forEach((log, index) => {
    console.log(`${index + 1}. [${log.date}] ${log.type}: ${log.message}`);
    if (log.details) {
      console.log(`   Details: ${log.details}`);
    }
  });
  console.log('===================');
}
