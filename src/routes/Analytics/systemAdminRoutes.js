// src/routes/Analytics/systemAdminRoutes.js

const express = require("express");
const router = express.Router();
const verifySystemAdmin = require("@middlewares/systemAdminAuth");
const analyticsController = require("@controllers/Analytics/analyticsController");
const { provisionCompany } = require("@controllers/Superadmin/provisionController");

// Auth routes (no middleware required)
const authRoutes = require("@routes/Analytics/systemAdminAuthRoutes");
router.use("/auth", authRoutes);

// Protected routes (require system admin auth)
router.get("/overview", verifySystemAdmin, analyticsController.getOverview);
router.get("/performance", verifySystemAdmin, analyticsController.getPerformance);
router.get("/errors", verifySystemAdmin, analyticsController.getErrors);
router.get("/users", verifySystemAdmin, analyticsController.getUserActivity);
router.get("/companies", verifySystemAdmin, analyticsController.getCompanyMetrics);
router.get("/trends", verifySystemAdmin, analyticsController.getTrends);
router.get("/security", verifySystemAdmin, analyticsController.getSecurityAlerts);
router.get("/requests", verifySystemAdmin, analyticsController.getRequestLogs);
router.get("/logger-health", verifySystemAdmin, analyticsController.getLoggerHealth);

// Internal provisioning — Postman only
router.post("/provision-company", verifySystemAdmin, provisionCompany);

module.exports = router;