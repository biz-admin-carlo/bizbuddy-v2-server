const { prisma } = require('@config/connection');
const { sendEveningReport } = require('@services/notificationService');
const moment = require('moment-timezone');

/**
 * Send daily evening report to management
 * Lists employees who haven't clocked out and who's still clocked in
 */
async function sendEveningReportJob() {
  console.log('📊 Generating evening reports...');

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
      const now = moment().tz(timezone);

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
        const clockInTime = moment(timeLog.timeIn).tz(timezone);
        const hoursWorked = now.diff(clockInTime, 'hours', true).toFixed(1);

        // Find their shift
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
          employeeName: `${timeLog.user.profile?.firstName || ''} ${timeLog.user.profile?.lastName || ''}`.trim() || timeLog.user.username,
          department: timeLog.user.department?.name || 'N/A',
          clockInTime: clockInTime.format('h:mm A'),
          hoursWorked,
        };

        if (userShift) {
          const shiftEndTime = moment.tz(
            `${userShift.assignedDate.toISOString().split('T')[0]} ${userShift.customEndTime || userShift.shift.endTime}`,
            timezone
          );

          if (userShift.shift.crossesMidnight && shiftEndTime.isBefore(clockInTime)) {
            shiftEndTime.add(1, 'day');
          }

          if (now.isAfter(shiftEndTime)) {
            // Should have clocked out by now
            const minutesOverdue = now.diff(shiftEndTime, 'minutes');
            missedClockOuts.push({
              ...employeeData,
              expectedClockOut: shiftEndTime.format('h:mm A'),
              minutesOverdue,
            });
          } else {
            // Still within shift time
            activeEmployees.push({
              ...employeeData,
              expectedClockOut: shiftEndTime.format('h:mm A'),
            });
          }
        } else {
          // No shift found but still clocked in
          activeEmployees.push(employeeData);
        }
      }

      // Send report
      if (missedClockOuts.length > 0 || activeEmployees.length > 0) {
        console.log(`📧 Sending evening report for ${company.name}`);
        await sendEveningReport(company.id, missedClockOuts, activeEmployees);
      } else {
        console.log(`✅ All employees clocked out for ${company.name}`);
      }
    }

    console.log('✅ Evening reports complete');
  } catch (error) {
    console.error('❌ Error sending evening reports:', error);
  }
}

module.exports = sendEveningReportJob;