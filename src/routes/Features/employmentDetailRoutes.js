// src/routes/Features/employmentDetailRoutes.js

const express = require("express");
const router = express.Router();

const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const {
  getMyEmploymentDetails,
  upsertMyEmploymentDetails,
  getEmploymentDetailsById,
  upsertEmploymentDetailsById,
} = require("@controllers/Features/employmentDetailController");

router.get("/me", authenticate, getMyEmploymentDetails);
router.put("/me", authenticate, upsertMyEmploymentDetails);
router.get("/:id", authenticate, authorizeRoles("admin", "superadmin", "supervisor"), getEmploymentDetailsById);
router.put("/:id", authenticate, authorizeRoles("admin", "superadmin"), upsertEmploymentDetailsById);

module.exports = router;
