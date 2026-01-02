// src/routes/PayrollSystem/payrollSystemRoutes.js

const express = require("express");
const router = express.Router();
const {
    getEmployeeList,
    savePayrollRun,
    getPayrollRun,
    listPayrollRuns,
    getPayrollReports,        
    getUnviewedReportsCount,
    generatePayslipPDF
} = require("@controllers/PayrollSystem/payrollSystemController");
const {
    importClockHours,
    importClockHoursDetail,
  } = require("@controllers/PayrollSystem/importClockHoursController");
const authenticate = require("@middlewares/authMiddleware");

// Existing routes
router.get("/get-employees-list", authenticate, getEmployeeList);
router.get("/import-clock-hours/:userId", authenticate, importClockHoursDetail);
router.get("/import-clock-hours", authenticate, importClockHours);

// NEW Payroll Run routes
router.post("/save-payroll-run", authenticate, savePayrollRun);
router.get("/payroll-run/:id", authenticate, getPayrollRun);
router.get("/payroll-runs", authenticate, listPayrollRuns);
router.get("/payroll-reports", authenticate, getPayrollReports);
router.get("/unviewed-reports-count", authenticate, getUnviewedReportsCount);
router.get("/generate-payslip-pdf/:payrollRunId/:employeeId", authenticate, generatePayslipPDF);


module.exports = router;