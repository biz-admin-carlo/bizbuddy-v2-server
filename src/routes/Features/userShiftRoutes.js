// src/routes/Features/userShiftRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");

const { getUserShifts } = require("@controllers/Features/userShiftController");

router.get("/", authenticate, getUserShifts);

module.exports = router;
