// src/routes/Account/accountRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const { getUserEmail, getUserProfile, signIn, signOut, updateProfile, changePassword } = require("@controllers/Account/accountSigninController");
const { getAllSubscriptionPlans, checkCompanyName, checkUsername, signUp } = require("@controllers/Account/accountSignupController");
const deleteAccountController = require("@controllers/Account/accountDeleteController");

router.get("/get-user-email", getUserEmail);
router.get("/profile", getUserProfile);
router.put("/profile", authenticate, updateProfile);
router.put("/change-password", authenticate, changePassword);
router.get("/sign-in", signIn);
router.post("/sign-out", signOut);
router.get("/plans", getAllSubscriptionPlans);
router.get("/check-company-name", checkCompanyName);
router.get("/check-username", checkUsername);
router.post("/sign-up", signUp);
router.delete("/delete", authenticate, deleteAccountController);

module.exports = router;
