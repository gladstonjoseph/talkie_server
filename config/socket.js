const { Server } = require("socket.io");

const createSocketServer = (server) => {
  // Socket.io setup
  const io = new Server(server, {
    // Enforce WebSocket-only connections, disabling HTTP polling.
    transports: ['websocket'],
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000
  });

  return io;
};

module.exports = {
  createSocketServer
};