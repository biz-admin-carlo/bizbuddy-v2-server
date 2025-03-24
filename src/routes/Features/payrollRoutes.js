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
} = require("@controllers/Features/payrollController");

router.get("/my", authenticate, authorizeRoles("employee", "admin", "superadmin", "supervisor"), getMyPayrollRecords);
router.get("/", authenticate, authorizeRoles("admin", "superadmin"), getAllPayrollRecords);
router.post("/payrate/:employeeId", authenticate, authorizeRoles("admin", "superadmin"), createOrUpdatePayRate);
router.put("/settings", authenticate, authorizeRoles("admin", "superadmin"), updatePayrollSettings);
router.get("/settings", authenticate, authorizeRoles("admin", "superadmin"), getPayrollSettings);
router.post("/calculate", authenticate, authorizeRoles("admin", "superadmin"), calculatePayrollForUser);
router.get("/:recordId/pdf", authenticate, authorizeRoles("employee", "admin", "superadmin"), generatePayrollPDF);

module.exports = router;
