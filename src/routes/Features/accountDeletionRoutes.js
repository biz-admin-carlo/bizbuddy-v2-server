// src/routes/Features/accountDeletionRoutes.js

const express = require("express");
const router = express.Router();
const {
  checkEmailGenerateCode,
  verifyCode,
  confirmDeleteAccountRequest,
  getAuthenticatedRequest
} = require("@controllers/Features/requestAccountDeletionController");
const authenticate = require("@middlewares/authMiddleware");

router.post("/send-code", checkEmailGenerateCode);
router.post("/verify-code", verifyCode);
router.post("/confirm",  confirmDeleteAccountRequest);

router.get("/get-request", authenticate, getAuthenticatedRequest )

module.exports = router;
