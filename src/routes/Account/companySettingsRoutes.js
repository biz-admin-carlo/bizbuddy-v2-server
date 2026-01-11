// src/routes/Account/companySettingsRoutes.js

const express = require("express");
const router = express.Router();

const authenticate = require("@middlewares/authMiddleware");

const { 
    getSettings, 
    updateSettings,
    getCheckSettings,
    updateCheckSettings,
    getCheckTemplates,
    generateTestCheckPDF
 } = require("@controllers/Account/companySettingsController");

router.get("/", authenticate, getSettings);
router.patch("/", authenticate, updateSettings);
router.get("/check-settings", authenticate, getCheckSettings);
router.put("/check-settings", authenticate, updateCheckSettings);
router.get("/check-templates", authenticate, getCheckTemplates);
router.post("/check-test-pdf", authenticate, generateTestCheckPDF);

module.exports = router;
