// src/routes/PayrollSystem/payrollSystemRoutes.js

const express = require("express");
const router = express.Router();

const {
  getEmployeeList,
} = require("@controllers/PayrollSystem/payrollSystemController");

const {
  importClockHours,
  importClockHoursDetail,
} = require("@controllers/PayrollSystem/importClockHoursController");

const authenticate = require("@middlewares/authMiddleware");

router.get("/get-employees-list", authenticate, getEmployeeList);

/**
 * @route   GET /api/payroll-system/import-clock-hours
 * @desc    Get summarized clock hours for all employees in date range
 * @query   from (YYYY-MM-DD) - Start date
 * @query   to (YYYY-MM-DD) - End date
 * @access  Private (Admin, Supervisor)
 * 
 * @returns {Object}
 * {
 *   success: true,
 *   data: {
 *     periodStart: "2025-01-01",
 *     periodEnd: "2025-01-15",
 *     employees: [
 *       {
 *         userId: "abc123",
 *         employeeName: "John Doe",
 *         department: "IT Department",
 *         regularHours: 80.00,
 *         approvedOvertimeHours: 5.50,
 *         ...
 *       }
 *     ],
 *     summary: {
 *       totalEmployees: 15,
 *       totalRegularHours: 1200.00,
 *       totalOvertimeHours: 45.50,
 *       ...
 *     }
 *   }
 * }
 */
router.get("/import-clock-hours", authenticate, importClockHours);

/**
 * @route   GET /api/payroll-system/import-clock-hours/:userId
 * @desc    Get detailed daily breakdown of clock hours for a single employee
 * @param   userId - Employee user ID
 * @query   from (YYYY-MM-DD) - Start date
 * @query   to (YYYY-MM-DD) - End date
 * @access  Private (Admin, Supervisor)
 * 
 * @returns {Object}
 * {
 *   success: true,
 *   data: {
 *     periodStart: "2025-01-01",
 *     periodEnd: "2025-01-15",
 *     employee: { userId, employeeName, department, payType, payRate },
 *     departmentPolicy: { lunchPaid, coffeeBreakPaid, ... },
 *     summary: { regularHours, approvedOvertimeHours, ... },
 *     dailyBreakdown: [
 *       {
 *         date: "2025-01-01",
 *         scheduledHours: 8.00,
 *         regularHours: 8.00,
 *         approvedOTHours: 1.50,
 *         logs: [...]
 *       },
 *       ...
 *     ]
 *   }
 * }
 */
router.get("/import-clock-hours/:userId", authenticate, importClockHoursDetail);

module.exports = router;