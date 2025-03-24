// src/controllers/Account/accountSignupController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("@config/connection");
const { JWT_SECRET } = require("@config/env");

const getAllSubscriptionPlans = async (req, res) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { name: "asc" },
    });
    return res.status(200).json({
      message: "Subscription plans retrieved successfully.",
      data: plans,
    });
  } catch (error) {
    console.error("Error in getAllSubscriptionPlans:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * GET /api/account/check-company-name?name=...
 * Checks if a company name is available.
 */
const checkCompanyName = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ message: "Company name is required." });
    }
    const company = await prisma.company.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
    });
    return res.status(200).json({
      message: "Company name check complete.",
      data: { exists: !!company },
    });
  } catch (error) {
    console.error("Error in checkCompanyName:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * GET /api/account/check-username?username=...
 * Checks if a username is available.
 */
const checkUsername = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ message: "Username is required." });
    }
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    return res.status(200).json({
      message: "Username check complete.",
      data: { available: !existingUser },
    });
  } catch (error) {
    console.error("Error in checkUsername:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * POST /api/account/sign-up
 * Creates a new user account, user profile, company, and subscription in a transaction.
 *
 * This function now creates a subscription record with startDate set to the current date
 * and endDate exactly 30 days later.
 */
const signUp = async (req, res) => {
  try {
    const { firstName, lastName, email, password, companyName, country, currency, language, subscriptionPlanId, isPaid, username } = req.body;

    if (!firstName || !lastName || !email || !password || !companyName || !subscriptionPlanId) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // Optionally check username uniqueness globally.
    if (username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username: username.trim().toLowerCase() },
      });
      if (existingUsername) {
        return res.status(409).json({ message: "Username already exists." });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username ? username.trim().toLowerCase() : normalizedEmail;

    // Use a transaction for atomicity.
    const result = await prisma.$transaction(async (tx) => {
      // Create the User.
      const newUser = await tx.user.create({
        data: {
          username: normalizedUsername,
          email: normalizedEmail,
          password: hashedPassword,
          role: "admin",
        },
      });

      // Create the UserProfile.
      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          username: newUser.username,
          email: newUser.email,
          firstName,
          lastName,
        },
      });

      // Create the Company.
      const newCompany = await tx.company.create({
        data: {
          name: companyName,
          userId: newUser.id,
          country: country || "",
          currency: currency || "",
          language: language || "",
        },
      });

      // Link the user to the company.
      await tx.user.update({
        where: { id: newUser.id },
        data: { companyId: newCompany.id },
      });

      // Generate a JWT.
      if (!JWT_SECRET) throw new Error("JWT secret is not configured.");
      const token = jwt.sign({ userId: newUser.id, role: newUser.role, companyId: newCompany.id }, JWT_SECRET, { expiresIn: "10y" });

      // Retrieve the subscription plan.
      const subscriptionPlan = await tx.subscriptionPlan.findUnique({
        where: { id: subscriptionPlanId },
      });
      if (!subscriptionPlan) {
        throw new Error("Invalid subscription plan.");
      }
      const isSubscriptionActive = !!isPaid;

      // Set the subscription dates: startDate now and endDate 30 days later.
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Create the Subscription.
      const newSubscription = await tx.subscription.create({
        data: {
          userId: newUser.id,
          companyId: newCompany.id,
          planId: subscriptionPlan.id,
          active: isSubscriptionActive,
          startDate,
          endDate,
        },
      });

      return { token, newUser, newCompany, newSubscription };
    });

    return res.status(201).json({
      message: "Account, company, and subscription created successfully.",
      data: {
        token: result.token,
        user: {
          id: result.newUser.id,
          email: result.newUser.email,
          role: result.newUser.role,
          companyId: result.newCompany.id,
        },
        subscription: result.newSubscription,
      },
    });
  } catch (error) {
    console.error("Error in signUp:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getAllSubscriptionPlans,
  checkCompanyName,
  checkUsername,
  signUp,
};
