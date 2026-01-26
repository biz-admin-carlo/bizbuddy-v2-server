// src/workers/clockInReminderWorker.js
const cron = require("node-cron");
const { prisma } = require("@config/connection");
const { getIO } = require("@config/socket");
const { getMessaging } = require("@config/firebase");
const moment = require("moment-timezone");

function timeStrFromDbTime(timeLikeDate) {
  const t = new Date(timeLikeDate);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function dateKeyInTz(date, tz) {
  return moment(date).tz(tz).format("YYYY-MM-DD");
}

function normalizeTimezone(preferredTz, fallbackTz) {
  const tz = preferredTz || fallbackTz || "America/Los_Angeles";
  if (moment.tz.zone(tz)) return tz;
  if (fallbackTz && moment.tz.zone(fallbackTz)) return fallbackTz;
  return "America/Los_Angeles";
}

function combineDateWithTimeTz(referenceDate, timeLikeDate, tz) {
  const dateOnly = dateKeyInTz(referenceDate, tz);
  const timeStr = timeStrFromDbTime(timeLikeDate);
  return moment.tz(`${dateOnly} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz).toDate();
}

async function processClockInReminders() {
  const now = new Date();

  // Query a broad window to avoid relying on server-local midnight (companies can have different timezones).
  const windowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  // Fetch candidate user shifts with users (for deviceToken)
  const todaysUserShifts = await prisma.userShift.findMany({
    where: { assignedDate: { gte: windowStart, lte: windowEnd } },
    include: {
      shift: { select: { startTime: true, timeZone: true, companyId: true } },
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

  // Cache company timezones to avoid repeated DB lookups
  const companyTzCache = new Map();
  async function getCompanyTimezone(companyId) {
    if (!companyId) return "America/Los_Angeles";
    if (companyTzCache.has(companyId)) return companyTzCache.get(companyId);
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { timeZone: true },
    });
    const tz = company?.timeZone || "America/Los_Angeles";
    companyTzCache.set(companyId, tz);
    return tz;
  }

  for (const us of todaysUserShifts) {
    try {
      // Skip if already clocked in
      if (activeSet.has(us.userId)) continue;

      const companyTz = await getCompanyTimezone(us.shift?.companyId);
      const tz = normalizeTimezone(us.shift?.timeZone, companyTz);

      // Only consider shifts whose assignedDate matches "today" for that timezone.
      if (dateKeyInTz(us.assignedDate, tz) !== dateKeyInTz(now, tz)) continue;

      const shiftStart = combineDateWithTimeTz(us.assignedDate, us.shift.startTime, tz);
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
                targetScreen: "timekeeping-punch",
                targetRoute: "/(tabs)/(shifts)/timekeeping-punch",
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
