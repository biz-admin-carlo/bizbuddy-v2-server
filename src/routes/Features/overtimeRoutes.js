// src/routes/Features/overtimeRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { submitOvertime, getMyOT, getPendingOT, approveOT, rejectOT, deleteOT, getAllOT } = require("@controllers/Features/overtimeController");

router.post("/submit", authenticate, authorizeRoles("employee", "admin", "supervisor", "superadmin"), submitOvertime);
router.get("/my", authenticate, authorizeRoles("employee", "admin", "supervisor", "superadmin"), getMyOT);
router.get("/pending", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getPendingOT);
router.put("/:id/approve", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), approveOT);
router.put("/:id/reject", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), rejectOT);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteOT);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getAllOT);

module.exports = router;
