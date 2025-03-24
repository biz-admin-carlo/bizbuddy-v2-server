// src/routes/Account/subscriptionPlanRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { getAllPlans, createPlan, updatePlan, deletePlan } = require("../../controllers/Account/subscriptionPlanController");

router.get("/", getAllPlans);
router.post("/", authenticate, authorizeRoles("superadmin"), createPlan);
router.put("/:id", authenticate, authorizeRoles("superadmin"), updatePlan);
router.delete("/:id", authenticate, authorizeRoles("superadmin"), deletePlan);

module.exports = router;
