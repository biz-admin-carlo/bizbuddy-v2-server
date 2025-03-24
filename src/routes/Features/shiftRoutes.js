// src/routes/Features/shiftRoutes.js

const express = require("express");
const router = express.Router();
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const authenticate = require("@middlewares/authMiddleware");
const { createShift, getShifts, updateShift, deleteShift } = require("@controllers/Features/shiftController");

router.post("/create", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), createShift);
router.get("/", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), getShifts);
router.put("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), updateShift);
router.delete("/:id", authenticate, authorizeRoles("admin", "supervisor", "superadmin"), deleteShift);

module.exports = router;
