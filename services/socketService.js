const messageService = require('./messageService');
const userService = require('./userService');
const { broadcastToUser, registerConnection, removeConnection } = require('../utils/broadcast');

class SocketService {
  constructor(io) {
    this.io = io;
    this.broadcastToUser = (userId, event, data) => broadcastToUser(io, userId, event, data);
  }

  handleConnection(socket) {
    console.log(`🟢 User connected: ${socket.id} with user ID: ${socket.userId}, App Instance: ${socket.appInstanceId} at ${new Date().toISOString()}`);

    // Immediately register app instance from JWT
    if (socket.appInstanceId) {
      registerConnection(socket.userId, socket.appInstanceId, socket.id);
    } else {
      console.log(`❌ No app instance ID in JWT for socket ${socket.id}`);
      socket.disconnect();
      return;
    }

    // Set up all event handlers
    this.setupEventHandlers(socket);
  }

  setupEventHandlers(socket) {
    // When a user disconnects, remove them from the active app instances map
    socket.on('disconnect', (reason) => {
      console.log(`🔴 User disconnected: ${socket.id} (User ${socket.userId}, App Instance ${socket.appInstanceId}) at ${new Date().toISOString()}`);
      console.log(`🔴 Disconnect reason: ${reason}`);
      
      removeConnection(socket.userId, socket.appInstanceId);
    });

    // Get messages handler
    socket.on("get_messages", async (global_user_id, ack) => {
      const result = await messageService.getUndeliveredMessages(global_user_id);
      ack(result);
    });

    // Send message handler
    socket.on("send_message", async ({ sender_id, recipient_id, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null, sender_timestamp = null, file_info = null, is_group_message = false }, callback) => {
      try {
        // Use the reusable function to save and send the message
        const savedMessage = await messageService.saveAndSendMessage({
          sender_id,
          recipient_id,
          message,
          type,
          sender_local_message_id,
          primary_sender_id,
          primary_sender_local_message_id,
          primary_recipient_id,
          sender_timestamp,
          file_info,
          is_group_message,
          broadcastFunction: this.broadcastToUser
        });

        // Send acknowledgment back to sender with the message ID
        if (callback) {
          callback({ 
            global_message_id: savedMessage.id,
            sender_local_message_id: savedMessage.sender_local_message_id 
          });
        }
      } catch (err) {
        console.error('Error in send_message:', err);
        socket.emit("message_error", { error: 'Error saving message' });
      }
    });

    // Handle group messages
    socket.on("send_group_message", async ({ sender_id, recipient_ids, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null, sender_timestamp = null, group_info = null, file_info = null, is_group_message = true }, callback) => {
      try {
        // Validate that recipient_ids is an array
        if (!Array.isArray(recipient_ids) || recipient_ids.length === 0) {
          socket.emit("message_error", { error: 'recipient_ids must be a non-empty array' });
          return;
        }

        // Object to store mapping between sender_local_message_id and global_message_id
        const message_id_mapping = {};
        
        // For each recipient, create a message entry in the database
        for (const recipient_id of recipient_ids) {
          // Use the reusable function to save and send the message
          const savedMessage = await messageService.saveAndSendMessage({
            sender_id,
            recipient_id,
            message,
            type,
            sender_local_message_id,
            primary_sender_id,
            primary_sender_local_message_id,
            primary_recipient_id,
            sender_timestamp,
            group_info,
            file_info,
            is_group_message,
            broadcastFunction: this.broadcastToUser
          });

          // Store the mapping with recipient_id to handle multiple recipients
          if (!message_id_mapping[recipient_id]) {
            message_id_mapping[recipient_id] = {};
          }
          message_id_mapping[recipient_id][sender_local_message_id] = savedMessage.id;
        }

        // Send acknowledgment back to sender with the message ID mapping
        if (callback) {
          callback({ 
            message_id_mapping
          });
        }
      } catch (err) {
        console.error('Error saving group message to database:', err);
        socket.emit("message_error", { error: 'Error saving group message' });
      }
    });

    // Search users handler
    socket.on("search_users", async (query, callback) => {
      const result = await userService.searchUsers(query);
      callback(result);
    });

    // Set delivery status handler
    socket.on("set_delivery_status", async (data, callback) => {
      const { message_global_id, is_delivered, delivery_timestamp } = data;
      const result = await messageService.updateDeliveryStatus(message_global_id, is_delivered, delivery_timestamp, this.broadcastToUser);
      
      if (callback) {
        callback(result);
      }
    });

    // Set read status handler
    socket.on("set_read_status", async (data, callback) => {
      const { message_global_id, is_read, read_timestamp } = data;
      const result = await messageService.updateReadStatus(message_global_id, is_read, read_timestamp, this.broadcastToUser);
      
      if (callback) {
        callback(result);
      }
    });

    // Get delivery status handler
    socket.on("get_delivery_status", async (message_ids, callback) => {
      const result = await messageService.getDeliveryStatus(message_ids);
      
      if (callback) {
        callback(result);
      }
    });

    // Get read status handler
    socket.on("get_read_status", async (message_ids, callback) => {
      const result = await messageService.getReadStatus(message_ids);
      
      if (callback) {
        callback(result);
      }
    });

    // Handle profile picture URL updates
    socket.on("user_profile_update", async (data, callback) => {
      const { global_user_id, profilePictureUrl } = data;
      const result = await userService.updateUserProfile(global_user_id, profilePictureUrl);
      callback(result);
    });

    // Handle user profile fetch requests
    socket.on("get_user_profile", async (global_user_id, callback) => {
      const result = await userService.getUserProfile(global_user_id);
      callback(result);
    });

    // Handle app instance deletion
    socket.on("delete_app_instance", async (app_instance_id, callback) => {
      const result = await userService.deleteAppInstance(socket.userId, app_instance_id);
      callback(result);
    });
  }
}

module.exports = SocketService;