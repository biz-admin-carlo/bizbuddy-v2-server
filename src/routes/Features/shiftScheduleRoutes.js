// src/routes/Features/shiftScheduleRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const {
  createShiftSchedule,
  getShiftSchedules,
  getShiftScheduleById,
  updateShiftSchedule,
  deleteShiftSchedule,
} = require("@controllers/Features/shiftScheduleController");

router.post("/create", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), createShiftSchedule);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin", "employee"), getShiftSchedules);
router.get("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getShiftScheduleById);
router.put("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), updateShiftSchedule);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteShiftSchedule);

module.exports = router;