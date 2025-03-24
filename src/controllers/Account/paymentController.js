// src/controllers/Account/paymentController.js

const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const { prisma } = require("@config/connection");
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, JWT_SECRET } = require("@config/env");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

const createPaymentIntent = async (req, res) => {
  try {
    let { amount, planId } = req.body;
    if (!amount || !planId) {
      return res.status(400).json({ message: "Amount and planId are required." });
    }
    // Convert dollars to cents using Math.round to avoid floating point issues.
    const amountCents = Math.round(amount * 100);

    // Default values if not provided by client.
    let email = req.body.email || "N/A";
    let companyId = req.body.companyId || "N/A";

    // If auth middleware attached req.user, override email and companyId.
    if (req.user) {
      email = req.user.email;
      companyId = req.user.companyId;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { planId, email, companyId },
    });

    return res.status(200).json({
      message: "Payment intent created successfully.",
      data: { clientSecret: paymentIntent.client_secret },
    });
  } catch (error) {
    console.error("Error in createPaymentIntent:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * POST /api/payments/create-upgrade-payment-intent
 * Creates a PaymentIntent specifically for subscription upgrades.
 * Expects: { amount (in dollars), planId }
 *
 * This endpoint decodes the token from the Authorization header,
 * then retrieves the user's email and the company's name from the database.
 * These values are then passed in Stripe metadata.
 */
const createUpgradePaymentIntent = async (req, res) => {
  try {
    // Extract the token from the Authorization header.
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Access token missing." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Invalid token format." });
    }

    // Decode token using JWT_SECRET.
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token." });
    }
    const { userId, companyId } = decoded;
    if (!userId || !companyId) {
      return res.status(400).json({ message: "Token missing userId or companyId." });
    }

    // Retrieve the user's email.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const email = user.email;

    // Retrieve the company's name.
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    const companyName = company.name;

    // Get planId and amount from request body.
    const { planId, amount } = req.body;
    if (!planId || !amount) {
      return res.status(400).json({ message: "Plan ID and amount are required." });
    }
    // Convert dollars to cents.
    const amountCents = Math.round(Number(amount) * 100);

    // Create the PaymentIntent on Stripe.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { planId, email, companyName },
    });

    return res.status(200).json({
      message: "Upgrade payment intent created successfully.",
      data: { clientSecret: paymentIntent.client_secret },
    });
  } catch (error) {
    console.error("Error in createUpgradePaymentIntent:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * POST /api/payments/stripe-webhook
 * Processes Stripe webhook events.
 */
const registerPayment = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  let charge;
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    charge = paymentIntent.charges?.data?.[0];
  } else if (event.type === "charge.succeeded") {
    charge = event.data.object;
  } else {
    console.log("Unhandled event type:", event.type);
    return res.status(200).send("Unhandled event type.");
  }
  if (!charge) {
    console.error("No charge object found in event.");
    return res.status(400).send("No charge found.");
  }
  try {
    const paymentRecord = await prisma.payment.create({
      data: {
        stripeId: charge.id,
        // For recording, prefer billing_details; if missing, fall back to metadata.
        // In upgrade payments, our metadata now includes the companyName (not companyId)
        companyName: charge.billing_details?.name || charge.metadata?.companyName || "N/A",
        email: charge.billing_details?.email || charge.metadata?.email || "N/A",
        amount: charge.amount / 100, // Stripe returns amount in cents.
        paymentMethod: charge.payment_method_details?.type || null,
        paymentMethodType: charge.payment_method_details?.type || null,
        cardLast4: charge.payment_method_details?.card?.last4 || null,
        cardBrand: charge.payment_method_details?.card?.brand || null,
        cardExpMonth: charge.payment_method_details?.card?.exp_month || null,
        cardExpYear: charge.payment_method_details?.card?.exp_year || null,
        paymentReceiptUrl: charge.receipt_url || null,
        paymentIntentId: event.type === "charge.succeeded" ? null : event.data.object.id,
        planId: charge.metadata?.planId || null,
        paymentStatus: charge.status || null,
      },
    });
    console.log("Payment record created:", paymentRecord);
  } catch (error) {
    console.error("Error storing payment in DB:", error);
    return res.status(500).send("Error storing payment in DB.");
  }
  return res.status(200).send("Payment recorded successfully!");
};

module.exports = {
  createPaymentIntent,
  createUpgradePaymentIntent,
  registerPayment,
};
