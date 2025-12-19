// src/controllers/Account/accountSigninController.js

const { prisma } = require("@config/connection");
const { JWT_SECRET } = require("@config/env");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const getUserEmail = async (req, res) => {
  console.log("## Check User Email and Retrieved Company");
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: { email: normalizedEmail },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!users || users.length === 0) {
      return res
        .status(404)
        .json({ message: "No users found with this email." });
    }
    const result = users.map((user) => ({
      userId: user.id,
      email: user.email,
      username: user.username,
      companyId: user.companyId,
      companyName: user.company ? user.company.name : null,
    }));
    console.log("## Success");
    return res.status(200).json({ message: "Users found.", data: result });
  } catch (error) {
    console.error("Error in getUserEmail:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "No token provided." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Invalid token." });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid token." });
    }
    const { userId, companyId } = decoded;
    if (!userId || !companyId) {
      return res
        .status(400)
        .json({ message: "Token missing userId or companyId." });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        company: true,
        employmentDetail: {
          include: {
            department: true,
            supervisor: { select: { id: true, email: true } },
          },
        },
        Subscription: {
          where: { active: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { plan: true },
        },
      },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    let latestSubscription =
      user.Subscription && user.Subscription.length > 0
        ? user.Subscription[0]
        : null;
    if (!latestSubscription) {
      const companyWithSub = await prisma.company.findUnique({
        where: { id: companyId },
        include: {
          Subscription: {
            where: { active: true },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { plan: true },
          },
        },
      });
      latestSubscription =
        companyWithSub &&
        companyWithSub.Subscription &&
        companyWithSub.Subscription.length > 0
          ? companyWithSub.Subscription[0]
          : null;
    }
    const { password, Subscription, ...userData } = user;
    return res.status(200).json({
      message: "User profile retrieved successfully.",
      data: {
        user: userData,
        profile: user.profile,
        company: user.company,
        subscription: latestSubscription,
      },
    });
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const signIn = async (req, res) => {
  console.log("## Signin Start");
  try {
    const { email, password, companyId } = req.query;
    if (!email || !password || !companyId) {
      return res
        .status(400)
        .json({ message: "Email, password, and companyId are required." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail, companyId },
      include: { company: true },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { updatedAt: new Date() },
    });
    if (!JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured." });
    }
    const tokenPayload = { userId: user.id, companyId: user.companyId };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "30d" });
    console.log("## Success");
    return res
      .status(200)
      .json({ message: "Sign-in successful.", data: { token } });
  } catch (error) {
    console.error("Error in signIn:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const signOut = (req, res) => {
  return res.status(200).json({ message: "Signed out successfully." });
};

const updateProfile = async (req, res) => {
  try {
    const { id: userId, companyId } = req.user;
    let {
      username,
      email,
      firstName,
      lastName,
      phoneNumber,
      ssnItin,
      dateOfBirth,
      addressLine,
      city,
      state,
      postalCode,
      emergencyContactName,
      emergencyContactPhone,
    } = req.body;

    console.log(req.body);

    // ============================================
    // REQUIRED FIELD VALIDATION
    // ============================================
    if (!username || !email) {
      return res
        .status(400)
        .json({ message: "Username and email are required." });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();

    // ============================================
    // USERNAME VALIDATION
    // Must start and end with alphanumeric
    // Allows . and _ in the middle
    // Minimum 3 characters
    // ============================================
    if (normalizedUsername.length < 3) {
      return res
        .status(400)
        .json({ message: "Username must be at least 3 characters." });
    }

    if (!/^[a-z0-9]([a-z0-9._]*[a-z0-9])?$/i.test(normalizedUsername)) {
      return res.status(400).json({
        message:
          "Username must start and end with a letter or number. Only letters, numbers, periods (.) and underscores (_) are allowed.",
      });
    }

    // Check for consecutive special characters
    if (/[._]{2,}/.test(normalizedUsername)) {
      return res.status(400).json({
        message: "Username cannot contain consecutive periods or underscores.",
      });
    }

    // ============================================
    // EMAIL VALIDATION
    // ============================================
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    // ============================================
    // DUPLICATE USERNAME CHECK
    // ============================================
    const duplicateUsername = await prisma.user.findFirst({
      where: {
        username: { equals: normalizedUsername, mode: "insensitive" },
        NOT: { id: userId },
      },
    });
    if (duplicateUsername) {
      return res.status(400).json({ message: "Username is already taken." });
    }

    // ============================================
    // DUPLICATE EMAIL CHECK (within company)
    // ============================================
    const duplicateEmail = await prisma.user.findFirst({
      where: {
        companyId,
        email: normalizedEmail,
        NOT: { id: userId },
      },
    });
    if (duplicateEmail) {
      return res
        .status(400)
        .json({ message: "Email already exists within the company." });
    }

    // ============================================
    // SSN/ITIN VALIDATION & DUPLICATE CHECK
    // ============================================
    let normalizedSsnItin = null;
    if (ssnItin && ssnItin.trim()) {
      normalizedSsnItin = ssnItin.trim();

      // Validate SSN format (XXX-XX-XXXX or similar with dashes)
      // Allow 9-15 characters including dashes
      if (normalizedSsnItin.length < 9 || normalizedSsnItin.length > 15) {
        return res.status(400).json({
          message: "SSN/ITIN must be between 9 and 15 characters.",
        });
      }

      // Check for duplicate SSN/ITIN
      const duplicateSsn = await prisma.userProfile.findFirst({
        where: {
          ssnItin: normalizedSsnItin,
          NOT: { userId },
        },
      });
      if (duplicateSsn) {
        return res.status(400).json({
          message: "SSN/ITIN is already associated with another employee.",
        });
      }
    }

    // ============================================
    // DATE OF BIRTH VALIDATION
    // ============================================
    let parsedDateOfBirth = null;
    if (dateOfBirth && dateOfBirth.trim()) {
      parsedDateOfBirth = new Date(dateOfBirth);
      if (isNaN(parsedDateOfBirth.getTime())) {
        return res.status(400).json({
          message: "Please enter a valid date of birth.",
        });
      }
    }

    // ============================================
    // UPDATE USER TABLE
    // ============================================
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        username: normalizedUsername,
        email: normalizedEmail,
        updatedAt: new Date(),
      },
    });

    // ============================================
    // UPSERT USER PROFILE
    // ============================================
    const profileData = {
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      phoneNumber: phoneNumber?.trim() || null,
      ssnItin: normalizedSsnItin,
      dateOfBirth: parsedDateOfBirth,
      addressLine: addressLine?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      postalCode: postalCode?.trim() || null,
      emergencyContactName: emergencyContactName?.trim() || null,
      emergencyContactPhone: emergencyContactPhone?.trim() || null,
      email: normalizedEmail,
      username: normalizedUsername,
      updatedAt: new Date(),
    };

    const updatedProfile = await prisma.userProfile.upsert({
      where: { userId },
      update: profileData,
      create: {
        userId,
        ...profileData,
      },
    });

    return res.status(200).json({
      message: "Profile updated successfully.",
      data: { user: updatedUser, profile: updatedProfile },
    });
  } catch (error) {
    console.error("Error in updateProfile:", error);

    // Handle Prisma unique constraint errors
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0];
      if (field === "username") {
        return res.status(400).json({ message: "Username is already taken." });
      }
      if (field === "ssnItin") {
        return res.status(400).json({
          message: "SSN/ITIN is already associated with another employee.",
        });
      }
    }

    return res.status(500).json({ message: "Internal server error." });
  }
};

const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) {
      return res
        .status(400)
        .json({ message: "All password fields are required." });
    }
    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "New password and confirmation do not match." });
    }
    const { id: userId } = req.user;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Old password is incorrect." });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, updatedAt: new Date() },
    });
    return res.status(200).json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Error in changePassword:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getDeviceToken = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required." });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deviceToken: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json({
      message: "Device token retrieved successfully.",
      data: { deviceToken: user.deviceToken },
    });
  } catch (error) {
    console.error("Error in getDeviceToken:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateDeviceToken = async (req, res) => {
  try {
    const { userId, deviceToken } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required." });
    }

    if (!deviceToken) {
      return res.status(400).json({ message: "Device token is required." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        deviceToken: deviceToken.trim(),
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: "Device token updated successfully.",
      data: { deviceToken: updatedUser.deviceToken },
    });
  } catch (error) {
    console.error("Error in updateDeviceToken:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getUserEmail,
  signIn,
  getUserProfile,
  updateProfile,
  changePassword,
  signOut,
  getDeviceToken,
  updateDeviceToken,
};
