// routes/Cutoff/cutoffRoutes.js
// ✅ STRIPPED — Settings and generation ONLY
// ⚠️  All approval routes have been REMOVED from here.
//     They now live exclusively in cutoffPeriodRoutes.js
//     cutoffApprovalsController.js is DEPRECATED — do not use.

const express = require("express");
const authenticate = require("../../middlewares/authMiddleware");
const { authorizeRoles } = require("../../middlewares/roleMiddleware");

const {
  getDepartmentSettings,
  getDepartmentSetting,
  saveDepartmentSettings,
  deactivateDepartmentSettings,
  previewDepartmentCutoffs,
} = require("../../controllers/Cutoff/cutoffSettingsController");

const {
  generateCutoffPeriods,
  generateAllDepartmentCutoffs,
} = require("../../services/Cutoff/cutoffGenerationService");

const router = express.Router();

// ============================================================================
// DEPARTMENT CUTOFF SETTINGS
// ============================================================================

router.get(
  "/cutoff-settings/departments",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getDepartmentSettings
);

router.get(
  "/cutoff-settings/departments/:departmentId",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  getDepartmentSetting
);

router.post(
  "/cutoff-settings/departments",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  saveDepartmentSettings
);

router.delete(
  "/cutoff-settings/departments/:departmentId",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  deactivateDepartmentSettings
);

router.get(
  "/cutoff-settings/departments/:departmentId/preview",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  previewDepartmentCutoffs
);

// ============================================================================
// CUTOFF PERIOD GENERATION
// ============================================================================

router.post(
  "/cutoff-periods/generate",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  generateCutoffPeriods
);

router.post(
  "/cutoff-periods/generate-all",
  authenticate,
  authorizeRoles("admin", "superadmin"),
  generateAllDepartmentCutoffs
);

module.exports = router;