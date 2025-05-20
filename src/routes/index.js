// src/routes/index.js

const express = require("express");
const router = express.Router();

const accountRoutes = require("@routes/Account/accountRoutes");
const companyRoutes = require("@routes/Superadmin/companyRoutes");
const departmentsRoutes = require("@routes/Account/departmentRoutes");
const employeeRoutes = require("@routes/Features/employeeRoutes");

const userPresenceRoutes = require("@routes/Features/userPresenceRoutes");
const leavesRoutes = require("@routes/Features/leaveRoutes");
const locationRoutes = require("@routes/Features/locationRoutes");
const payrollRoutes = require("@routes/Features/payrollRoutes");

// timelog and punch
const timeLogsRoutes = require("@routes/Features/timeLogRoutes.js");

// shifts, schedules, userShiftsSchedules
const shiftRoutes = require("@routes/Features/shiftRoutes");
const shiftSchedulesRoutes = require("@routes/Features/shiftScheduleRoutes");
const userShiftRoutes = require("@routes/Features/userShiftRoutes");

const employeeLocationRestrictionRoutes = require("@routes/Features/employeeLocationRestrictionRoutes");

// analytics
const analyticsRoutes = require("@routes/Features/analyticsRoutes");

// subscriptions, subscriptionPlans, payments
const paymentsRoutes = require("@routes/Account/paymentRoutes");
const subscriptionPlansRoutes = require("@routes/Superadmin/subscriptionPlanRoutes");
const subscriptionsRoutes = require("@routes/Superadmin/subscriptionRoutes");

router.use("/account", accountRoutes);
router.use("/company", companyRoutes);
router.use("/departments", departmentsRoutes);
router.use("/payments", paymentsRoutes);
router.use("/subscription-plans", subscriptionPlansRoutes);
router.use("/subscriptions", subscriptionsRoutes);
router.use("/employee", employeeRoutes);

router.use("/timelogs", timeLogsRoutes);

router.use("/presence", userPresenceRoutes);
router.use("/leaves", leavesRoutes);
router.use("/location", locationRoutes);
router.use("/payroll", payrollRoutes);

router.use("/shifts", shiftRoutes);
router.use("/shiftschedules", shiftSchedulesRoutes);
router.use("/usershifts", userShiftRoutes);

router.use("/employee-location-restriction", employeeLocationRestrictionRoutes);

router.use("/analytics", analyticsRoutes);

module.exports = router;
