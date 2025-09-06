// src/routes/Features/payrollRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");

const {
  getMyPayrollRecords,
  getAllPayrollRecords,
  createOrUpdatePayRate,
  updatePayrollSettings,
  getPayrollSettings,
  calculatePayrollForUser,
  generatePayrollPDF,
  createPayrollRun,
  finalizePayrollRun,
  getPayrollRun,
  listPayrollRuns,
} = require("@controllers/Features/payrollController");

router.get(
  "/my",
  authenticate,
  authorizeRoles("employee", "admin", "superadmin", "supervisor"),
  getMyPayrollRecords
);

router.get(
  "/",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getAllPayrollRecords
);

router.post(
  "/payrate/:employeeId",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  createOrUpdatePayRate
);

router.put(
  "/settings",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  updatePayrollSettings
);

router.get(
  "/settings",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getPayrollSettings
);

router.post(
  "/calculate",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  calculatePayrollForUser
);

router.get(
  "/:recordId/pdf",
  authenticate,
  authorizeRoles("employee", "admin", "superadmin"),
  generatePayrollPDF
);

router.post(
  "/runs",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  createPayrollRun
);

router.post(
  "/runs/:runId/finalize",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  finalizePayrollRun
);

router.get(
  "/runs",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  listPayrollRuns
);

router.get(
  "/runs/:runId",
  authenticate,
  authorizeRoles("admin", "superadmin", "supervisor"),
  getPayrollRun
);

module.exports = router;
