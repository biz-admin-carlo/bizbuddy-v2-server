// src/utils/notificationFunction.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createNotification = async (notificationCode, userId, options = {}) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, departmentId: true },
    });

    if (!user) {
      console.warn(`⚠️ Notification skipped. User not found: ${userId}`);
      return null;
    }

    const data = {
      userId,
      companyId: options.companyId || user.companyId,
      departmentId: options.departmentId || user.departmentId,
      notificationCode,
      title: options.title || "System Notification",
      message: options.message || null,
      payload: options.payload || null,
    };

    const notif = await prisma.notificationLog.create({ data });
    console.log(`🔔 Notification created: ${notificationCode} for ${userId}`);
    return notif;
  } catch (error) {
    console.error("❌ Error creating notification:", error);
    return null;
  }
};

module.exports = { createNotification };
