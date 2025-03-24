// src/routes/Account/paymentRoutes.js

const express = require("express");
const bodyParser = require("body-parser");
const router = express.Router();
const { createPaymentIntent, createUpgradePaymentIntent, registerPayment } = require("@controllers/Account/paymentController");

router.post("/create-payment-intent", createPaymentIntent);
router.post("/create-upgrade-payment-intent", createUpgradePaymentIntent);
router.post("/stripe-webhook", bodyParser.raw({ type: "application/json" }), registerPayment);

module.exports = router;
