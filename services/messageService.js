const db = require('../models/database');

class MessageService {
  constructor() {
    this.db = db;
  }

  // Reusable function to save message to database and notify recipients
  async saveAndSendMessage({
    sender_id,
    recipient_id,
    message,
    type = null,
    sender_local_message_id = null,
    primary_sender_id = null,
    primary_sender_local_message_id = null,
    primary_recipient_id = null,
    sender_timestamp = null,
    group_info = null,
    file_info = null,
    is_group_message = false,
    broadcastFunction = null
  }) {
    try {
      // Save message to database and get the ID
      const result = await this.db.createMessage({
        sender_id,
        recipient_id,
        message,
        sender_timestamp,
        type,
        sender_local_message_id,
        primary_sender_id,
        primary_sender_local_message_id,
        primary_recipient_id,
        group_info,
        file_info,
        is_group_message
      });

      // Get the complete message object from the database
      const savedMessage = result.rows[0];
      
      // Broadcast message to all active app instances of the recipient if broadcast function provided
      if (broadcastFunction) {
        broadcastFunction(recipient_id, "receive_message", savedMessage);
      }
      
      return savedMessage;
    } catch (err) {
      console.error('Error saving message to database:', err);
      throw err;
    }
  }

  async getUndeliveredMessages(userId) {
    try {
      console.log('Fetching undelivered messages for user:', userId);
      
      const result = await this.db.getUndeliveredMessages(userId);
      
      console.log(`Found ${result.rows.length} undelivered messages for user ${userId}`);
      
      return {
        status: 'success',
        messages: result.rows
      };
    } catch (error) {
      console.error('Error fetching messages:', error);
      return {
        status: 'error',
        message: 'Failed to fetch messages'
      };
    }
  }

  async updateDeliveryStatus(messageGlobalId, isDelivered, deliveryTimestamp, broadcastFunction = null) {
    try {
      const result = await this.db.updateMessageDeliveryStatus(messageGlobalId, isDelivered, deliveryTimestamp);

      if (result.rows.length > 0) {
        const senderId = result.rows[0].sender_id;
        
        // Broadcast delivery status update to all active app instances of the sender if broadcast function provided
        if (broadcastFunction) {
          broadcastFunction(senderId, 'delivery_status_update', {
            global_id: messageGlobalId,
            is_delivered: isDelivered,
            delivery_timestamp: deliveryTimestamp
          });
        }
        
        return {
          status: 'success',
          message: 'Delivery status updated successfully'
        };
      } else {
        return {
          status: 'error',
          message: 'Message not found'
        };
      }
    } catch (err) {
      console.error('Error updating delivery status:', err);
      return {
        status: 'error',
        message: 'Failed to update delivery status'
      };
    }
  }

  async updateReadStatus(messageGlobalId, isRead, readTimestamp, broadcastFunction = null) {
    try {
      const result = await this.db.updateMessageReadStatus(messageGlobalId, isRead, readTimestamp);

      if (result.rows.length > 0) {
        const senderId = result.rows[0].sender_id;
        
        // Broadcast read status update to all active app instances of the sender if broadcast function provided
        if (broadcastFunction) {
          broadcastFunction(senderId, 'read_status_update', {
            global_id: messageGlobalId,
            is_read: isRead,
            read_timestamp: readTimestamp
          });
        }
        
        return {
          status: 'success',
          message: 'Read status updated successfully'
        };
      } else {
        return {
          status: 'error',
          message: 'Message not found'
        };
      }
    } catch (err) {
      console.error('Error updating read status:', err);
      return {
        status: 'error',
        message: 'Failed to update read status'
      };
    }
  }

  async getDeliveryStatus(messageIds) {
    try {
      console.log('Fetching delivery status for messages:', messageIds);
      
      const result = await this.db.getMessageDeliveryStatus(messageIds);

      console.log(`Found delivery status for ${result.rows.length} messages`);
      
      return {
        status: 'success',
        statuses: result.rows
      };
    } catch (error) {
      console.error('Error fetching delivery status:', error);
      return {
        status: 'error',
        message: 'Failed to fetch delivery status'
      };
    }
  }

  async getReadStatus(messageIds) {
    try {
      console.log('Fetching read status for messages:', messageIds);
      
      const result = await this.db.getMessageReadStatus(messageIds);

      console.log(`Found read status for ${result.rows.length} messages`);
      
      return {
        status: 'success',
        statuses: result.rows
      };
    } catch (error) {
      console.error('Error fetching read status:', error);
      return {
        status: 'error',
        message: 'Failed to fetch read status'
      };
    }
  }
}

module.exports = new MessageService();