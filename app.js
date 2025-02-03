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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        userId_from INTEGER REFERENCES users(id),
        userId_to INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        isDelivered BOOLEAN,
        delivery_timestamp TIMESTAMP,
        isRead BOOLEAN,
        read_timestamp TIMESTAMP
      );
    `);
    console.log('Messages table created successfully');
  } catch (err) {
    console.error('Error creating messages table:', err);
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

  socket.on("send_message", async ({ to, from, message }) => {
    const recipientSocketId = activeUsers.get(to);
    const timestamp = new Date().toISOString();
    
    try {
      // Save message to database and get the ID
      const result = await pool.query(
        'INSERT INTO messages (userId_from, userId_to, message, timestamp, isDelivered, delivery_timestamp, isRead, read_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [from, to, message, timestamp, null, null, null, null]
      );
      
      const messageId = result.rows[0].id;

      // Send message through WebSocket if recipient is online
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("receive_message", { 
          id: messageId,
          from, 
          message, 
          timestamp 
        });
      } else {
        socket.emit("message_not_delivered", { 
          id: messageId,
          to, 
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
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
