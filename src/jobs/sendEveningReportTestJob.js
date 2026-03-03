const { prisma } = require('@config/connection');
const { sendEveningReport } = require('@services/notificationService');
const moment = require('moment-timezone');

const TEST_EMAIL = 'webdev@bizsolutions.us';

/**
 * TEST VERSION of the evening report job.
 * Sends only to TEST_EMAIL regardless of company admin settings.
 *
 * Fixes applied vs sendEveningReportJob:
 *  1. clockInTime and assignedDate parsed explicitly as UTC via moment.utc()
 *     to prevent server-local-timezone double-conversion.
 *  2. Midnight-crossing detection no longer depends solely on the
 *     shift.crossesMidnight flag — any shiftEndTime that falls before
 *     clockInTime is automatically pushed forward by 1 day, which is
 *     the correct behavior for overnight shifts (e.g. ends at 1:00 AM,
 *     started at 8:00 PM).
 */
async function sendEveningReportTestJob() {
  console.log('[TEST] Generating evening reports...');

  try {
    const companies = await prisma.company.findMany({
      where: { notifyAdminMissedClocks: true },
      select: {
        id: true,
        name: true,
        timeZone: true,
        eveningReportTime: true,
      },
    });

    for (const company of companies) {
      const timezone = company.timeZone || 'America/Los_Angeles';

      // Fix 1: Use moment.utc() so the server's local timezone is never
      // applied before the explicit .tz() conversion.
      const now = moment.utc().tz(timezone);

      // Find all active time logs (still clocked in)
      const stillClockedIn = await prisma.timeLog.findMany({
        where: {
          timeOut: null,
          user: {
            companyId: company.id,
            status: 'active',
          },
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

      const missedClockOuts = [];
      const activeEmployees = [];

      for (const timeLog of stillClockedIn) {
        // Fix 1 (continued): Explicitly parse timeIn as UTC before converting.
        const clockInTime = moment.utc(timeLog.timeIn).tz(timezone);
        const hoursWorked = now.diff(clockInTime, 'hours', true).toFixed(1);

        // Find their shift for today
        const userShift = await prisma.userShift.findFirst({
          where: {
            userId: timeLog.userId,
            assignedDate: {
              gte: clockInTime.clone().startOf('day').toDate(),
              lte: clockInTime.clone().endOf('day').toDate(),
            },
          },
          include: { shift: true },
        });

        const employeeData = {
          employeeName:
            `${timeLog.user.profile?.firstName || ''} ${timeLog.user.profile?.lastName || ''}`.trim() ||
            timeLog.user.username,
          department: timeLog.user.department?.name || 'N/A',
          clockInTime: clockInTime.format('h:mm A'),
          hoursWorked,
        };

        if (userShift) {
          const endTime = userShift.customEndTime || userShift.shift?.endTime;

          if (!endTime) {
            // No end time defined — treat as active
            activeEmployees.push(employeeData);
            continue;
          }

          // Fix 1 (continued): Parse assignedDate as UTC before converting to
          // company timezone so the date string reflects the correct local date.
          const assignedDateStr = moment.utc(userShift.assignedDate).tz(timezone).format('YYYY-MM-DD');
          const shiftEndTime = moment.tz(
            `${assignedDateStr} ${endTime}`,
            'YYYY-MM-DD HH:mm:ss',
            timezone
          );

          if (!shiftEndTime.isValid()) {
            activeEmployees.push(employeeData);
            continue;
          }

          const crossedMidnight = shiftEndTime.isBefore(clockInTime);
          if (crossedMidnight) {
            shiftEndTime.add(1, 'day');
          }

          const isOverdue = now.isAfter(shiftEndTime);

          console.log(`[DEBUG] ${employeeData.employeeName}`);
          console.log(`  clockIn:         ${clockInTime.format('YYYY-MM-DD HH:mm:ss')}`);
          console.log(`  shiftEnd:        ${shiftEndTime.format('YYYY-MM-DD HH:mm:ss')}`);
          console.log(`  now:             ${now.format('YYYY-MM-DD HH:mm:ss')}`);
          console.log(`  crossedMidnight: ${crossedMidnight}`);
          console.log(`  isOverdue:       ${isOverdue}`);

          if (isOverdue) {
            const minutesOverdue = now.diff(shiftEndTime, 'minutes');
            missedClockOuts.push({
              ...employeeData,
              expectedClockOut: shiftEndTime.format('h:mm A'),
              minutesOverdue,
            });
          } else {
            activeEmployees.push({
              ...employeeData,
              expectedClockOut: shiftEndTime.format('h:mm A'),
            });
          }
        } else {
          // No shift assigned — treat as active with no expected end time
          activeEmployees.push(employeeData);
        }
      }

      // Always send in test mode so we can verify the output
      const label =
        missedClockOuts.length === 0 && activeEmployees.length === 0
          ? 'all clocked out'
          : `${missedClockOuts.length} missed, ${activeEmployees.length} active`;

      console.log(`[TEST] Sending evening report for ${company.name} (${label}) → ${TEST_EMAIL}`);

      await sendEveningReport(
        company.id,
        missedClockOuts,
        activeEmployees,
        { testEmail: TEST_EMAIL }
      );
    }

    console.log('[TEST] Evening reports complete.');
  } catch (error) {
    console.error('[TEST] Error sending evening reports:', error);
  }
}

module.exports = sendEveningReportTestJob;