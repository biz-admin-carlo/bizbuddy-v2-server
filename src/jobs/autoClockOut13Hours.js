// src/utils/autoClockOut13Hours.js

const { prisma } = require("@config/connection");
const { notifyAutoClockOut } = require("../services/notificationService");

/**
 * Auto Clock-Out Job
 * Runs every 10 minutes to check for time logs that have exceeded 13 hours
 * Automatically clocks out employees and ends their active breaks
 */

const THIRTEEN_HOURS_IN_MS = 13 * 60 * 60 * 1000; // 13 hours in milliseconds

async function autoClockOut13Hours() {
  try {
    console.log("\n🔔 [AUTO CLOCK-OUT] Starting 13-hour check...");

    // Calculate the cutoff time (13 hours ago from now)
    const thirteenHoursAgo = new Date(Date.now() - THIRTEEN_HOURS_IN_MS);

    // Find all active time logs that are 13+ hours old
    const activeLogsOver13Hours = await prisma.timeLog.findMany({
      where: {
        status: true, // Only active (not clocked out)
        timeIn: {
          lte: thirteenHoursAgo, // Time-in was 13+ hours ago
        },
        autoClockOut: false, // Not already auto-clocked out (extra safety)
      },
      include: {
        user: {
          include: {
            profile: true,
            department: true,
          },
        },
      },
    });

    if (activeLogsOver13Hours.length === 0) {
      console.log("   ✅ No employees over 13 hours. All good!");
      return;
    }

    console.log(
      `   ⚠️  Found ${activeLogsOver13Hours.length} employee(s) who exceeded 13 hours`
    );

    // Process each time log
    let successCount = 0;
    let errorCount = 0;

    for (const log of activeLogsOver13Hours) {
      try {
        const autoClockOutTime = new Date();
        const hoursWorked = (
          (autoClockOutTime - new Date(log.timeIn)) /
          (1000 * 60 * 60)
        ).toFixed(2);

        // End active breaks before clocking out (Option A)
        const updatedData = {
          timeOut: autoClockOutTime,
          status: false,
          autoClockOut: true,
          autoClockOutAt: autoClockOutTime,
        };

        // Handle active coffee breaks
        if (log.coffeeBreaks && Array.isArray(log.coffeeBreaks)) {
          const breaks = log.coffeeBreaks.map((b) => {
            if (b.end === null) {
              // End active coffee break
              return {
                ...b,
                end: autoClockOutTime.toISOString(),
              };
            }
            return b;
          });
          updatedData.coffeeBreaks = breaks;
        }

        // Handle active lunch break
        if (log.lunchBreak && log.lunchBreak.start && !log.lunchBreak.end) {
          updatedData.lunchBreak = {
            ...log.lunchBreak,
            end: autoClockOutTime.toISOString(),
          };
        }

        // Update the time log
        await prisma.timeLog.update({
          where: { id: log.id },
          data: updatedData,
        });

        // Send notifications (internal + email + socket)
        await notifyAutoClockOut({
          user: log.user,
          timeLog: {
            id: log.id,
            timeIn: log.timeIn,
            timeOut: autoClockOutTime,
            hoursWorked: parseFloat(hoursWorked),
          },
        });

        console.log(
          `   ✓ Clocked out: ${
            log.user.profile?.firstName || ""
          } ${log.user.profile?.lastName || ""} (${hoursWorked} hours)`
        );

        successCount++;
      } catch (error) {
        console.error(
          `   ❌ Error processing log ${log.id}:`,
          error.message
        );
        errorCount++;
        // Continue processing other logs even if one fails
        continue;
      }
    }

    console.log(
      `   ✅ Auto clock-out check completed: ${successCount} success, ${errorCount} errors`
    );
  } catch (error) {
    console.error("   ❌ [AUTO CLOCK-OUT] Fatal error during check:", error);
  }
}

module.exports = autoClockOut13Hours;