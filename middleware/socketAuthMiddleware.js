const jwt = require("jsonwebtoken");
const db = require('../models/database');

// Socket.IO JWT Authentication Middleware
const socketAuthMiddleware = async (socket, next) => {
  console.log(`🔐 Authentication attempt from ${socket.id} at ${new Date().toISOString()}`);
  
  const authHeader = socket.handshake.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log(`❌ Authentication failed for ${socket.id}: No Bearer token provided`);
    return next(new Error('Authentication error: No Bearer token provided'));
  }

  const token = authHeader.substring(7, authHeader.length);
  console.log(`🔑 Token received for ${socket.id}: ${token.substring(0, 20)}...`);

  // Decode JWT payload before verification to extract app instance ID and user ID
  // This allows us to do all validations before expensive JWT verification
  const payload = jwt.decode(token);
  const appInstanceId = payload?.appInstanceId;
  const tokenUserId = payload?.userId;
  
  console.log(`🔍 Decoded from token: App Instance ID: ${appInstanceId}, User ID: ${tokenUserId}`);

  // Combined Step 1 & 2: Check app instance timing and user validation with single query
  if (appInstanceId && tokenUserId) {
    try {
      console.log(`🔍 Validating app instance ${appInstanceId} and timing check with single query`);
      
      const appInstanceResult = await db.findAppInstanceById(appInstanceId);
      
      if (appInstanceResult.rows.length === 0) {
        console.log(`❌ Authentication failed for ${socket.id}: App instance ${appInstanceId} not found in database`);
        return next(new Error('APP_INSTANCE_NOT_FOUND'));
      }
      
      const appInstance = appInstanceResult.rows[0];
      const dbUserId = appInstance.global_user_id;
      const lastConnected = appInstance.last_connected;
      
      // Check timing first (before user validation)
      if (lastConnected !== null) {
        const now = new Date();
        const lastConnectedDate = new Date(lastConnected);
        const timeDifferenceMs = now.getTime() - lastConnectedDate.getTime();
        const timeDifferenceSeconds = timeDifferenceMs / 1000;
        
        console.log(`🕐 App instance ${appInstanceId} last connected ${timeDifferenceSeconds.toFixed(1)} seconds ago`);
        
        if (timeDifferenceSeconds > 30)  // (13 * 24 * 60 * 60)) { // 30 seconds in seconds
          console.log(`❌ Authentication failed for ${socket.id}: App instance ${appInstanceId} last connected more than 13 days ago - skipping JWT verification`);
          
          // Delete the stale app instance from the database
          await db.deleteAppInstanceById(appInstanceId);
          console.log(`🧹 Deleted stale app instance: ${appInstanceId} (last connected > 13 days ago)`);
          
          return next(new Error('APP_INSTANCE_INACTIVE'));
        }
      } else {
        console.log(`🆕 App instance ${appInstanceId} is connecting for the first time (last_connected is NULL)`);
      }
      
      // Check user ownership
      if (dbUserId !== tokenUserId) {
        console.log(`❌ Authentication failed for ${socket.id}: App instance ${appInstanceId} belongs to user ${dbUserId}, but JWT claims user ${tokenUserId}`);
        return next(new Error('APP_INSTANCE_USER_MISMATCH'));
      }
      
      console.log(`✅ App instance validation successful for ${socket.id}: App instance ${appInstanceId} belongs to user ${tokenUserId} and timing is valid`);
      
    } catch (dbError) {
      console.error(`❌ Database error during app instance validation for ${socket.id}:`, dbError);
      return next(new Error('APP_INSTANCE_VALIDATION_ERROR'));
    }
  }

  // Final Step: Verify JWT (only after all other validations pass)
  console.log(`🔑 All validations passed - proceeding with JWT verification for ${socket.id}`);
  jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_key_that_should_be_long_and_random', async (err, decoded) => {
    if (err) {
      console.log(`❌ Authentication failed for ${socket.id}: Invalid token - ${err.message}`);
      
      // Clean up expired/invalid app instance from database
      if (appInstanceId) {
        try {
          const deleteResult = await db.deleteAppInstanceById(appInstanceId);
          
          if (deleteResult.rowCount > 0) {
            console.log(`🧹 Cleaned up expired app instance: ${appInstanceId}`);
          } else {
            console.log(`ℹ️ App instance ${appInstanceId} was not found in database (already cleaned up)`);
          }
        } catch (dbError) {
          console.error(`❌ Error cleaning up app instance ${appInstanceId}:`, dbError);
        }
      }
      
      return next(new Error('Authentication error: Invalid token'));
    }
    
    try {
      // Update last_connected and allow connection
      await db.updateAppInstanceLastConnected(decoded.appInstanceId);
      console.log(`📅 Updated last_connected timestamp for app instance ${decoded.appInstanceId} - connection allowed`);
      
      socket.userId = decoded.userId; // Attach userId to the socket object
      socket.appInstanceId = decoded.appInstanceId; // Attach appInstanceId to the socket object
      console.log(`✅ Authentication successful for ${socket.id}: User ${socket.userId}, App Instance ${socket.appInstanceId}`);
      next();
      
    } catch (dbError) {
      console.error(`❌ Database error during final update for ${socket.id}:`, dbError);
      return next(new Error('APP_INSTANCE_VALIDATION_ERROR'));
    }
  });
};

module.exports = {
  socketAuthMiddleware
};