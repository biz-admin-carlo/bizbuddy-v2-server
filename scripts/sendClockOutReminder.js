// scripts/sendClockOutReminder.js
require("module-alias/register");
require("dotenv").config();

const { prisma } = require("@config/connection");
const { initFirebase, getMessaging } = require("@config/firebase");
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

async function resolveCompanyTimezone(companyId) {
  if (!companyId) return "America/Los_Angeles";
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { timeZone: true },
  });
  return company?.timeZone || "America/Los_Angeles";
}

async function findUserShiftForMoment(userId, anchorDate, companyTimezone) {
  // Fetch candidate shifts around the anchor moment to avoid relying on server-local midnight.
  const windowStart = new Date(anchorDate.getTime() - 36 * 60 * 60 * 1000);
  const windowEnd = new Date(anchorDate.getTime() + 36 * 60 * 60 * 1000);
  const candidates = await prisma.userShift.findMany({
    where: { userId, assignedDate: { gte: windowStart, lte: windowEnd } },
    include: { shift: true },
  });
  if (!candidates.length) return null;

  // Prefer the one whose assignedDate matches the anchorDate in the effective timezone.
  for (const us of candidates) {
    const tz = normalizeTimezone(us.shift?.timeZone, companyTimezone);
    if (dateKeyInTz(us.assignedDate, tz) === dateKeyInTz(anchorDate, tz)) {
      return us;
    }
  }

  // Fallback: closest assignedDate.
  candidates.sort(
    (a, b) =>
      Math.abs(new Date(a.assignedDate).getTime() - anchorDate.getTime()) -
      Math.abs(new Date(b.assignedDate).getTime() - anchorDate.getTime())
  );
  return candidates[0];
}

async function main() {
  const username = process.argv[2];
  const isStartReminder = process.argv.includes("--start");
  const force = process.argv.includes("--force");
  const debug = process.argv.includes("--debug");
  const minutesArg = process.argv.find((a) => a.startsWith("--minutes="));
  const overrideMinutes = minutesArg
    ? Math.max(0, parseInt(minutesArg.split("=")[1], 10) || 0)
    : null;
  if (!username) {
    console.error(
      "Usage: node scripts/sendClockOutReminder.js <username> [--start] [--force] [--minutes=N] [--debug]"
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
    select: { id: true, deviceToken: true, companyId: true },
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
  const companyTimezone = await resolveCompanyTimezone(user.companyId);
  const userShift = await findUserShiftForMoment(
    user.id,
    baseTime,
    companyTimezone
  );
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
    const tz = normalizeTimezone(userShift.shift.timeZone, companyTimezone);

    shiftStart = combineDateWithTimeTz(referenceDate, startTimeSource, tz);
    shiftEnd = combineDateWithTimeTz(referenceDate, endTimeSource, tz);

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

  // Debug mode: just print out the timing info and exit, no push
  if (debug) {
    const now = new Date();
    console.log("=== Clock reminder debug ===");
    console.log("Now:               ", now.toISOString());
    if (!isStartReminder) {
      console.log("Active TimeLog ID: ", activeLog?.id || "(none)");
      console.log("TimeLog timeIn:    ", activeLog?.timeIn?.toISOString?.() || "(none)");
    }
    console.log("UserShift ID:      ", userShift?.id || "(none)");
    console.log("Shift start:       ", shiftStart?.toISOString() || "(unknown)");
    console.log("Shift end:         ", shiftEnd?.toISOString() || "(unknown)");
    console.log(
      "Minutes to start:  ",
      minutesToStart != null ? minutesToStart : "(n/a)"
    );
    console.log(
      "Minutes to end:    ",
      minutesToEnd != null ? minutesToEnd : "(n/a)"
    );
    await prisma.$disconnect();
    return;
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
          targetScreen: "timekeeping-punch",
          targetRoute: "/(tabs)/(shifts)/timekeeping-punch",
        }
      : {
          timeLogId: String(activeLog?.id || ""),
          userId: String(user.id),
          shiftEnd: shiftEnd ? shiftEnd.toISOString() : "",
          minutesRemaining: String(minutesToEnd ?? ""),
          type: "clockOutReminder",
          targetScreen: "timekeeping-punch",
          targetRoute: "/(tabs)/(shifts)/timekeeping-punch",
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
