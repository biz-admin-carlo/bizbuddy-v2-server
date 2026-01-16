const { prisma } = require('@config/connection');
const { sendMorningReport } = require('@services/notificationService');
const moment = require('moment-timezone');

/**
 * Send daily morning report to management
 * Lists employees who missed clock-in and who's currently clocked in
 */
async function sendMorningReportJob() {
  console.log('📊 Generating morning reports...');

  try {
    const companies = await prisma.company.findMany({
      where: { notifyAdminMissedClocks: true },
      select: {
        id: true,
        name: true,
        timeZone: true,
        morningReportTime: true,
      },
    });

    for (const company of companies) {
      const timezone = company.timeZone || 'America/Los_Angeles';
      const now = moment().tz(timezone);
      const todayStart = now.clone().startOf('day');
      const todayEnd = now.clone().endOf('day');

      // Get all shifts scheduled for today
      const todayShifts = await prisma.userShift.findMany({
        where: {
          assignedDate: {
            gte: todayStart.toDate(),
            lte: todayEnd.toDate(),
          },
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
          shift: true,
        },
      });

      const missedClockIns = [];
      const currentlyClockedIn = [];

      for (const userShift of todayShifts) {
        const shiftStartTime = moment.tz(
          `${userShift.assignedDate.toISOString().split('T')[0]} ${userShift.customStartTime || userShift.shift.startTime}`,
          timezone
        );

        // Only check shifts that should have started before now
        if (shiftStartTime.isBefore(now)) {
          // Check for clock-in
          const clockIn = await prisma.timeLog.findFirst({
            where: {
              userId: userShift.userId,
              timeIn: {
                gte: shiftStartTime.clone().subtract(30, 'minutes').toDate(),
                lte: now.toDate(),
              },
            },
            orderBy: { timeIn: 'desc' },
          });

          if (!clockIn) {
            // Missed clock-in
            const minutesLate = now.diff(shiftStartTime, 'minutes');
            missedClockIns.push({
              employeeName: `${userShift.user.profile?.firstName || ''} ${userShift.user.profile?.lastName || ''}`.trim() || userShift.user.username,
              department: userShift.user.department?.name || 'N/A',
              scheduledTime: shiftStartTime.format('h:mm A'),
              minutesLate,
              supervisor: userShift.user.department?.supervisor?.username || 'N/A',
            });
          } else if (!clockIn.timeOut) {
            // Currently clocked in
            const hoursWorked = now.diff(moment(clockIn.timeIn), 'hours', true).toFixed(1);
            currentlyClockedIn.push({
              employeeName: `${userShift.user.profile?.firstName || ''} ${userShift.user.profile?.lastName || ''}`.trim() || userShift.user.username,
              department: userShift.user.department?.name || 'N/A',
              clockInTime: moment(clockIn.timeIn).tz(timezone).format('h:mm A'),
              hoursWorked,
            });
          }
        }
      }

      // Send report only if there's something to report
      if (missedClockIns.length > 0 || currentlyClockedIn.length > 0) {
        console.log(`📧 Sending morning report for ${company.name}`);
        await sendMorningReport(company.id, missedClockIns, currentlyClockedIn);
      } else {
        console.log(`✅ No issues to report for ${company.name}`);
      }
    }

    console.log('✅ Morning reports complete');
  } catch (error) {
    console.error('❌ Error sending morning reports:', error);
  }
}

module.exports = sendMorningReportJob;