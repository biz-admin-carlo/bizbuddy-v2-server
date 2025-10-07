// src/routes/Account/accountRoutes.js

const express = require("express");
const router = express.Router();
const authenticate = require("@middlewares/authMiddleware");
const {
  getUserEmail,
  getUserProfile,
  signIn,
  signOut,
  updateProfile,
  changePassword,
  getDeviceToken,
  updateDeviceToken,
} = require("@controllers/Account/accountSigninController");
const {
  getAllSubscriptionPlans,
  checkCompanyName,
  checkUsername,
  signUp,
  getApprover
} = require("@controllers/Account/accountSignupController");
const deleteAccountController = require("@controllers/Account/accountDeleteController");

router.get("/get-user-email", getUserEmail);
router.get("/profile", getUserProfile);
router.get("/approver", authenticate, getApprover);
router.put("/profile", authenticate, updateProfile);
router.put("/change-password", authenticate, changePassword);
router.get("/device-token", authenticate, getDeviceToken);
router.post("/device-token", authenticate, updateDeviceToken);
router.get("/sign-in", signIn);
router.post("/sign-out", signOut);
router.get("/plans", getAllSubscriptionPlans);
router.get("/check-company-name", checkCompanyName);
router.get("/check-username", checkUsername);
router.post("/sign-up", signUp);
router.delete("/delete", authenticate, deleteAccountController);

module.exports = router;
