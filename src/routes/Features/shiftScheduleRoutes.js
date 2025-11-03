// src/routes/Features/shiftSchedule.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const { createShiftSchedule, preflightConflictCheck, getShiftSchedules, updateShiftSchedule, deleteShiftSchedule, getShiftSchedulesEnhanced } = require("@controllers/Features/shiftScheduleController");

router.post("/create", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), createShiftSchedule);
router.post("/preflight-check", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), preflightConflictCheck);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin", "employee"), getShiftSchedules);
router.get("/enhanced", authenticate, authorizeRoles("admin", "supervisor", "superadmin", "employee"), getShiftSchedulesEnhanced);
router.put("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), updateShiftSchedule);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteShiftSchedule);

module.exports = router;
