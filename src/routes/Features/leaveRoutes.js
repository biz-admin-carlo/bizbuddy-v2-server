// src/routes/Features/leaveRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const {
  submitLeaveRequest,
  getUserLeaves,
  getPendingLeavesForApprover,
  approveLeave,
  rejectLeave,
  getApprovers,
  getLeavesForApprover,
  deleteLeave,
} = require("@controllers/Features/leaveController");

router.post("/submit", authenticate, authorizeRoles("employee", "admin", "supervisor", "superadmin"), submitLeaveRequest);
router.get("/my", authenticate, authorizeRoles("employee", "admin", "supervisor", "superadmin"), getUserLeaves);
router.get("/pending", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getPendingLeavesForApprover);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getLeavesForApprover);
router.put("/:id/approve", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), approveLeave);
router.put("/:id/reject", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), rejectLeave);
router.get("/approvers", authenticate, authorizeRoles("employee", "admin", "supervisor", "superadmin"), getApprovers);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteLeave);

module.exports = router;
