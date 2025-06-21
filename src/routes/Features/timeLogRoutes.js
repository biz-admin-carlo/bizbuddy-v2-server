// src/routes/Features/timeLogRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");

const {
  timeIn,
  timeOut,
  getUserTimeLogs,
  deleteTimeLog,
  coffeeBreakStart,
  coffeeBreakEnd,
  lunchBreakStart,
  lunchBreakEnd,
  getCompanyTimeLogs,
} = require("@controllers/Features/timeLogController");

router.post("/time-in", authenticate, timeIn);
router.post("/time-out", authenticate, timeOut);
router.get("/user", authenticate, getUserTimeLogs);
router.delete("/delete/:id", authenticate, deleteTimeLog);
router.post("/coffee-break/start", authenticate, coffeeBreakStart);
router.post("/coffee-break/end", authenticate, coffeeBreakEnd);
router.post("/lunch-break/start", authenticate, lunchBreakStart);
router.post("/lunch-break/end", authenticate, lunchBreakEnd);
router.get("/", authenticate, getCompanyTimeLogs);

module.exports = router;
