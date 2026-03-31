// src/routes/Features/feedbackRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { submitFeedback } = require("@controllers/Features/feedbackController");

router.post("/", authenticate, submitFeedback);

module.exports = router;
