// src/routes/Features/accountDeletionRoutes.js

const express = require("express");
const router = express.Router();
const {
  checkEmailGenerateCode,
  verifyCode,
  confirmDeleteAccountRequest
} = require("@controllers/Features/requestAccountDeletionController");

router.post("/send-code", checkEmailGenerateCode);
router.post("/verify-code",  verifyCode);
router.post("/confirm",  confirmDeleteAccountRequest);

module.exports = router;
