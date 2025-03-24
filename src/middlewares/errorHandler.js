// src/middlewares/errorHandler.js

function errorHandler(err, req, res, next) {
  console.error("Unhandled Error:", err);
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
}

module.exports = errorHandler;
