const pool = require('../config/database');

const createUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `);
    console.log('Users table created successfully');
  } catch (err) {
    console.error('Error creating users table:', err);
  }
};

const createMessagesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages_new (
        id SERIAL PRIMARY KEY,
        type TEXT,
        sender_id INTEGER REFERENCES users(id),
        sender_local_message_id TEXT,
        recipient_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        sender_timestamp TIMESTAMP NOT NULL,
        primary_sender_id INTEGER REFERENCES users(id),
        primary_sender_local_message_id TEXT,
        primary_recipient_id INTEGER REFERENCES users(id),
        is_delivered BOOLEAN,
        delivery_timestamp TIMESTAMP,
        is_read BOOLEAN,
        read_timestamp TIMESTAMP
      );
    `);

    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      );
    `);

    if (tableExists.rows[0].exists) {
      await pool.query(`
        INSERT INTO messages_new (
          sender_id,
          recipient_id,
          message,
          sender_timestamp,
          is_delivered,
          delivery_timestamp,
          is_read,
          read_timestamp
        )
        SELECT 
          userId_from,
          userId_to,
          message,
          timestamp,
          isDelivered,
          delivery_timestamp,
          isRead,
          read_timestamp
        FROM messages;
      `);

      await pool.query('DROP TABLE messages;');
    }

    await pool.query('ALTER TABLE messages_new RENAME TO messages;');
    console.log('Messages table created/updated successfully');
  } catch (err) {
    console.error('Error creating/updating messages table:', err);
  }
};

const initializeTables = async () => {
  await createUsersTable();
  await createMessagesTable();
};

module.exports = { initializeTables }; 