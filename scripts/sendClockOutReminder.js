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
  const force = process.argv.includes("--force");
  const minutesArg = process.argv.find((a) => a.startsWith("--minutes="));
  const overrideMinutes = minutesArg
    ? Math.max(0, parseInt(minutesArg.split("=")[1], 10) || 0)
    : null;
  if (!username) {
    console.error("Usage: node scripts/sendClockOutReminder.js <username>");
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

  const activeLog = await prisma.timeLog.findFirst({
    where: { userId: user.id, status: true },
    select: { id: true, timeIn: true },
  });
  if (!activeLog && !force) {
    console.error(
      "User is not clocked in (no active TimeLog). Use --force to override."
    );
    process.exit(1);
  }

  const baseTime = activeLog?.timeIn || new Date();
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

  let shiftEnd;
  let minutesToEnd;
  if (userShift?.shift) {
    const shiftStart = combineDateWithTime(baseTime, userShift.shift.startTime);
    shiftEnd = combineDateWithTime(baseTime, userShift.shift.endTime);
    if (userShift.shift.crossesMidnight && shiftEnd <= shiftStart) {
      shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
    }
    const now = new Date();
    minutesToEnd = Math.max(
      0,
      Math.round((shiftEnd.getTime() - now.getTime()) / 60000)
    );
  } else {
    const now = new Date();
    const minutes = overrideMinutes != null ? overrideMinutes : 30;
    shiftEnd = new Date(now.getTime() + minutes * 60000);
    minutesToEnd = minutes;
  }

  try {
    const resp = await messaging.send({
      token: user.deviceToken,
      notification: {
        title: "Shift ending soon",
        body: "Your shift ends in 30 minutes. Please remember to clock out.",
      },
      data: {
        timeLogId: String(activeLog?.id || ""),
        userId: String(user.id),
        shiftEnd: shiftEnd.toISOString(),
        minutesRemaining: String(minutesToEnd),
        type: "clockOutReminder",
      },
    });
    console.log("Clock-out reminder sent! Message ID:", resp);
  } catch (err) {
    console.error("Send error:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
