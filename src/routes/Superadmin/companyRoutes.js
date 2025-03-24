// src/routes/Account/companyRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const { getAllCompanies, getCompanyById, createCompany, updateCompany, deleteCompany } = require("@controllers/Account/companyController");

router.get("/all", authenticate, authorizeRoles("superadmin"), getAllCompanies);
router.post("/create", authenticate, authorizeRoles("superadmin"), createCompany);
router.put("/update/:id", authenticate, authorizeRoles("superadmin"), updateCompany);
router.delete("/delete/:id", authenticate, authorizeRoles("superadmin"), deleteCompany);
router.get("/:id", authenticate, authorizeRoles("superadmin", "admin"), getCompanyById);

module.exports = router;
