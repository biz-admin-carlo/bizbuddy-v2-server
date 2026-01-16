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

 const {
    getSettingsNotification,
    updateSettingsNotification,
  } = require('@controllers/Company/notificationSettingsController');

router.get("/", authenticate, getSettings);
router.patch("/", authenticate, updateSettings);
router.get("/check-settings", authenticate, getCheckSettings);
router.put("/check-settings", authenticate, updateCheckSettings);
router.get("/check-templates", authenticate, getCheckTemplates);
router.post("/check-test-pdf", authenticate, generateTestCheckPDF);

router.get('/notification-settings', authenticate, getSettingsNotification);
router.put('/notification-settings', authenticate, updateSettingsNotification);

module.exports = router;
