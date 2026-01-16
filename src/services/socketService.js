// src/services/socketService.js
// Simple wrapper to maintain consistent interface
const socketConfig = require('@config/socket');

module.exports = {
  initSocket: socketConfig.init,
  notifyUser: socketConfig.notifyUser,
  notifyManagement: socketConfig.notifyManagement,
  notifyCompany: socketConfig.notifyCompany,
  getIO: socketConfig.getIO,
};