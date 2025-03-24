// src/routes/Features/userShiftRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");

// Import the controller function
const { getUserShifts } = require("@controllers/Features/userShiftController");

// This route returns the shifts assigned to the logged-in user
router.get("/", authenticate, getUserShifts);

module.exports = router;
