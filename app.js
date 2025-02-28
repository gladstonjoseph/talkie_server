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
  connectionString: "postgresql://talkie_db_hp4d_user:gzUeHK8xvlLMXtjtD9DETds9fdPyI7aK@dpg-cuvtt13tq21c738ultp0-a.oregon-postgres.render.com/talkie_db_hp4d",
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
        password TEXT NOT NULL
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
        message TEXT NOT NULL,
        sender_timestamp VARCHAR(255) NOT NULL,
        primary_sender_id INTEGER REFERENCES users(id),
        primary_sender_local_message_id TEXT,
        primary_recipient_id INTEGER REFERENCES users(id),
        is_delivered BOOLEAN,
        delivery_timestamp VARCHAR(255),
        is_read BOOLEAN,
        read_timestamp VARCHAR(255)
      );
    `);
    console.log('Messages table created successfully');
  } catch (err) {
    console.error('Error creating messages table:', err);
    throw err; // Propagate the error
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
      console.log('All tables initialized successfully');
    } else {
      console.log('Skipping table initialization - using existing tables');
    }
  } catch (err) {
    console.error('Error during table initialization:', err);
  }
};

initializeTables();

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

  socket.on("get_messages", async (userId, ack) => {
    try {
      console.log('Fetching undelivered messages for user:', userId);
      
      // Query to get all undelivered messages for the user
      const result = await pool.query(`
        SELECT * FROM messages 
        WHERE recipient_id = $1 
        AND (is_delivered = false OR is_delivered IS NULL)
        ORDER BY sender_timestamp ASC
      `, [userId]);

      console.log(`Found ${result.rows.length} undelivered messages for user ${userId}`);
      
      // Always call the acknowledgment callback
      ack({
        status: 'success',
        messages: result.rows
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      ack({
        status: 'error',
        message: 'Failed to fetch messages'
      });
    }
  });

  socket.on("send_message", async ({ sender_id, recipient_id, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null, sender_timestamp = null }, callback) => {
    const recipientSocketId = activeUsers.get(recipient_id);
    const senderSocketId = activeUsers.get(sender_id);
    
    // // Validate sender_timestamp
    // if (!sender_timestamp) {
    //   socket.emit("message_error", { error: 'sender_timestamp is required' });
    //   return;
    // }
    
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

      // // Validate delivery_timestamp
      // if (!delivery_timestamp) {
      //   socket.emit("delivery_status_error", { error: 'delivery_timestamp is required' });
      //   return;
      // }

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

      // // Validate read_timestamp
      // if (!read_timestamp) {
      //   socket.emit("read_status_error", { error: 'read_timestamp is required' });
      //   return;
      // }

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

  socket.on("get_delivery_status", async (message_ids, callback) => {
    try {
      console.log('Fetching delivery status for messages:', message_ids);
      
      const result = await pool.query(`
        SELECT 
          id as message_global_id,
          is_delivered,
          delivery_timestamp
        FROM messages 
        WHERE id = ANY($1)
      `, [message_ids]);

      if (callback) {
        callback({
          status: 'success',
          statuses: result.rows
        });
      }

      console.log(`Found delivery status for ${result.rows.length} messages`);
    } catch (error) {
      console.error('Error fetching delivery status:', error);
      if (callback) {
        callback({
          status: 'error',
          message: 'Failed to fetch delivery status'
        });
      }
    }
  });

  socket.on("get_read_status", async (message_ids, callback) => {
    try {
      console.log('Fetching read status for messages:', message_ids);
      
      const result = await pool.query(`
        SELECT 
          id as message_global_id,
          is_read,
          read_timestamp
        FROM messages 
        WHERE id = ANY($1)
      `, [message_ids]);

      if (callback) {
        callback({
          status: 'success',
          statuses: result.rows
        });
      }

      console.log(`Found read status for ${result.rows.length} messages`);
    } catch (error) {
      console.error('Error fetching read status:', error);
      if (callback) {
        callback({
          status: 'error',
          message: 'Failed to fetch read status'
        });
      }
    }
  });

  socket.on("create_call", async (callData, ack) => {
    try {
      const { caller_id, callee_id, call_room_url, caller_local_call_id } = callData;
      
      // Validate required parameters
      if (!caller_id || !callee_id || !call_room_url || !caller_local_call_id) {
        throw new Error("Missing required call parameters");
      }

      console.log('Creating call:', { caller_id, callee_id, call_room_url, caller_local_call_id });

      // Get the socket ID of the callee
      const calleeSocketId = activeUsers.get(callee_id);
      
      if (calleeSocketId) {
        // Emit incoming call event to callee
        io.to(calleeSocketId).emit("incoming_call", {
          caller_id,
          call_room_url,
          caller_local_call_id  // Pass the caller's local call ID to the callee
        });
        
        ack({ status: "success" });
      } else {
        console.log('Callee not online:', callee_id);
        ack({ status: "error", message: "Callee is not online" });
      }
    } catch (error) {
      console.error('Error creating call:', error);
      ack({ status: "error", message: error.message });
    }
  });
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});