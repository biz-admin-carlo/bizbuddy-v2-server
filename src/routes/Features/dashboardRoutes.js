// src/routes/Features/dashboardRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { getSidebarStats } = require("@controllers/Features/dashboardController");

router.get(
  "/sidebar-stats",
  authenticate,
  authorizeRoles("admin", "superadmin", "supervisor"),
  getSidebarStats
);

module.exports = router;
