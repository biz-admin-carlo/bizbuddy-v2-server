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
const timeLogsRoutes = require("@routes/Features/timeLogRoutes.js");
const shiftRoutes = require("@routes/Features/shiftRoutes");
const shiftSchedulesRoutes = require("@routes/Features/shiftScheduleRoutes");
const userShiftRoutes = require("@routes/Features/userShiftRoutes");
const employeeLocationRestrictionRoutes = require("@routes/Features/employeeLocationRestrictionRoutes");
const analyticsRoutes = require("@routes/Features/analyticsRoutes");
const paymentsRoutes = require("@routes/Account/paymentRoutes");
const subscriptionPlansRoutes = require("@routes/Superadmin/subscriptionPlanRoutes");
const subscriptionsRoutes = require("@routes/Superadmin/subscriptionRoutes");
const leavePolicyRoutes = require("@routes/Features/leavePolicyRoutes");
const leaveBalanceRoutes = require("@routes/Features/leaveBalanceRoutes");
const overtimeRoutes = require("@routes/Features/overtimeRoutes");
const companySettingsRoutes = require("@routes/Account/companySettingsRoutes");
const employmentDetailRoutes = require("@routes/Features/employmentDetailRoutes");
const accountDeletionRoutes = require("@routes/Features/accountDeletionRoutes");

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
router.use("/leave-policies", leavePolicyRoutes);
router.use("/leave-balances", leaveBalanceRoutes);
router.use("/overtime", overtimeRoutes);
router.use("/company-settings", companySettingsRoutes);
router.use("/employment-details", employmentDetailRoutes);
router.use("/account-deletion", accountDeletionRoutes);

router.get("/", (req, res) => {
    res.status(200).json({ message: "Server is up and running!" });
});

module.exports = router;