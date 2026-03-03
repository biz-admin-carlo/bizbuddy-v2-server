// src/routes/Features/shiftAssignmentRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const {
  assignShifts,
  bulkAssignShifts,
  getAssignments,
  deleteAssignments,
} = require("@controllers/Features/shiftAssignmentController");

// Direct shift assignment
router.post("/assign", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), assignShifts);

// Bulk assignment (department or all)
router.post("/bulk-assign", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), bulkAssignShifts);

// Get assignments with filters
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getAssignments);

// Delete assignments
router.post("/delete", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteAssignments);

module.exports = router;