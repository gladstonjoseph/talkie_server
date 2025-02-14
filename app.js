const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(cors());

// PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://talkie_db_qzri_user:KNmfCEUNZrYkyvSo8Kl1NGf8rcUHUyvS@dpg-cuc40s3qf0us73c5gg8g-a.oregon-postgres.render.com/talkie_db_qzri",
  ssl: {
    rejectUnauthorized: false
  }
});

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
        password TEXT NOT NULL
      );
    `);
    console.log('Users table created successfully');
  } catch (err) {
    console.error('Error creating users table:', err);
  }
};

// Create messages table if it doesn't exist
const createMessagesTable = async () => {
  try {
    // First create the new table structure
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

    // Check if old messages table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      );
    `);

    if (tableExists.rows[0].exists) {
      // Copy data from old table to new table
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

      // Drop the old table
      await pool.query('DROP TABLE messages;');
    }

    // Rename the new table to messages
    await pool.query('ALTER TABLE messages_new RENAME TO messages;');

    console.log('Messages table created/updated successfully');
  } catch (err) {
    console.error('Error creating/updating messages table:', err);
  }
};

createUsersTable();
createMessagesTable();

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if email already exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
      [name, email, hashedPassword]
    );

    res.json({ message: 'User registered successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      message: 'Login successful',
      userId: user.id,
      name: user.name
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get User by ID
app.get('/api/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Validate that userId is provided and is a number
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active connections
const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log('New client connected');

  socket.on("register", (userId) => {
    console.log('User registered:', userId);
    socket.userId = userId;
    activeUsers.set(userId, socket.id);
  });

  socket.on("get_messages", async (userId, callback) => {
    try {
      console.log('Fetching undelivered messages for user:', userId);
      
      // Query to get all undelivered messages for the user
      const result = await pool.query(`
        SELECT * FROM messages 
        WHERE recipient_id = $1 
        AND (is_delivered = false OR is_delivered IS NULL)
        ORDER BY sender_timestamp ASC
      `, [userId]);

      // Send the messages back to the client
      if (callback) {
        callback({
          status: 'success',
          messages: result.rows
        });
      }

      console.log(`Found ${result.rows.length} undelivered messages for user ${userId}`);
    } catch (error) {
      console.error('Error fetching messages:', error);
      if (callback) {
        callback({
          status: 'error',
          message: 'Failed to fetch messages'
        });
      }
    }
  });

  socket.on("send_message", async ({ sender_id, recipient_id, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null }, callback) => {
    const recipientSocketId = activeUsers.get(recipient_id);
    const sender_timestamp = new Date().toISOString();
    const senderSocketId = activeUsers.get(sender_id);
    
    try {
      // Save message to database and get the ID
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

      // Send acknowledgment back to sender with the message ID
      if (callback) {
        callback({ 
          messageId,
          sender_local_message_id: sender_local_message_id 
        });
      }

      // Send message through WebSocket if recipient is online
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

  socket.on("disconnect", () => {
    if (socket.userId) {
      activeUsers.delete(socket.userId);
    }
    console.log('Client disconnected');
  });

  socket.on("set_delivery_status", async (data) => {
    try {
      const { message_global_id, is_delivered, delivery_timestamp } = data;

      // Update the message in the database
      const result = await pool.query(
        'UPDATE messages SET is_delivered = $1, delivery_timestamp = $2 WHERE id = $3 RETURNING sender_id',
        [is_delivered, delivery_timestamp, message_global_id]
      );

      if (result.rows.length > 0) {
        const senderId = result.rows[0].sender_id;
        // If the sender is online, send them the delivery status update
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

      // Update the message in the database
      const result = await pool.query(
        'UPDATE messages SET is_read = $1, read_timestamp = $2 WHERE id = $3 RETURNING sender_id',
        [is_read, read_timestamp, message_global_id]
      );

      if (result.rows.length > 0) {
        const senderId = result.rows[0].sender_id;
        // If the sender is online, send them the read status update
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
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
