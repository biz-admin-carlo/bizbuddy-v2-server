// src/routes/Account/companySettingsRoutes.js

const express = require("express");
const router = express.Router();

const authenticate = require("@middlewares/authMiddleware");

const { getSettings, updateSettings } = require("@controllers/Account/companySettingsController");

router.get("/", authenticate, getSettings);
router.patch("/", authenticate, updateSettings);

module.exports = router;
