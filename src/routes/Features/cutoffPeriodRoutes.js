// src/routes/Features/cutoffPeriodRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const {
  createCutoffPeriod,
  getCutoffPeriods,
  getCutoffPeriodById,
  updateCutoffStatus,
  deleteCutoffPeriod,
  getCutoffApprovals,
  getPendingApprovals,
  bulkUpdateApprovals,
  updateSingleApproval,
  getCutoffSummary,
} = require("@controllers/Features/cutoffPeriodController");

// Cutoff Period Management
router.post(
  "/create",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  createCutoffPeriod
);

router.get(
  "/",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffPeriods
);

router.get(
  "/:id",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffPeriodById
);

router.patch(
  "/:id/status",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  updateCutoffStatus
);

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  deleteCutoffPeriod
);

// Time Log Approvals
router.get(
  "/:id/approvals",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffApprovals
);

router.get(
  "/:id/approvals/pending",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getPendingApprovals
);

router.patch(
  "/:id/approvals/bulk",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  bulkUpdateApprovals
);

router.patch(
  "/:id/approvals/:approvalId",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  updateSingleApproval
);

// Summary/Reports
router.get(
  "/:id/summary",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffSummary
);

module.exports = router;