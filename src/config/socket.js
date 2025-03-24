// src/config/socket.js
let io;

module.exports = {
  init: (server) => {
    io = require("socket.io")(server, {
      cors: {
        origin: ["http://localhost:19006", "https://mybizbuddy.co", "http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true,
      },
    });
    io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);
      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
      });
    });
    return io;
  },
  getIO: () => {
    if (!io) throw new Error("Socket.io not initialized!");
    return io;
  },
};
