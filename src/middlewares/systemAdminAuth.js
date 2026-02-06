// src/middlewares/systemAdminAuth.js

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.SYSTEM_ADMIN_JWT_SECRET || "fallback-secret-key-change-this";

/**
 * Middleware to verify system admin authentication
 */
const verifySystemAdmin = (req, res, next) => {
  try {
    // Get token from cookie or Authorization header
    const token =
      req.cookies["system-admin-token"] ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== "system-admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin privileges required.",
      });
    }

    // Attach user info to request
    req.systemAdmin = {
      username: decoded.username,
      role: decoded.role,
    };

    next();
  } catch (error) {
    console.error("System admin auth middleware error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = verifySystemAdmin;