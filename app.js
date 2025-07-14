const express = require("express");
const http = require("http");
const cors = require("cors");

// Import configuration
const { initializeTables } = require('./config/database');
const { createSocketServer } = require('./config/socket');

// Import middleware
const { socketAuthMiddleware } = require('./middleware/socketAuthMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

// Import services
const SocketService = require('./services/socketService');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize database tables
initializeTables();

// Set up routes
app.use('/api', authRoutes);
app.use('/api/users', userRoutes);

const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Socket.io setup
const io = createSocketServer(server);

// Socket.IO JWT Authentication Middleware
io.use(socketAuthMiddleware);

// Initialize socket service
const socketService = new SocketService(io);

// Handle Socket.IO connections
io.on("connection", (socket) => {
  socketService.handleConnection(socket);
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});