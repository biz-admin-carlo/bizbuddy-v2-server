// src/workers/clockInReminderWorker.js
const cron = require("node-cron");
const { prisma } = require("@config/connection");
const { getIO } = require("@config/socket");
const { getMessaging } = require("@config/firebase");

function combineDateWithTime(referenceDate, timeLikeDate) {
  const ref = new Date(referenceDate);
  const t = new Date(timeLikeDate);
  ref.setSeconds(0, 0);
  ref.setHours(t.getUTCHours(), t.getUTCMinutes(), 0, 0);
  return ref;
}

async function processClockInReminders() {
  const now = new Date();

  // Define today's window
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  // Fetch today's user shifts with users (for deviceToken)
  const todaysUserShifts = await prisma.userShift.findMany({
    where: { assignedDate: { gte: dayStart, lte: dayEnd } },
    include: {
      shift: true,
      user: { select: { id: true, deviceToken: true } },
    },
  });
  if (!todaysUserShifts.length) return;

  const io = getIO();
  const messaging = getMessaging();

  // Preload active logs for users to avoid per-row queries
  const userIds = [...new Set(todaysUserShifts.map((u) => u.userId))];
  const activeLogs = await prisma.timeLog.findMany({
    where: { userId: { in: userIds }, status: true },
    select: { userId: true },
  });
  const activeSet = new Set(activeLogs.map((l) => l.userId));

  for (const us of todaysUserShifts) {
    try {
      // Skip if already clocked in
      if (activeSet.has(us.userId)) continue;

      const shiftStart = combineDateWithTime(
        us.assignedDate,
        us.shift.startTime
      );
      const minutesToStart = (shiftStart.getTime() - now.getTime()) / 60000;
      if (minutesToStart <= 0) continue; // already started

      // Fire around 30 minutes before start
      if (minutesToStart <= 30 && minutesToStart > 29) {
        const marker = `clockinReminder:${us.id}`; // dedupe by userShift id
        const existing = await prisma.userActivity.findFirst({
          where: { userId: us.userId, activityDescription: marker },
        });
        if (existing) continue;

        const minutesRemaining = Math.round(minutesToStart);
        io.to(us.userId).emit("clockInReminder", {
          userId: us.userId,
          userShiftId: us.id,
          shiftStart: shiftStart.toISOString(),
          minutesRemaining,
          message:
            "Your shift starts in 30 minutes. Please remember to clock in.",
        });

        // Send FCM push if possible
        const token = us.user?.deviceToken;
        if (messaging && token) {
          try {
            await messaging.send({
              token,
              notification: {
                title: "Shift starting soon",
                body: "Your shift starts in 30 minutes. Please remember to clock in.",
              },
              data: {
                userShiftId: String(us.id),
                userId: String(us.userId),
                shiftStart: shiftStart.toISOString(),
                minutesRemaining: String(minutesRemaining),
                type: "clockInReminder",
              },
            });
          } catch (pushErr) {
            console.error("[ClockInReminder] FCM send error", us.id, pushErr);
          }
        }

        await prisma.userActivity.create({
          data: { userId: us.userId, activityDescription: marker },
        });
      }
    } catch (err) {
      console.error("[ClockInReminder] Error for userShift", us.id, err);
    }
  }
}

function scheduleClockInReminders() {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      await processClockInReminders();
    } catch (err) {
      console.error("[ClockInReminder] Worker error:", err);
    }
  });
}

module.exports = { scheduleClockInReminders };
