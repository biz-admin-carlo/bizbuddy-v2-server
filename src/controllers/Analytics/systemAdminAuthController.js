// src/controllers/Analytics/systemAdminAuthController.js

const jwt = require("jsonwebtoken");

const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME;
const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD;
const JWT_SECRET = process.env.SYSTEM_ADMIN_JWT_SECRET;

/**
 * POST /api/system-admin/auth/login
 * System admin login
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Validate credentials
    if (username !== SYSTEM_ADMIN_USERNAME || password !== SYSTEM_ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        username: SYSTEM_ADMIN_USERNAME,
        role: "system-admin",
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: "8h" } // Token expires in 8 hours
    );

    // Set HTTP-only cookie for extra security
    res.cookie("system-admin-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 8 * 1000, // 8 hours in milliseconds
      path: "/",
    });

    // Return token
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
    });
  } catch (error) {
    console.error("System admin login error:", error);
    next(error);
  }
};

/**
 * POST /api/system-admin/auth/logout
 * System admin logout
 */
const logout = async (req, res, next) => {
  try {
    // Clear the cookie
    res.clearCookie("system-admin-token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("System admin logout error:", error);
    next(error);
  }
};

/**
 * GET /api/system-admin/auth/verify
 * Verify system admin token
 */
const verify = async (req, res, next) => {
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
        message: "Invalid token",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        username: decoded.username,
        role: decoded.role,
      },
    });
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = {
  login,
  logout,
  verify,
};