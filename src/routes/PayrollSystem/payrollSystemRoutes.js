// src/routes/PayrollSystem/payrollSystemRoutes.js

const express = require("express");
const router = express.Router();
const {
    getEmployeeList,
    generatePayrollPDF
} = require("@controllers/PayrollSystem/payrollSystemController");
const {
    importClockHours,
    importClockHoursDetail,
  } = require("@controllers/PayrollSystem/importClockHoursController");
const authenticate = require("@middlewares/authMiddleware");

router.get("/get-employees-list", authenticate, getEmployeeList);
router.get("/import-clock-hours/:userId", authenticate, importClockHoursDetail);
router.get("/import-clock-hours", authenticate, importClockHours);

router.post('/generate-pdf-report', generatePayrollPDF);

module.exports = router;