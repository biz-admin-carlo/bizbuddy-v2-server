// routes/Cutoff/cutoffRoutes.js
// ✅ COMPLETE WITH ALL ENDPOINTS

const express = require("express");
const authenticate = require("../../middlewares/authMiddleware");
const { authorizeRoles } = require("../../middlewares/roleMiddleware");

// ✅ Import CRUD controllers from the old manual system
const {
  getCutoffPeriods,
  createCutoffPeriod,
  getCutoffPeriodById,
  updateCutoffStatus,
  deleteCutoffPeriod,
  getCutoffSummary
} = require("../../controllers/Features/cutoffPeriodController");

// Department Settings Controllers
const {
  getDepartmentSettings,
  getDepartmentSetting,
  saveDepartmentSettings,
  deactivateDepartmentSettings,
  previewDepartmentCutoffs
} = require("../../controllers/Cutoff/cutoffSettingsController");

// Generation Service
const {
  generateCutoffPeriods,
  generateAllDepartmentCutoffs
} = require("../../services/Cutoff/cutoffGenerationService");

// Approval Controllers
const {
  getPendingApprovals,
  getApprovalsByStatus,
  updateApproval,
  bulkUpdateApprovals
} = require("../../controllers/Cutoff/cutoffApprovalsController");

const router = express.Router();

// ============================================================================
// DEPARTMENT CUTOFF SETTINGS
// ============================================================================

/**
 * @route   GET /api/cutoff/cutoff-settings/departments
 * @desc    Get all department cutoff configurations
 * @access  Admin
 */
router.get(
  '/cutoff-settings/departments',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getDepartmentSettings
);

/**
 * @route   GET /api/cutoff/cutoff-settings/departments/:departmentId
 * @desc    Get specific department cutoff configuration
 * @access  Admin
 */
router.get(
  '/cutoff-settings/departments/:departmentId',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getDepartmentSetting
);

/**
 * @route   POST /api/cutoff/cutoff-settings/departments
 * @desc    Create or update department cutoff configuration
 * @access  Admin
 */
router.post(
  '/cutoff-settings/departments',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  saveDepartmentSettings
);

/**
 * @route   DELETE /api/cutoff/cutoff-settings/departments/:departmentId
 * @desc    Deactivate department cutoff configuration
 * @access  Admin
 */
router.delete(
  '/cutoff-settings/departments/:departmentId',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  deactivateDepartmentSettings
);

/**
 * @route   GET /api/cutoff/cutoff-settings/departments/:departmentId/preview
 * @desc    Preview upcoming cutoff periods for a department
 * @access  Admin
 */
router.get(
  '/cutoff-settings/departments/:departmentId/preview',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  previewDepartmentCutoffs
);

// ============================================================================
// CUTOFF PERIOD GENERATION
// ============================================================================

/**
 * @route   POST /api/cutoff/cutoff-periods/generate
 * @desc    Auto-generate cutoff periods for a department
 * @access  Admin
 * @body    { departmentId, months, includeHistorical, fromDate, toDate }
 */
router.post(
  '/cutoff-periods/generate',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  generateCutoffPeriods
);

/**
 * @route   POST /api/cutoff/cutoff-periods/generate-all
 * @desc    Auto-generate cutoff periods for all departments
 * @access  Admin
 * @body    { months, includeHistorical, fromDate, toDate }
 */
router.post(
  '/cutoff-periods/generate-all',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  generateAllDepartmentCutoffs
);

// ============================================================================
// CUTOFF PERIOD APPROVALS (WITH CLEANING LOGIC)
// ============================================================================

/**
 * @route   GET /api/cutoff/cutoff-periods/:cutoffId/approvals/pending
 * @desc    Get pending approvals with schedule validation ("cleaning")
 * @access  Admin
 */
router.get(
  '/cutoff-periods/:cutoffId/approvals/pending',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getPendingApprovals
);

/**
 * @route   GET /api/cutoff/cutoff-periods/:cutoffId/approvals?status=approved|rejected
 * @desc    Get approved or rejected approvals
 * @access  Admin
 */
router.get(
  '/cutoff-periods/:cutoffId/approvals',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getApprovalsByStatus
);

/**
 * @route   PATCH /api/cutoff/cutoff-periods/:cutoffId/approvals/:approvalId
 * @desc    Approve or reject a single time log
 * @access  Admin
 * @body    { action: 'approve' | 'reject', notes }
 */
router.patch(
  '/cutoff-periods/:cutoffId/approvals/:approvalId',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  updateApproval
);

/**
 * @route   PATCH /api/cutoff/cutoff-periods/:cutoffId/approvals/bulk
 * @desc    Bulk approve or reject multiple time logs
 * @access  Admin
 * @body    { timeLogIds: [], action: 'approve' | 'reject', notes }
 */
router.patch(
  '/cutoff-periods/:cutoffId/approvals/bulk',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  bulkUpdateApprovals
);

// ============================================================================
// ✅ CUTOFF PERIOD CRUD (Manual System - Now Active)
// ============================================================================

/**
 * @route   GET /api/cutoff/cutoff-periods
 * @desc    Get all cutoff periods (with optional department filter)
 * @access  Admin
 * @query   ?departmentId=xxx&status=xxx
 */
router.get(
  '/cutoff-periods',
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffPeriods
);

/**
 * @route   GET /api/cutoff/cutoff-periods/:id
 * @desc    Get single cutoff period with details
 * @access  Admin
 */
router.get(
  '/cutoff-periods/:id',
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffPeriodById
);

/**
 * @route   POST /api/cutoff/cutoff-periods/create
 * @desc    Create manual cutoff period
 * @access  Admin
 */
router.post(
  '/cutoff-periods/create',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  createCutoffPeriod
);

/**
 * @route   PATCH /api/cutoff/cutoff-periods/:id/status
 * @desc    Update cutoff period status (open -> locked -> processed)
 * @access  Admin
 */
router.patch(
  '/cutoff-periods/:id/status',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  updateCutoffStatus
);

/**
 * @route   DELETE /api/cutoff/cutoff-periods/:id
 * @desc    Delete cutoff period
 * @access  Admin
 */
router.delete(
  '/cutoff-periods/:id',
  authenticate,
  authorizeRoles("admin", "superadmin"),
  deleteCutoffPeriod
);

/**
 * @route   GET /api/cutoff/cutoff-periods/:id/summary
 * @desc    Get payroll summary for cutoff period
 * @access  Admin
 */
router.get(
  '/cutoff-periods/:id/summary',
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  getCutoffSummary
);

module.exports = router;