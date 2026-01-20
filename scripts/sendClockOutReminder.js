// scripts/sendClockOutReminder.js
require("module-alias/register");
require("dotenv").config();

const { prisma } = require("@config/connection");
const { initFirebase, getMessaging } = require("@config/firebase");

function combineDateWithTime(referenceDate, timeLikeDate) {
  const ref = new Date(referenceDate);
  const t = new Date(timeLikeDate);
  ref.setSeconds(0, 0);
  ref.setHours(t.getUTCHours(), t.getUTCMinutes(), 0, 0);
  return ref;
}

async function main() {
  const username = process.argv[2];
  const isStartReminder = process.argv.includes("--start");
  const force = process.argv.includes("--force");
  const minutesArg = process.argv.find((a) => a.startsWith("--minutes="));
  const overrideMinutes = minutesArg
    ? Math.max(0, parseInt(minutesArg.split("=")[1], 10) || 0)
    : null;
  if (!username) {
    console.error(
      "Usage: node scripts/sendClockOutReminder.js <username> [--start] [--force] [--minutes=N]"
    );
    process.exit(1);
  }

  initFirebase();
  const messaging = getMessaging();
  if (!messaging) {
    console.error("Firebase messaging not available. Check env config.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, deviceToken: true },
  });
  if (!user) {
    console.error(`User not found: ${username}`);
    process.exit(1);
  }
  if (!user.deviceToken) {
    console.error(`No deviceToken for user: ${username}`);
    process.exit(1);
  }

  // For clock-out reminders we require an active TimeLog (unless --force).
  // For shift-start reminders we do not require the user to be clocked in.
  const activeLog = !isStartReminder
    ? await prisma.timeLog.findFirst({
        where: { userId: user.id, status: true },
        select: { id: true, timeIn: true },
      })
    : null;
  if (!isStartReminder && !activeLog && !force) {
    console.error(
      "User is not clocked in (no active TimeLog). Use --force to override."
    );
    process.exit(1);
  }

  const baseTime = isStartReminder
    ? new Date()
    : activeLog?.timeIn || new Date();
  const dayStart = new Date(baseTime);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const userShift = await prisma.userShift.findFirst({
    where: { userId: user.id, assignedDate: { gte: dayStart, lte: dayEnd } },
    include: { shift: true },
  });
  if (!userShift?.shift && !force) {
    console.error("No shift found for today. Use --force to override.");
    process.exit(1);
  }

  let shiftStart;
  let shiftEnd;
  let minutesToStart = null;
  let minutesToEnd = null;
  if (userShift?.shift) {
    // Prefer custom start/end times from UserShift when present, otherwise
    // fall back to the base Shift's startTime/endTime from the Shift table.
    const hasCustomTimes =
      userShift.customStartTime && userShift.customEndTime;

    const startTimeSource = hasCustomTimes
      ? userShift.customStartTime
      : userShift.shift.startTime;
    const endTimeSource = hasCustomTimes
      ? userShift.customEndTime
      : userShift.shift.endTime;

    // Use the assignedDate of the UserShift as the base calendar date when
    // available; otherwise fall back to the clock-in/base time.
    const referenceDate = userShift.assignedDate || baseTime;

    shiftStart = combineDateWithTime(referenceDate, startTimeSource);
    shiftEnd = combineDateWithTime(referenceDate, endTimeSource);

    // If the Shift record is marked as crossing midnight or the computed
    // end is before/equal to start (can happen with custom times),
    // roll the end time forward by one day.
    const crossesMidnight =
      userShift.shift.crossesMidnight || shiftEnd <= shiftStart;
    if (crossesMidnight && shiftEnd <= shiftStart) {
      shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    const now = new Date();
    minutesToStart = Math.max(
      0,
      Math.round((shiftStart.getTime() - now.getTime()) / 60000)
    );
    minutesToEnd = Math.max(
      0,
      Math.round((shiftEnd.getTime() - now.getTime()) / 60000)
    );
  } else {
    const now = new Date();
    const minutes = overrideMinutes != null ? overrideMinutes : 30;
    if (isStartReminder) {
      shiftStart = new Date(now.getTime() + minutes * 60000);
      minutesToStart = minutes;
    } else {
      shiftEnd = new Date(now.getTime() + minutes * 60000);
      minutesToEnd = minutes;
    }
  }

  try {
    const isStart = isStartReminder;
    const notification = isStart
      ? {
          title: "Shift starting soon",
          body: "Your shift starts in 30 minutes. Please remember to clock in.",
        }
      : {
          title: "Shift ending soon",
          body: "Your shift ends in 30 minutes. Please remember to clock out.",
        };

    const data = isStart
      ? {
          userId: String(user.id),
          shiftStart: shiftStart ? shiftStart.toISOString() : "",
          minutesRemaining: String(minutesToStart ?? ""),
          type: "clockInReminder",
        }
      : {
          timeLogId: String(activeLog?.id || ""),
          userId: String(user.id),
          shiftEnd: shiftEnd ? shiftEnd.toISOString() : "",
          minutesRemaining: String(minutesToEnd ?? ""),
          type: "clockOutReminder",
        };

    const resp = await messaging.send({
      token: user.deviceToken,
      notification,
      data,
    });

    console.log(
      isStart
        ? "Shift-start reminder sent! Message ID:"
        : "Clock-out reminder sent! Message ID:",
      resp
    );
  } catch (err) {
    console.error("Send error:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
