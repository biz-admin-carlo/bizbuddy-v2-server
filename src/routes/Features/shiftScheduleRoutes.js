// src/routes/Features/shiftSchedule.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const { createShiftSchedule, getShiftSchedules, updateShiftSchedule, deleteShiftSchedule } = require("@controllers/Features/shiftScheduleController");

router.post("/create", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), createShiftSchedule);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getShiftSchedules);
router.put("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), updateShiftSchedule);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteShiftSchedule);

module.exports = router;
