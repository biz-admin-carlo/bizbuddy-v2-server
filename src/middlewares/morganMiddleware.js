// src/middlewares/morganMiddleware.js

const morgan = require("morgan");
const logger = require("@config/logger");

// Create a stream object with a 'write' function that will be used by Morgan
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Skip logging during tests
const skip = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "test";
};

// Build the morgan middleware
const morganMiddleware = morgan(
  // Define message format
  ":method :url :status :res[content-length] - :response-time ms",
  { stream, skip }
);

module.exports = morganMiddleware;