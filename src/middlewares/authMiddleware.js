// src/middlewares/authMiddleware.js

const jwt = require("jsonwebtoken");
const { prisma } = require("@config/connection");
const { JWT_SECRET } = require("@config/env");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Access token missing." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    };
    next();
  } catch (error) {
    console.error("Authentication Error:", error);
    return res.status(403).json({ message: "Invalid or expired token." });
  }
}

module.exports = authenticateToken;
