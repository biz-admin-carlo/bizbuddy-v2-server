// src/routes/PayrollSystem/payrollSystemRoutes.js

const express = require("express");
const router = express.Router();
const {
    getEmployeeList,
} = require("@controllers/PayrollSystem/payrollSystemController");
const authenticate = require("@middlewares/authMiddleware");

router.get("/get-employees-list", authenticate, getEmployeeList);

module.exports = router;