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

// Create group conversations table if it doesn't exist
const createGroupConversationsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_conversations (
        id SERIAL PRIMARY KEY,
        name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Group conversations table created successfully');
  } catch (err) {
    console.error('Error creating group conversations table:', err);
  }
};

// Create group members table if it doesn't exist
const createGroupMembersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER REFERENCES group_conversations(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
      );
    `);
    console.log('Group members table created successfully');
  } catch (err) {
    console.error('Error creating group members table:', err);
  }
};

// Create group messages table if it doesn't exist
const createGroupMessagesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id SERIAL PRIMARY KEY,
        global_id SERIAL UNIQUE,
        type TEXT,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sender_local_message_id TEXT,
        group_id INTEGER REFERENCES group_conversations(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        sender_timestamp TIMESTAMP NOT NULL,
        primary_message_id INTEGER REFERENCES group_messages(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Group messages table created successfully');
  } catch (err) {
    console.error('Error creating group messages table:', err);
  }
};

// Create group message delivery status table if it doesn't exist
const createGroupMessageDeliveryStatusTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_message_delivery_status (
        message_id INTEGER REFERENCES group_messages(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_delivered BOOLEAN DEFAULT FALSE,
        delivery_timestamp TIMESTAMP,
        PRIMARY KEY (message_id, user_id)
      );
    `);
    console.log('Group message delivery status table created successfully');
  } catch (err) {
    console.error('Error creating group message delivery status table:', err);
  }
};

// Create group message read status table if it doesn't exist
const createGroupMessageReadStatusTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_message_read_status (
        message_id INTEGER REFERENCES group_messages(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_read BOOLEAN DEFAULT FALSE,
        read_timestamp TIMESTAMP,
        PRIMARY KEY (message_id, user_id)
      );
    `);
    console.log('Group message read status table created successfully');
  } catch (err) {
    console.error('Error creating group message read status table:', err);
  }
};

createUsersTable();
createMessagesTable();
createGroupConversationsTable();
createGroupMembersTable();
createGroupMessagesTable();
createGroupMessageDeliveryStatusTable();
createGroupMessageReadStatusTable();

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
    socket.join(`user:${userId}`);
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

  // Group chat events
  socket.on("create_group", async (data, callback) => {
    try {
      const { name, userIds } = data;

      // Validate input
      if (!userIds || !Array.isArray(userIds) || userIds.length < 2) {
        callback({ error: 'At least two users are required for a group' });
        return;
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create group conversation
        const groupResult = await client.query(
          'INSERT INTO group_conversations (name) VALUES ($1) RETURNING *',
          [name]
        );
        const group = groupResult.rows[0];

        // Add members to the group
        const memberPromises = userIds.map(userId =>
          client.query(
            'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) RETURNING user_id',
            [group.id, userId]
          )
        );
        await Promise.all(memberPromises);

        // Get group members with their details
        const membersResult = await client.query(`
          SELECT u.id, u.name, u.email
          FROM users u
          JOIN group_members gm ON u.id = gm.user_id
          WHERE gm.group_id = $1
        `, [group.id]);

        await client.query('COMMIT');

        const groupData = {
          ...group,
          members: membersResult.rows
        };

        // Notify all group members
        userIds.forEach(userId => {
          io.to(`user:${userId}`).emit("group_created", groupData);
        });

        callback({ success: true, group: groupData });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error creating group:', err);
      callback({ error: 'Server error' });
    }
  });

  socket.on("get_user_groups", async (userId, callback) => {
    try {
      const result = await pool.query(`
        SELECT 
          gc.id,
          gc.name,
          gc.created_at,
          gc.updated_at,
          json_agg(json_build_object(
            'id', u.id,
            'name', u.name,
            'email', u.email
          )) as members,
          (
            SELECT json_build_object(
              'message', gm.message,
              'sender_id', gm.sender_id,
              'sender_timestamp', gm.sender_timestamp
            )
            FROM group_messages gm
            WHERE gm.group_id = gc.id
            ORDER BY gm.sender_timestamp DESC
            LIMIT 1
          ) as last_message
        FROM group_conversations gc
        JOIN group_members gm ON gc.id = gm.group_id
        JOIN users u ON gm.user_id = u.id
        WHERE gc.id IN (
          SELECT group_id 
          FROM group_members 
          WHERE user_id = $1
        )
        GROUP BY gc.id
        ORDER BY gc.updated_at DESC
      `, [userId]);

      callback({ success: true, groups: result.rows });
    } catch (err) {
      console.error('Error fetching user groups:', err);
      callback({ error: 'Server error' });
    }
  });

  socket.on("get_group_messages", async (data, callback) => {
    try {
      const { groupId, limit = 50, offset = 0 } = data;
      const result = await pool.query(`
        SELECT 
          gm.*,
          json_build_object(
            'id', u.id,
            'name', u.name,
            'email', u.email
          ) as sender,
          (
            SELECT json_agg(json_build_object(
              'user_id', gmds.user_id,
              'is_delivered', gmds.is_delivered,
              'delivery_timestamp', gmds.delivery_timestamp
            ))
            FROM group_message_delivery_status gmds
            WHERE gmds.message_id = gm.id
          ) as delivery_status,
          (
            SELECT json_agg(json_build_object(
              'user_id', gmrs.user_id,
              'is_read', gmrs.is_read,
              'read_timestamp', gmrs.read_timestamp
            ))
            FROM group_message_read_status gmrs
            WHERE gmrs.message_id = gm.id
          ) as read_status
        FROM group_messages gm
        JOIN users u ON gm.sender_id = u.id
        WHERE gm.group_id = $1
        ORDER BY gm.sender_timestamp DESC
        LIMIT $2 OFFSET $3
      `, [groupId, limit, offset]);

      callback({ success: true, messages: result.rows.reverse() });
    } catch (err) {
      console.error('Error fetching group messages:', err);
      callback({ error: 'Server error' });
    }
  });

  socket.on("join_group", (groupId) => {
    socket.join(`group:${groupId}`);
  });

  socket.on("leave_group", (groupId) => {
    socket.leave(`group:${groupId}`);
  });

  socket.on("group_message", async (data, callback) => {
    try {
      const { 
        type,
        sender_id,
        sender_local_message_id,
        group_id,
        message,
        sender_timestamp,
        primary_message_id
      } = data;

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert the message
        const messageResult = await client.query(`
          INSERT INTO group_messages (
            type, sender_id, sender_local_message_id, group_id, 
            message, sender_timestamp, primary_message_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          type, sender_id, sender_local_message_id, group_id,
          message, sender_timestamp, primary_message_id
        ]);
        
        const newMessage = messageResult.rows[0];

        // Get group members
        const membersResult = await client.query(
          'SELECT user_id FROM group_members WHERE group_id = $1',
          [group_id]
        );

        // Initialize delivery and read status for all members except sender
        for (const member of membersResult.rows) {
          if (member.user_id !== sender_id) {
            await client.query(`
              INSERT INTO group_message_delivery_status (message_id, user_id)
              VALUES ($1, $2)
            `, [newMessage.id, member.user_id]);

            await client.query(`
              INSERT INTO group_message_read_status (message_id, user_id)
              VALUES ($1, $2)
            `, [newMessage.id, member.user_id]);
          }
        }

        // Update group's updated_at timestamp
        await client.query(
          'UPDATE group_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [group_id]
        );

        await client.query('COMMIT');

        // Get the complete message data with sender info
        const completeMessage = await pool.query(`
          SELECT 
            gm.*,
            json_build_object(
              'id', u.id,
              'name', u.name,
              'email', u.email
            ) as sender
          FROM group_messages gm
          JOIN users u ON gm.sender_id = u.id
          WHERE gm.id = $1
        `, [newMessage.id]);

        // Emit the message to all members in the group
        io.to(`group:${group_id}`).emit("group_message", completeMessage.rows[0]);

        callback({ success: true, message: completeMessage.rows[0] });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error handling group message:', err);
      callback({ error: 'Server error' });
    }
  });

  socket.on("group_message_delivered", async (data, callback) => {
    try {
      const { message_id, user_id, group_id } = data;
      
      await pool.query(`
        UPDATE group_message_delivery_status 
        SET is_delivered = true, delivery_timestamp = CURRENT_TIMESTAMP
        WHERE message_id = $1 AND user_id = $2
        RETURNING *
      `, [message_id, user_id]);

      io.to(`group:${group_id}`).emit("group_message_delivered", data);
      callback({ success: true });
    } catch (err) {
      console.error('Error handling group message delivery:', err);
      callback({ error: 'Server error' });
    }
  });

  socket.on("group_message_read", async (data, callback) => {
    try {
      const { message_id, user_id, group_id } = data;
      
      await pool.query(`
        UPDATE group_message_read_status 
        SET is_read = true, read_timestamp = CURRENT_TIMESTAMP
        WHERE message_id = $1 AND user_id = $2
        RETURNING *
      `, [message_id, user_id]);

      io.to(`group:${group_id}`).emit("group_message_read", data);
      callback({ success: true });
    } catch (err) {
      console.error('Error handling group message read status:', err);
      callback({ error: 'Server error' });
    }
  });
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
