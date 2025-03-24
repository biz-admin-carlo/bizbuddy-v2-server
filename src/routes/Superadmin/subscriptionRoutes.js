// src/routes/Account/subscriptionRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { getCurrentSubscription, upgradeSubscription, cancelCurrentSubscription } = require("../../controllers/Account/subscriptionController");

router.get("/current", authenticate, authorizeRoles("admin", "superadmin", "employee", "supervisor"), getCurrentSubscription);
router.put("/upgrade", authenticate, authorizeRoles("admin", "superadmin"), upgradeSubscription);
router.put("/cancel", authenticate, authorizeRoles("admin", "superadmin"), cancelCurrentSubscription);

module.exports = router;
