const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");

// Import routes
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');

// Import database initialization
const { initializeTables } = require('./src/models/init');

// Import socket handlers
const setupSocketHandlers = require('./src/socket/handlers');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize database tables
initializeTables();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Setup socket handlers
setupSocketHandlers(io);

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});