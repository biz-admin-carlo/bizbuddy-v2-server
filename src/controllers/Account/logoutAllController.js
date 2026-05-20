// src/controllers/Account/logoutAllController.js

const { prisma } = require("@config/connection");

/**
 * POST /account/logout-all
 *
 * Increments tokenVersion for the currently authenticated user account.
 * This invalidates all existing JWTs issued for this account across
 * all devices (web, iOS, Android) — they will receive a 401 on their
 * next authenticated request and be redirected to sign in.
 *
 * Note: This only affects the specific account the user is signed into.
 * Other company accounts sharing the same email are unaffected.
 */
const logoutAll = async (req, res) => {
  try {
    const { id: userId } = req.user;

    await prisma.user.update({
      where: { id: userId },
      data: {
        tokenVersion: { increment: 1 },
        registeredDeviceId: null,
        registeredDeviceAt: null,
        updatedAt: new Date(),
      },
    });

    console.log(`All sessions invalidated for user: ${userId}`);

    return res.status(200).json({
      message: "All devices have been signed out successfully.",
      success: true,
    });
  } catch (error) {
    console.error("Error in logoutAll:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { logoutAll };