// src/controllers/Account/subscriptionController.js
const { prisma } = require("@config/connection");
const { JWT_SECRET } = require("@config/env");
const jwt = require("jsonwebtoken");
const { getIO } = require("@config/socket");

const getCurrentSubscription = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "No company associated with user." });
    }
    const currentSub = await prisma.subscription.findFirst({
      where: { companyId, active: true },
      include: { plan: true },
    });
    if (!currentSub) {
      return res.status(404).json({ message: "No active subscription found." });
    }
    return res.status(200).json({
      message: "Current subscription retrieved successfully.",
      data: currentSub,
    });
  } catch (error) {
    console.error("Error in getCurrentSubscription:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const upgradeSubscription = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Access token missing." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Invalid token format." });
    }
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

    // Get the new planId from the request body.
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({ message: "Plan ID is required." });
    }

    // Validate that the new plan exists.
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(400).json({ message: "Invalid plan ID." });
    }

    // Deactivate all active subscriptions for the company.
    await prisma.subscription.updateMany({
      where: { companyId, active: true },
      data: { active: false, endDate: new Date() },
    });

    // Set the new subscription dates.
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days later

    // Create a new subscription with the new plan.
    const newSubscription = await prisma.subscription.create({
      data: {
        userId,
        companyId,
        planId,
        active: true,
        startDate,
        endDate,
      },
      include: { plan: true },
    });

    // Emit the subscription update event via Socket.IO.
    const io = getIO();
    io.emit("subscriptionUpdated", { subscription: newSubscription });

    return res.status(201).json({
      message: "Subscription upgraded successfully.",
      data: newSubscription,
    });
  } catch (error) {
    console.error("Error in upgradeSubscription:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const cancelCurrentSubscription = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "No company associated with user." });
    }
    const activeSub = await prisma.subscription.findFirst({
      where: { companyId, active: true },
    });
    if (!activeSub) {
      return res.status(404).json({ message: "No active subscription found." });
    }
    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: { active: false, endDate: new Date() },
    });
    return res.status(200).json({ message: "Subscription cancelled successfully." });
  } catch (error) {
    console.error("Error in cancelCurrentSubscription:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getCurrentSubscription,
  upgradeSubscription,
  cancelCurrentSubscription,
};
