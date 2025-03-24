// src/routes/Features/employeeRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const {
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  updateEmployeePresence,
  changeEmployeePassword,
  getEmployeeById,
} = require("@controllers/Features/employeeController");

router.get("/", authenticate, authorizeRoles("admin", "superadmin", "supervisor"), getAllEmployees);
router.post("/", authenticate, authorizeRoles("admin", "superadmin"), createEmployee);
router.put("/:id", authenticate, authorizeRoles("admin", "superadmin"), updateEmployee);
router.delete("/:id", authenticate, authorizeRoles("admin", "superadmin"), deleteEmployee);
router.put("/me/presence", authenticate, updateEmployeePresence);
router.put("/me/password", authenticate, changeEmployeePassword);
router.get("/:id/detail", authenticate, authorizeRoles("employee", "admin", "superadmin", "supervisor"), getEmployeeById);

module.exports = router;
