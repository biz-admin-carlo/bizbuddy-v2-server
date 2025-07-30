// src/routes/Features/leavePolicyRoutes.js
const router = require("express").Router();
const authenticate = require("@middlewares/authMiddleware");
const { authorizeRoles } = require("@middlewares/roleMiddleware");
const {
  getPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
} = require("@controllers/Features/leavePolicyController");

router.use(authenticate, authorizeRoles("admin", "superadmin", "supervisor"));

router.get("/", getPolicies);
router.post("/", createPolicy);
router.put("/:id", updatePolicy);
router.delete("/:id", deletePolicy);

module.exports = router;
