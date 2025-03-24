// src/controllers/Features/userPresenceController.js
const { prisma } = require("@config/connection");

const getUserPresence = async (req, res) => {
  try {
    const userId = req.user.id;
    let presence = await prisma.userPresence.findUnique({ where: { userId } });

    if (!presence) {
      presence = await prisma.userPresence.create({
        data: {
          userId,
          presenceStatus: "available",
          lastActiveAt: new Date(),
        },
      });
    }

    return res.status(200).json({ data: presence });
  } catch (error) {
    console.error("Error retrieving presence:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const updateUserPresence = async (req, res) => {
  try {
    const userId = req.user.id;
    const { presenceStatus, lastActiveAt } = req.body;
    const allowedStatuses = ["available", "away", "offline"];
    if (!allowedStatuses.includes(presenceStatus)) {
      return res.status(400).json({ message: "Invalid presence status" });
    }

    const updatedPresence = await prisma.userPresence.upsert({
      where: { userId },
      update: {
        presenceStatus,
        lastActiveAt: new Date(lastActiveAt),
      },
      create: {
        userId,
        presenceStatus,
        lastActiveAt: new Date(lastActiveAt),
      },
    });
    return res.status(200).json({ data: updatedPresence });
  } catch (error) {
    console.error("Error updating presence:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = { getUserPresence, updateUserPresence };
