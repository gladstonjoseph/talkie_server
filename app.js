const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(cors());

// PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://pyne_db_73qp_user:AL0VT81m4SFkGVRhDMggN5aS7JlLjdI2@dpg-d15kmteuk2gs73fr6c50-a/pyne_db_73qp",
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
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('App instances table created successfully');
  } catch (err) {
    console.error('Error creating app_instances table:', err);
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
      await createAppInstancesTable();
      console.log('All tables initialized successfully');
    } else {
      console.log('Skipping table initialization - using existing tables');
      // await createAppInstancesTable();  // Remove this later
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
    const { email, password, app_instance_id } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!app_instance_id) {
      return res.status(400).json({ error: 'App instance ID is required' });
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

    // Create JWT
    // IMPORTANT: Use an environment variable for the secret key in a real production app
    const token = jwt.sign(
      { 
        userId: user.id,
        appInstanceId: app_instance_id
      },
      process.env.JWT_SECRET || 'your_super_secret_key_that_should_be_long_and_random',
      { expiresIn: '30d' } // Token expires in 30 days
    );

    // Save app_instance_id to the app_instances table
    try {
      await pool.query(
        'INSERT INTO app_instances (global_user_id, app_instance_id) VALUES ($1, $2)',
        [user.id, app_instance_id]
      );
      console.log(`App instance registered: ${app_instance_id} for user ${user.id}`);
    } catch (err) {
      console.error('Error saving app instance:', err);
      return res.status(500).json({ error: 'Failed to register app instance' });
    }

    res.json({
      message: 'Login successful',
      token: token,
      global_user_id: user.id,
      name: user.name,
      profile_picture_url: user.profile_picture_url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  // Enforce WebSocket-only connections, disabling HTTP polling.
  transports: ['websocket'],
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active connections
const activeUsers = new Map(); // userId → Map{appInstanceId → socketId}

// Socket.IO JWT Authentication Middleware
io.use((socket, next) => {
  console.log(`🔐 Authentication attempt from ${socket.id} at ${new Date().toISOString()}`);
  
  const authHeader = socket.handshake.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log(`❌ Authentication failed for ${socket.id}: No Bearer token provided`);
    return next(new Error('Authentication error: No Bearer token provided'));
  }

  const token = authHeader.substring(7, authHeader.length);
  console.log(`🔑 Token received for ${socket.id}: ${token.substring(0, 20)}...`);

  // IMPORTANT: Use the same secret key as in the login route
  jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_key_that_should_be_long_and_random', (err, decoded) => {
    if (err) {
      console.log(`❌ Authentication failed for ${socket.id}: Invalid token - ${err.message}`);
      return next(new Error('Authentication error: Invalid token'));
    }
    
    socket.userId = decoded.userId; // Attach userId to the socket object
    socket.appInstanceId = decoded.appInstanceId; // Attach appInstanceId to the socket object
    console.log(`✅ Authentication successful for ${socket.id}: User ${socket.userId}, App Instance ${socket.appInstanceId}`);
    next();
  });
});

// Helper function to broadcast message to all active app instances of a user
function broadcastToUser(userId, event, data) {
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

// Reusable function to save message to database and notify recipients
async function saveAndSendMessage({
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
  is_group_message = false
}) {
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

    // Get the complete message object from the database
    const savedMessage = result.rows[0];
    
    // Broadcast message to all active app instances of the recipient
    const wasDelivered = broadcastToUser(recipient_id, "receive_message", savedMessage);
    
    return savedMessage;
  } catch (err) {
    console.error('Error saving message to database:', err);
    throw err;
  }
}

io.on("connection", (socket) => {
  console.log(`🟢 User connected: ${socket.id} with user ID: ${socket.userId}, App Instance: ${socket.appInstanceId} at ${new Date().toISOString()}`);

  // Immediately register app instance from JWT
  if (socket.appInstanceId) {
    if (!activeUsers.has(socket.userId)) {
      activeUsers.set(socket.userId, new Map());
    }
    activeUsers.get(socket.userId).set(socket.appInstanceId, socket.id);
    console.log(`✅ App instance ${socket.appInstanceId} registered. Active instances: ${activeUsers.get(socket.userId).size}`);
  } else {
    console.log(`❌ No app instance ID in JWT for socket ${socket.id}`);
    socket.disconnect();
    return;
  }

  // When a user disconnects, remove them from the active app instances map
  socket.on('disconnect', (reason) => {
    console.log(`🔴 User disconnected: ${socket.id} (User ${socket.userId}, App Instance ${socket.appInstanceId}) at ${new Date().toISOString()}`);
    console.log(`🔴 Disconnect reason: ${reason}`);
    
    // Remove from activeUsers
    if (socket.userId && socket.appInstanceId) {
      const userMap = activeUsers.get(socket.userId);
      if (userMap) {
        userMap.delete(socket.appInstanceId);
        console.log(`👥 Removed app instance ${socket.appInstanceId} from active instances. User ${socket.userId} now has ${userMap.size} active devices`);
        
        // Clean up empty user entry
        if (userMap.size === 0) {
          activeUsers.delete(socket.userId);
          console.log(`🧹 Removed user ${socket.userId} from active users (no more devices)`);
        }
      }
    }
  });

  socket.on("get_messages", async (global_user_id, ack) => {
    try {
      console.log('Fetching undelivered messages for user:', global_user_id);
      
      // Query to get all undelivered messages for the user
      const result = await pool.query(`
        SELECT * FROM messages 
        WHERE recipient_id = $1 
        AND (is_delivered = false OR is_delivered IS NULL)
        ORDER BY sender_timestamp ASC
      `, [global_user_id]);

      console.log(`Found ${result.rows.length} undelivered messages for user ${global_user_id}`);
      
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

  socket.on("send_message", async ({ sender_id, recipient_id, message, type = null, sender_local_message_id = null, primary_sender_id = null, primary_sender_local_message_id = null, primary_recipient_id = null, sender_timestamp = null, file_info = null, is_group_message = false }, callback) => {
    try {
      // Use the reusable function to save and send the message
      const savedMessage = await saveAndSendMessage({
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
        is_group_message
      });

      // Send acknowledgment back to sender with the message ID
      if (callback) {
        callback({ 
          messageId: savedMessage.id,
          sender_local_message_id: savedMessage.sender_local_message_id 
        });
      }

      // // Check if message was delivered to any active app instances
      // const wasDelivered = broadcastToUser(savedMessage.recipient_id, "receive_message", savedMessage);
      // if (!wasDelivered) {
      //   socket.emit("message_not_delivered", { 
      //     id: savedMessage.id,
      //     recipient_id: savedMessage.recipient_id, 
      //     message: savedMessage.message 
      //   });
      // }
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
        const savedMessage = await saveAndSendMessage({
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
          is_group_message
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

  socket.on("search_users", async (query, callback) => {
    try {
      console.log('Searching users for query:', query);
      
      if (!query) {
        callback({
          status: 'success',
          users: []
        });
        return;
      }

      const result = await pool.query(
        'SELECT id, name, email FROM users WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)',
        [`%${query}%`]
      );

      callback({
        status: 'success',
        users: result.rows
      });
      
      console.log(`Found ${result.rows.length} users for query: ${query}`);
    } catch (err) {
      console.error('Error searching users via WebSocket:', err);
      callback({
        status: 'error',
        message: 'Error searching users'
      });
    }
  });

  socket.on("set_delivery_status", async (data, callback) => {
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
        // Broadcast delivery status update to all active app instances of the sender
        broadcastToUser(senderId, 'delivery_status_update', {
          global_id: message_global_id,
          is_delivered,
          delivery_timestamp
        });
        
        // Send success acknowledgement
        if (callback) {
          callback({
            status: 'success',
            message: 'Delivery status updated successfully'
          });
        }
      } else {
        // Message not found
        if (callback) {
          callback({
            status: 'error',
            message: 'Message not found'
          });
        }
      }
    } catch (err) {
      console.error('Error updating delivery status:', err);
      // Send error acknowledgement
      if (callback) {
        callback({
          status: 'error',
          message: 'Failed to update delivery status'
        });
      }
    }
  });

  socket.on("set_read_status", async (data, callback) => {
    try {
      const { message_global_id, is_read, read_timestamp } = data;

      // Update the message in the database
      const result = await pool.query(
        'UPDATE messages SET is_read = $1, read_timestamp = $2 WHERE id = $3 RETURNING sender_id',
        [is_read, read_timestamp, message_global_id]
      );

      if (result.rows.length > 0) {
        const senderId = result.rows[0].sender_id;
        // Broadcast read status update to all active app instances of the sender
        broadcastToUser(senderId, 'read_status_update', {
          global_id: message_global_id,
          is_read,
          read_timestamp
        });
        
        // Send success acknowledgement
        if (callback) {
          callback({
            status: 'success',
            message: 'Read status updated successfully'
          });
        }
      } else {
        // Message not found
        if (callback) {
          callback({
            status: 'error',
            message: 'Message not found'
          });
        }
      }
    } catch (err) {
      console.error('Error updating read status:', err);
      // Send error acknowledgement
      if (callback) {
        callback({
          status: 'error',
          message: 'Failed to update read status'
        });
      }
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

  // Handle profile picture URL updates
  socket.on("user_profile_update", async (data, callback) => {
    try {
      const { global_user_id, profilePictureUrl } = data;
      
      // Update the user's profile picture URL in the database
      const result = await pool.query(
        'UPDATE users SET profile_picture_url = $1 WHERE id = $2 RETURNING id',
        [profilePictureUrl, global_user_id]
      );

      if (result.rows.length > 0) {
        // Notify other connected clients about the profile update
        // socket.broadcast.emit('user_profile_updated', {
        //   global_user_id,
        //   profilePictureUrl
        // });
        
        callback({ success: true });
      } else {
        callback({ success: false, error: 'User not found' });
      }
    } catch (error) {
      console.error('Error updating profile picture URL:', error);
      callback({ success: false, error: 'Server error' });
    }
  });

  // Handle user profile fetch requests
  socket.on("get_user_profile", async (global_user_id, callback) => {
    try {
      console.log('Fetching user profile for user ID:', global_user_id);
      
      // Query the database for user information
      const result = await pool.query(
        'SELECT id, name, email, profile_picture_url FROM users WHERE id = $1',
        [global_user_id]
      );
      
      if (result.rows.length > 0) {
        const user = result.rows[0];
        callback({
          status: 'success',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            profile_picture_url: user.profile_picture_url
          }
        });
        console.log('User profile fetched successfully for user ID:', global_user_id);
      } else {
        callback({
          status: 'error',
          message: 'User not found'
        });
        console.log('User not found for user ID:', global_user_id);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      callback({
        status: 'error',
        message: 'Failed to fetch user profile'
      });
    }
  });

  // Handle app instance deletion
  socket.on("delete_app_instance", async (app_instance_id, callback) => {
    try {
      console.log('Deleting app instance:', app_instance_id, 'for user:', socket.userId);
      
      // Delete the app instance from the database
      const result = await pool.query(
        'DELETE FROM app_instances WHERE global_user_id = $1 AND app_instance_id = $2 RETURNING id',
        [socket.userId, app_instance_id]
      );

      if (result.rows.length > 0) {
        console.log(`App instance ${app_instance_id} deleted successfully for user ${socket.userId}`);
        callback({
          status: 'success',
          message: 'App instance deleted successfully'
        });
      } else {
        console.log(`App instance ${app_instance_id} not found for user ${socket.userId}`);
        callback({
          status: 'error',
          message: 'App instance not found'
        });
      }
    } catch (error) {
      console.error('Error deleting app instance:', error);
      callback({
        status: 'error',
        message: 'Failed to delete app instance'
      });
    }
  });
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});