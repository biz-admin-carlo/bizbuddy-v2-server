// src/workers/clockOutReminderWorker.js
const cron = require("node-cron");
const { prisma } = require("@config/connection");
const { getIO } = require("@config/socket");
const { getMessaging } = require("@config/firebase");

function combineDateWithTime(referenceDate, timeLikeDate) {
  // Prisma returns @db.Time as a Date with a UTC time component.
  // We read its UTC hours/minutes and set them on the reference date.
  const ref = new Date(referenceDate);
  const t = new Date(timeLikeDate);
  ref.setSeconds(0, 0);
  ref.setHours(t.getUTCHours(), t.getUTCMinutes(), 0, 0);
  return ref;
}

async function processClockOutReminders() {
  const now = new Date();

  // Fetch all active time logs (users currently clocked in)
  const activeLogs = await prisma.timeLog.findMany({
    where: { status: true },
    include: { user: { select: { deviceToken: true } } },
  });
  if (!activeLogs.length) return;

  const io = getIO();

  for (const log of activeLogs) {
    try {
      // Determine the user's shift for the day they clocked in
      const dayStart = new Date(log.timeIn);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const userShift = await prisma.userShift.findFirst({
        where: {
          userId: log.userId,
          assignedDate: { gte: dayStart, lte: dayEnd },
        },
        include: { shift: true },
      });

      if (!userShift?.shift) continue;

      const shiftStart = combineDateWithTime(
        log.timeIn,
        userShift.shift.startTime
      );
      let shiftEnd = combineDateWithTime(log.timeIn, userShift.shift.endTime);

      // Handle shifts that cross midnight (end on the next calendar day)
      if (userShift.shift.crossesMidnight && shiftEnd <= shiftStart) {
        shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const minutesToEnd = (shiftEnd.getTime() - now.getTime()) / 60000;
      if (minutesToEnd <= 0) continue; // already past end

      // Trigger reminder if we are roughly 30 minutes before end.
      // Use a small window so a once-per-minute cron won't miss it.
      if (minutesToEnd <= 30 && minutesToEnd > 29) {
        const marker = `clockoutReminder:${log.id}`;
        const existing = await prisma.userActivity.findFirst({
          where: { userId: log.userId, activityDescription: marker },
        });
        if (existing) continue; // already reminded for this active timelog

        io.to(log.userId).emit("clockOutReminder", {
          timeLogId: log.id,
          userId: log.userId,
          shiftEnd: shiftEnd.toISOString(),
          minutesRemaining: Math.round(minutesToEnd),
          message:
            "Your shift ends in 30 minutes. Please remember to clock out.",
        });

        // Send Firebase Cloud Messaging push if available
        const messaging = getMessaging();
        const token = log.user?.deviceToken;
        if (messaging && token) {
          try {
            await messaging.send({
              token,
              notification: {
                title: "Shift ending soon",
                body: "Your shift ends in 30 minutes. Please remember to clock out.",
              },
              data: {
                timeLogId: String(log.id),
                userId: String(log.userId),
                shiftEnd: shiftEnd.toISOString(),
                minutesRemaining: String(Math.round(minutesToEnd)),
                type: "clockOutReminder",
              },
            });
          } catch (pushErr) {
            console.error("[ClockOutReminder] FCM send error", log.id, pushErr);
          }
        }

        await prisma.userActivity.create({
          data: {
            userId: log.userId,
            activityDescription: marker,
          },
        });
      }
    } catch (err) {
      console.error("[ClockOutReminder] Error processing log", log.id, err);
    }
  }
}

function scheduleClockOutReminders() {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      await processClockOutReminders();
    } catch (err) {
      console.error("[ClockOutReminder] Worker error:", err);
    }
  });
}

module.exports = { scheduleClockOutReminders };
