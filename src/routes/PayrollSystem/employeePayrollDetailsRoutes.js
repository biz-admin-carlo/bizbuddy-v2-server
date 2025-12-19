// src/routes/PayrollSystem/employeePayrollDetailsRoutes.js

const express = require("express");
const router = express.Router();
const {
  getEmployeePayrollDetails,
  upsertEmployeePayrollDetails,
  resetEmployeePayrollDetails,
  getAllEmployeesWithPayrollDetails,
} = require("@controllers/PayrollSystem/employeePayrollDetailsController");
const authenticate = require("@middlewares/authMiddleware");

// Get all employees with payroll details (for Create Paycheck page)
router.get("/employees-with-details", authenticate, getAllEmployeesWithPayrollDetails);

// Get single employee payroll details
router.get("/employees/:userId/payroll-details", authenticate, getEmployeePayrollDetails);

// Create or update employee payroll details
router.put("/employees/:userId/payroll-details", authenticate, upsertEmployeePayrollDetails);

// Reset employee payroll details to defaults
router.delete("/employees/:userId/payroll-details", authenticate, resetEmployeePayrollDetails);

module.exports = router;