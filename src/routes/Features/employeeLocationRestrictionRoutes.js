// src/routes/Features/employeeLocationRestrictionRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const {
  assignLocationToEmployee,
  toggleLocationRestriction,
  getEmployeeLocationRestriction,
} = require("@controllers/Features/employeeLocationRestrictionController");

router.post("/assign", authenticate, assignLocationToEmployee);
router.put("/toggle", authenticate, toggleLocationRestriction);
router.get("/", authenticate, getEmployeeLocationRestriction);

module.exports = router;
