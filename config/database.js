const { Pool } = require("pg");

// PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://pyne_db_fuuf_user:SqPEaOQnvhdNy1ruLTnMcBA7KmGT3ohH@dpg-d3vvv0s9c44c73a8roq0-a/pyne_db_fuuf",
  ssl: {
    rejectUnauthorized: false
  }
});

// Database configuration
const FLUSH_DATABASE_ON_START = false; // Set this to true to flush the database before initialization

// Function to drop all tables
const dropAllTables = async () => {
  try {
    // Drop tables in correct order (messages depends on users)
    await pool.query('DROP TABLE IF EXISTS app_instances CASCADE');
    await pool.query('DROP TABLE IF EXISTS messages CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('All tables dropped successfully');
  } catch (err) {
    console.error('Error dropping tables:', err);
    throw err;
  }
};

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Connected to database successfully');
    release();
  }
});

// Create users table if it doesn't exist
const createUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        profile_picture_url TEXT
      );
    `);
    console.log('Users table created successfully');
  } catch (err) {
    console.error('Error creating users table:', err);
    throw err; // Propagate the error
  }
};

// Create messages table if it doesn't exist
const createMessagesTable = async () => {
  try {
    // Create the table with VARCHAR for timestamps if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        type TEXT,
        sender_id INTEGER REFERENCES users(id),
        sender_local_message_id TEXT,
        recipient_id INTEGER REFERENCES users(id),
        message TEXT,
        sender_timestamp VARCHAR(255) NOT NULL,
        primary_sender_id INTEGER REFERENCES users(id),
        primary_sender_local_message_id TEXT,
        primary_recipient_id INTEGER REFERENCES users(id),
        is_delivered BOOLEAN,
        delivery_timestamp VARCHAR(255),
        is_read BOOLEAN,
        read_timestamp VARCHAR(255),
        group_info JSONB,
        file_info JSONB,
        is_group_message BOOLEAN DEFAULT FALSE
      );
    `);
    console.log('Messages table created successfully');
  } catch (err) {
    console.error('Error creating messages table:', err);
    throw err; // Propagate the error
  }
};

// Create app_instances table if it doesn't exist
const createAppInstancesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_instances (
        id SERIAL PRIMARY KEY,
        global_user_id INTEGER REFERENCES users(id),
        app_instance_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_connected TIMESTAMP
      );
    `);
    console.log('App instances table created successfully');
  } catch (err) {
    console.error('Error creating app_instances table:', err);
    throw err; // Propagate the error
  }
};

// Add last_connected column to existing app_instances table
const addLastConnectedColumn = async () => {
  try {
    await pool.query(`
      ALTER TABLE app_instances 
      ADD COLUMN IF NOT EXISTS last_connected TIMESTAMP;
    `);
    console.log('Added last_connected column to app_instances table');
  } catch (err) {
    console.error('Error adding last_connected column:', err);
  }
};

// Initialize tables in the correct order
const initializeTables = async () => {
  try {
    if (FLUSH_DATABASE_ON_START) {
      console.log('Flushing database...');
      await dropAllTables();
      console.log('Creating new tables...');
      await createUsersTable();
      await createMessagesTable();
      await createAppInstancesTable();
      console.log('All tables initialized successfully');
    } else {
      console.log('Skipping table initialization - using existing tables');
      await addLastConnectedColumn(); // Add the new column to existing tables
    }
  } catch (err) {
    console.error('Error during table initialization:', err);
  }
};

module.exports = {
  pool,
  initializeTables,
  dropAllTables,
  createUsersTable,
  createMessagesTable,
  createAppInstancesTable,
  addLastConnectedColumn,
  FLUSH_DATABASE_ON_START
};