// src/routes/Features/conflictRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const { 
  getConflicts,
  getConflictsBySchedule,
  resolveConflict,
  bulkResolveConflicts,
  getConflictStats
} = require("@controllers/Features/conflictController");

// Get all conflicts for the company
router.get("/", 
  authenticate, 
  authorizeRoles("admin", "supervisor", "superadmin"), 
  getConflicts
);

// Get conflict statistics
router.get("/stats", 
  authenticate, 
  authorizeRoles("admin", "supervisor", "superadmin"), 
  getConflictStats
);

// Get conflicts for a specific schedule
router.get("/schedule/:scheduleId", 
  authenticate, 
  authorizeRoles("admin", "supervisor", "superadmin"), 
  getConflictsBySchedule
);

// Resolve a single conflict
router.put("/:id/resolve", 
  authenticate, 
  authorizeRoles("admin", "supervisor", "superadmin"), 
  resolveConflict
);

// Bulk resolve multiple conflicts
router.put("/bulk-resolve", 
  authenticate, 
  authorizeRoles("admin", "supervisor", "superadmin"), 
  bulkResolveConflicts
);

module.exports = router;