const pool = require('../config/database');

// Store active connections
const activeUsers = new Map();

const setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log('New client connected');

    socket.on("register", (userId) => {
      console.log('User registered:', userId);
      socket.userId = userId;
      activeUsers.set(userId, socket.id);
    });

    socket.on("send_message", async ({ sender_id, recipient_id, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null }, callback) => {
      const recipientSocketId = activeUsers.get(recipient_id);
      const sender_timestamp = new Date().toISOString();
      
      try {
        const result = await pool.query(
          `INSERT INTO messages (
            sender_id,
            recipient_id,
            message,
            sender_timestamp,
            type,
            sender_local_message_id,
            primary_sender_id,
            primary_sender_local_message_id,
            primary_recipient_id,
            is_delivered,
            delivery_timestamp,
            is_read,
            read_timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [
            sender_id,
            recipient_id,
            message,
            sender_timestamp,
            type,
            sender_local_message_id,
            primary_sender_id,
            primary_sender_local_message_id,
            primary_recipient_id,
            null,
            null,
            null,
            null
          ]
        );

        const messageId = result.rows[0].id;

        if (callback) {
          callback({ 
            messageId,
            sender_local_message_id: sender_local_message_id 
          });
        }

        if (recipientSocketId) {
          io.to(recipientSocketId).emit("receive_message", { 
            id: messageId,
            sender_id,
            recipient_id,
            message,
            sender_timestamp,
            type,
            sender_local_message_id,
            primary_sender_id,
            primary_sender_local_message_id,
            primary_recipient_id
          });
        } else {
          socket.emit("message_not_delivered", { 
            id: messageId,
            recipient_id, 
            message 
          });
        }
      } catch (err) {
        console.error('Error saving message to database:', err);
        socket.emit("message_error", { error: 'Error saving message' });
      }
    });

    socket.on("search_users", async (query) => {
      try {
        if (!query) {
          socket.emit("search_users_result", []);
          return;
        }

        const result = await pool.query(
          'SELECT id, name, email FROM users WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)',
          [`%${query}%`]
        );

        socket.emit("search_users_result", result.rows);
      } catch (err) {
        console.error('Error searching users via WebSocket:', err);
        socket.emit("search_users_error", { error: 'Error searching users' });
      }
    });

    socket.on("set_delivery_status", async (data) => {
      try {
        const { message_global_id, is_delivered, delivery_timestamp } = data;

        const result = await pool.query(
          'UPDATE messages SET is_delivered = $1, delivery_timestamp = $2 WHERE id = $3 RETURNING sender_id',
          [is_delivered, delivery_timestamp, message_global_id]
        );

        if (result.rows.length > 0) {
          const senderId = result.rows[0].sender_id;
          const senderSocketId = activeUsers.get(senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('delivery_status_update', {
              global_id: message_global_id,
              is_delivered,
              delivery_timestamp
            });
          }
        }
      } catch (err) {
        console.error('Error updating delivery status:', err);
      }
    });

    socket.on("set_read_status", async (data) => {
      try {
        const { message_global_id, is_read, read_timestamp } = data;

        const result = await pool.query(
          'UPDATE messages SET is_read = $1, read_timestamp = $2 WHERE id = $3 RETURNING sender_id',
          [is_read, read_timestamp, message_global_id]
        );

        if (result.rows.length > 0) {
          const senderId = result.rows[0].sender_id;
          const senderSocketId = activeUsers.get(senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('read_status_update', {
              global_id: message_global_id,
              is_read,
              read_timestamp
            });
          }
        }
      } catch (err) {
        console.error('Error updating read status:', err);
      }
    });

    socket.on("disconnect", () => {
      if (socket.userId) {
        activeUsers.delete(socket.userId);
      }
      console.log('Client disconnected');
    });
  });
};

module.exports = setupSocketHandlers; 