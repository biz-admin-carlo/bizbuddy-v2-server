// src/routes/Features/analyticsRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { getAdminAnalytics } = require("@controllers/Features/adminAnalyticsController");
const { getSuperAdminAnalytics } = require("@controllers/Features/superAdminAnalyticsController");
const { getEmployeeAnalytics } = require("@controllers/Features/employeeAnalyticsController");

router.get("/admin", authenticate, authorizeRoles("admin", "superadmin"), getAdminAnalytics);
router.get("/super", authenticate, authorizeRoles("superadmin"), getSuperAdminAnalytics);
router.get("/employee", authenticate, authorizeRoles("employee", "admin", "superadmin", "supervisor"), getEmployeeAnalytics);

module.exports = router;
