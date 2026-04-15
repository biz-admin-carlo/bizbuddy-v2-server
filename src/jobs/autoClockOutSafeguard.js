// src/jobs/autoClockOutSafeguard.js

const moment = require("moment-timezone");
const { prisma } = require("@config/connection");
const { notifyAutoClockOut } = require("../services/notificationService");

/**
 * Auto Clock-Out Safeguard
 *
 * Runs every 10 minutes.
 *
 * TRIGGER:  Active session is still open 5+ hours past the employee's
 *           scheduled shift end time for that day.
 * TIMEOUT:  Set to the employee's scheduled shift end for that day —
 *           resolved in the shift's timezone (or company timezone as fallback)
 *           so that shift times stored as plain clock-time values (db.Time)
 *           are interpreted correctly regardless of server timezone.
 * FALLBACK: If no shift is assigned for that day, timeOut is set to
 *           timeIn + company.defaultShiftHours.
 *
 * autoClockOutAt records when the cron fired (diagnostic only).
 * The resulting record is flagged for mandatory SV review.
 */

const FIVE_HOURS_IN_MS = 5 * 60 * 60 * 1000;

// ── Timezone helpers (mirrors clockInReminderWorker pattern) ─────────────────

/**
 * Extracts the raw HH:mm:ss string from a Prisma @db.Time value.
 * Prisma returns Time columns as a Date anchored to the UTC epoch
 * (1970-01-01THH:mm:ssZ), so getUTCHours/Minutes gives the stored clock time.
 */
function timeStrFromDbTime(timeLikeDate) {
  const t = new Date(timeLikeDate);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Picks the best valid IANA timezone string from the candidates.
 * Falls back to "Asia/Manila" (default company timezone).
 */
function normalizeTimezone(preferredTz, fallbackTz) {
  const tz = preferredTz || fallbackTz || "America/Los_Angeles";
  if (moment.tz.zone(tz)) return tz;
  if (fallbackTz && moment.tz.zone(fallbackTz)) return fallbackTz;
  return "America/Los_Angeles";
}

/**
 * Combines a reference date (to get the calendar date) with a @db.Time value,
 * interpreted in the given IANA timezone. Returns a proper UTC Date.
 *
 * Example: referenceDate = Apr 9 clock-in, timeLikeDate = 14:45 (stored),
 *          tz = "Asia/Manila" → 2026-04-09 14:45:00 PHT → UTC Date
 */
function combineDateWithTimeTz(referenceDate, timeLikeDate, tz) {
  const dateOnly = moment(referenceDate).tz(tz).format("YYYY-MM-DD");
  const timeStr  = timeStrFromDbTime(timeLikeDate);
  return moment.tz(`${dateOnly} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz).toDate();
}

// ────────────────────────────────────────────────────────────────────────────

async function autoClockOutSafeguard() {
  try {
    console.log("\n🔔 [AUTO CLOCK-OUT SAFEGUARD] Starting 5-hour check...");

    // ── 1. Fetch all active sessions ──────────────────────────────────────────
    const activeLogsOver5Hours = await prisma.timeLog.findMany({
      where: {
        status:       true,
        autoClockOut: false,
      },
      include: {
        user: {
          include: {
            profile:    true,
            department: true,
            company: {
              select: {
                defaultShiftHours: true,
                timeZone:          true,
              },
            },
          },
        },
      },
    });

    if (activeLogsOver5Hours.length === 0) {
      console.log("   ✅ No sessions over 5 hours. All good!");
      return;
    }

    console.log(
      `   ⚠️  Found ${activeLogsOver5Hours.length} session(s) exceeding 5 hours`
    );

    const cronFiredAt = new Date(); // diagnostic timestamp — NOT used as timeOut
    let successCount = 0;
    let errorCount   = 0;

    for (const log of activeLogsOver5Hours) {
      try {
        // ── 2. Look up the employee's UserShift for the clock-in date ────────
        const logDate      = new Date(log.timeIn);
        const logDateStart = new Date(logDate);
        logDateStart.setHours(0, 0, 0, 0);
        const logDateEnd = new Date(logDateStart);
        logDateEnd.setHours(23, 59, 59, 999);

        const userShift = await prisma.userShift.findFirst({
          where: {
            userId:       log.userId,
            assignedDate: {
              gte: logDateStart,
              lte: logDateEnd,
            },
            status: { not: "cancelled" },
          },
          include: {
            shift: true,
          },
          orderBy: {
            // If multiple shifts that day, pick the latest-ending one
            shift: { endTime: "desc" },
          },
        });

        // ── 3. Resolve the correct timeOut value ─────────────────────────────
        let resolvedTimeOut;
        let timeOutSource;

        if (userShift?.shift?.endTime) {
          // Resolve shift end in the shift's timezone (falls back to company tz)
          const tz = normalizeTimezone(
            userShift.shift.timeZone,
            log.user.company?.timeZone
          );

          resolvedTimeOut = combineDateWithTimeTz(log.timeIn, userShift.shift.endTime, tz);

          // If shift end resolves to before clock-in, it crosses midnight — add a day
          if (resolvedTimeOut <= new Date(log.timeIn)) {
            resolvedTimeOut = moment(resolvedTimeOut).add(1, "day").toDate();
          }

          timeOutSource = `scheduled shift end (${userShift.shift.shiftName}, tz: ${tz})`;
        } else {
          // Fallback: timeIn + company defaultShiftHours
          const defaultHours =
            parseFloat(log.user.company?.defaultShiftHours ?? 8);
          resolvedTimeOut = new Date(
            new Date(log.timeIn).getTime() + defaultHours * 60 * 60 * 1000
          );
          timeOutSource = `default shift hours fallback (${defaultHours}h)`;
        }

        // ── 4. Skip unless BOTH conditions are met:
        //       a) now is 5+ hours past the resolved shift end (overdue session)
        //       b) employee has actually been clocked in for 5+ hours
        //      Without (b), late clock-ins get swept up and backdated to shift
        //      end with only minutes of work recorded.
        const fiveHoursPastShiftEnd = resolvedTimeOut.getTime() + FIVE_HOURS_IN_MS;
        const fiveHoursPastClockIn  = new Date(log.timeIn).getTime() + FIVE_HOURS_IN_MS;

        if (Date.now() < fiveHoursPastShiftEnd || Date.now() < fiveHoursPastClockIn) {
          continue;
        }

        // ── 5. Build the update payload ───────────────────────────────────────
        const updatedData = {
          timeOut:        resolvedTimeOut, // ← scheduled end in correct tz, not cron time
          status:         false,
          autoClockOut:   true,
          autoClockOutAt: cronFiredAt,     // ← when cron fired, diagnostic only
        };

        // Close any active coffee breaks at cron fire time
        if (log.coffeeBreaks && Array.isArray(log.coffeeBreaks)) {
          updatedData.coffeeBreaks = log.coffeeBreaks.map((b) =>
            b.start && !b.end
              ? { ...b, end: cronFiredAt.toISOString() }
              : b
          );
        }

        // Close active lunch break at cron fire time
        if (log.lunchBreak?.start && !log.lunchBreak?.end) {
          updatedData.lunchBreak = {
            ...log.lunchBreak,
            end: cronFiredAt.toISOString(),
          };
        }

        // ── 6. Persist ────────────────────────────────────────────────────────
        await prisma.timeLog.update({
          where: { id: log.id },
          data:  updatedData,
        });

        // ── 7. Notify ─────────────────────────────────────────────────────────
        const hoursWorked = (
          (resolvedTimeOut - new Date(log.timeIn)) / (1000 * 60 * 60)
        ).toFixed(2);

        await notifyAutoClockOut({
          user: log.user,
          timeLog: {
            id:          log.id,
            timeIn:      log.timeIn,
            timeOut:     resolvedTimeOut,
            hoursWorked: parseFloat(hoursWorked),
          },
        });

        const name = [
          log.user.profile?.firstName,
          log.user.profile?.lastName,
        ].filter(Boolean).join(" ") || log.user.email;

        console.log(
          `   ✓ Auto clocked out: ${name}` +
          ` | timeOut → ${resolvedTimeOut.toISOString()} (${timeOutSource})` +
          ` | ${hoursWorked}h recorded`
        );

        successCount++;
      } catch (err) {
        console.error(`   ❌ Error processing log ${log.id}:`, err.message);
        errorCount++;
        continue;
      }
    }

    console.log(
      `   ✅ Safeguard check complete: ${successCount} success, ${errorCount} errors`
    );
  } catch (err) {
    console.error("   ❌ [AUTO CLOCK-OUT SAFEGUARD] Fatal error:", err);
  }
}

module.exports = autoClockOutSafeguard;
