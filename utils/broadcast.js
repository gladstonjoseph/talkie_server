// Store active connections
const activeUsers = new Map(); // userId → Map{appInstanceId → socketId}

// Helper function to broadcast message to all active app instances of a user
function broadcastToUser(io, userId, event, data) {
  const userDevices = activeUsers.get(userId);
  if (!userDevices || userDevices.size === 0) {
    console.log(`📡 No active devices found for user ${userId}`);
    return false;
  }
  
  let sentCount = 0;
  // Emit to all active devices for this user
  for (const [appInstanceId, socketId] of userDevices) {
    io.to(socketId).emit(event, data);
    sentCount++;
  }
  
  console.log(`📡 Broadcasted ${event} to ${sentCount} active app instances for user ${userId}`);
  return true;
}

// Register a new app instance connection
function registerConnection(userId, appInstanceId, socketId) {
  if (!activeUsers.has(userId)) {
    activeUsers.set(userId, new Map());
  }
  activeUsers.get(userId).set(appInstanceId, socketId);
  console.log(`✅ App instance ${appInstanceId} registered. Active instances: ${activeUsers.get(userId).size}`);
}

// Remove an app instance connection
function removeConnection(userId, appInstanceId) {
  if (userId && appInstanceId) {
    const userMap = activeUsers.get(userId);
    if (userMap) {
      userMap.delete(appInstanceId);
      console.log(`👥 Removed app instance ${appInstanceId} from active instances. User ${userId} now has ${userMap.size} active devices`);
      
      // Clean up empty user entry
      if (userMap.size === 0) {
        activeUsers.delete(userId);
        console.log(`🧹 Removed user ${userId} from active users (no more devices)`);
      }
    }
  }
}

// Get the activeUsers map (for debugging purposes)
function getActiveUsers() {
  return activeUsers;
}

module.exports = {
  broadcastToUser,
  registerConnection,
  removeConnection,
  getActiveUsers
};