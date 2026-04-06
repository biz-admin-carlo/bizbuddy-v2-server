// src/utils/autoClockOutSafeguard.js

const { prisma } = require("@config/connection");
const { notifyAutoClockOut } = require("../services/notificationService");

/**
 * Auto Clock-Out Safeguard
 *
 * Runs every 10 minutes.
 *
 * TRIGGER:  Active session has been open for 5+ hours from timeIn.
 * TIMEOUT:  Set to the employee's scheduled shift end for that day —
 *           NOT to the 5-hour mark and NOT to the time the cron fires.
 * FALLBACK: If no shift is assigned for that day, timeOut is set to
 *           timeIn + company.defaultShiftHours.
 *
 * autoClockOutAt records when the cron fired (diagnostic only).
 * The resulting record is flagged for mandatory SV review.
 */

const FIVE_HOURS_IN_MS = 5 * 60 * 60 * 1000;

async function autoClockOutSafeguard() {
  try {
    console.log("\n🔔 [AUTO CLOCK-OUT SAFEGUARD] Starting 5-hour check...");

    const fiveHoursAgo = new Date(Date.now() - FIVE_HOURS_IN_MS);

    // ── 1. Fetch all active sessions that have exceeded 5 hours ──────────────
    const activeLogsOver5Hours = await prisma.timeLog.findMany({
      where: {
        status:       true,
        autoClockOut: false,
        timeIn: {
          lte: fiveHoursAgo,
        },
      },
      include: {
        user: {
          include: {
            profile:    true,
            department: true,
            company: {
              select: {
                defaultShiftHours: true,
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
          // Use the scheduled shift end time, anchored to the log's date
          const shiftEnd    = new Date(userShift.shift.endTime);
          resolvedTimeOut   = new Date(log.timeIn);
          resolvedTimeOut.setHours(
            shiftEnd.getUTCHours(),
            shiftEnd.getUTCMinutes(),
            0,
            0
          );

          // If shift end is before shift start it crosses midnight — add a day
          if (resolvedTimeOut <= new Date(log.timeIn)) {
            resolvedTimeOut.setDate(resolvedTimeOut.getDate() + 1);
          }

          timeOutSource = `scheduled shift end (${userShift.shift.shiftName})`;
        } else {
          // Fallback: timeIn + company defaultShiftHours
          const defaultHours =
            parseFloat(log.user.company?.defaultShiftHours ?? 8);
          resolvedTimeOut = new Date(
            new Date(log.timeIn).getTime() + defaultHours * 60 * 60 * 1000
          );
          timeOutSource = `default shift hours fallback (${defaultHours}h)`;
        }

        // ── 4. Build the update payload ───────────────────────────────────────
        const updatedData = {
          timeOut:       resolvedTimeOut, // ← scheduled end, not cron time
          status:        false,
          autoClockOut:  true,
          autoClockOutAt: cronFiredAt,   // ← when cron fired, diagnostic only
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

        // ── 5. Persist ────────────────────────────────────────────────────────
        await prisma.timeLog.update({
          where: { id: log.id },
          data:  updatedData,
        });

        // ── 6. Notify ─────────────────────────────────────────────────────────
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