// src/routes/Features/leaveBalanceRoutes.js

const router = require("express").Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const {
  adjustBalance,
  listMatrix,
} = require("@controllers/Features/leaveBalanceController");

router.post(
  "/adjust",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  adjustBalance
);

router.get(
  "/matrix",
  authenticate,
  authorizeRoles("admin", "supervisor", "superadmin"),
  listMatrix
);

module.exports = router;
