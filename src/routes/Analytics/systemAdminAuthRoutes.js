// src/routes/Analytics/systemAdminAuthRoutes.js

const express = require("express");
const router = express.Router();
const {
  login,
  logout,
  verify,
} = require("@controllers/Analytics/systemAdminAuthController");

// POST /api/system-admin/auth/login
router.post("/login", login);

// POST /api/system-admin/auth/logout
router.post("/logout", logout);

// GET /api/system-admin/auth/verify
router.get("/verify", verify);

module.exports = router;