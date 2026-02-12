/**
 * Test function to verify notification deduplication works correctly
 */
function testNotificationDeduplication() {
  try {
    console.log("Testing notification deduplication...");
    
    // Create a test notification
    const testNotification = {
      user_id: "123456789",
      type: "winner",
      payload: {
        lot_id: "TEST123",
        lot_name: "Test Lot",
        price: 1000
      }
    };
    
    // Clear previous test notifications for this user
    const allNotifications = getSheetData("NotificationQueue");
    allNotifications.forEach(row => {
      if (String(row.data.user_id) === "123456789" && 
          row.data.type === "winner" &&
          row.data.payload.includes("TEST123")) {
        updateRow("NotificationQueue", row.rowIndex, { status: "test_cleanup" });
      }
    });
    
    // Queue the same notification twice
    console.log("Queuing first notification...");
    queueNotification(testNotification);
    
    console.log("Queuing second identical notification...");
    queueNotification(testNotification);
    
    // Check the notification queue
    const notifications = getSheetData("NotificationQueue");
    const userNotifications = notifications.filter(n => 
      String(n.data.user_id) === "123456789" && 
      n.data.type === "winner" &&
      n.data.payload.includes("TEST123") &&
      n.data.status !== "test_cleanup"
    );
    
    console.log(`Found ${userNotifications.length} notifications for test user`);
    
    if (userNotifications.length <= 1) {
      console.log("✅ SUCCESS: Duplicate notification was prevented!");
      return true;
    } else {
      console.log("❌ FAILURE: Duplicate notification was not prevented!");
      return false;
    }
  } catch (error) {
    console.log("❌ ERROR in test: " + error.message);
    return false;
  }
}