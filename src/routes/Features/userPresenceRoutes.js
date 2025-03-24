// src/routes/Features/userPresenceRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { getUserPresence, updateUserPresence } = require("../../controllers/Features/userPresenceController");

router.get("/", authenticate, getUserPresence);
router.put("/", authenticate, updateUserPresence);

module.exports = router;
