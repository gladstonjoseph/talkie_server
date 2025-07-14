const { pool } = require('../config/database');

class DatabaseModel {
  constructor() {
    this.pool = pool;
  }

  // User-related database operations
  async createUser(name, email, hashedPassword) {
    return await this.pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
      [name, email, hashedPassword]
    );
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  async findUserById(id) {
    const result = await this.pool.query(
      'SELECT id, name, email, profile_picture_url FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  async updateUserProfilePicture(userId, profilePictureUrl) {
    return await this.pool.query(
      'UPDATE users SET profile_picture_url = $1 WHERE id = $2 RETURNING id',
      [profilePictureUrl, userId]
    );
  }

  async searchUsers(query) {
    return await this.pool.query(
      'SELECT id, name, email FROM users WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)',
      [`%${query}%`]
    );
  }

  // App instance-related database operations
  async createAppInstance(userId, appInstanceId) {
    return await this.pool.query(
      'INSERT INTO app_instances (global_user_id, app_instance_id) VALUES ($1, $2)',
      [userId, appInstanceId]
    );
  }

  async findAppInstanceById(appInstanceId) {
    return await this.pool.query(
      'SELECT global_user_id, last_connected FROM app_instances WHERE app_instance_id = $1',
      [appInstanceId]
    );
  }

  async updateAppInstanceLastConnected(appInstanceId) {
    return await this.pool.query(
      'UPDATE app_instances SET last_connected = NOW() WHERE app_instance_id = $1',
      [appInstanceId]
    );
  }

  async deleteAppInstance(userId, appInstanceId) {
    return await this.pool.query(
      'DELETE FROM app_instances WHERE global_user_id = $1 AND app_instance_id = $2 RETURNING id',
      [userId, appInstanceId]
    );
  }

  async deleteAppInstanceById(appInstanceId) {
    return await this.pool.query(
      'DELETE FROM app_instances WHERE app_instance_id = $1',
      [appInstanceId]
    );
  }

  // Message-related database operations
  async createMessage({
    sender_id,
    recipient_id,
    message,
    sender_timestamp,
    type = null,
    sender_local_message_id = null,
    primary_sender_id = null,
    primary_sender_local_message_id = null,
    primary_recipient_id = null,
    group_info = null,
    file_info = null,
    is_group_message = false
  }) {
    return await this.pool.query(
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
        read_timestamp,
        group_info,
        file_info,
        is_group_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
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
        null,
        group_info,
        file_info,
        is_group_message
      ]
    );
  }

  async getUndeliveredMessages(userId) {
    return await this.pool.query(`
      SELECT * FROM messages 
      WHERE recipient_id = $1 
      AND (is_delivered = false OR is_delivered IS NULL)
      ORDER BY sender_timestamp ASC
    `, [userId]);
  }

  async updateMessageDeliveryStatus(messageId, isDelivered, deliveryTimestamp) {
    return await this.pool.query(
      'UPDATE messages SET is_delivered = $1, delivery_timestamp = $2 WHERE id = $3 RETURNING sender_id',
      [isDelivered, deliveryTimestamp, messageId]
    );
  }

  async updateMessageReadStatus(messageId, isRead, readTimestamp) {
    return await this.pool.query(
      'UPDATE messages SET is_read = $1, read_timestamp = $2 WHERE id = $3 RETURNING sender_id',
      [isRead, readTimestamp, messageId]
    );
  }

  async getMessageDeliveryStatus(messageIds) {
    return await this.pool.query(`
      SELECT 
        id as message_global_id,
        is_delivered,
        delivery_timestamp
      FROM messages 
      WHERE id = ANY($1)
    `, [messageIds]);
  }

  async getMessageReadStatus(messageIds) {
    return await this.pool.query(`
      SELECT 
        id as message_global_id,
        is_read,
        read_timestamp
      FROM messages 
      WHERE id = ANY($1)
    `, [messageIds]);
  }
}

module.exports = new DatabaseModel();