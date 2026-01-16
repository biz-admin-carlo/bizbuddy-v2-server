const { prisma } = require('@config/connection');
const { sendEmail } = require('./emailService');
const { notifyUser, notifyManagement } = require('./socketService');
const { getIO } = require('@config/socket');
/**
 * Create internal notification (database + socket)
 */
async function createNotification({
  userId,
  companyId,
  departmentId,
  notificationCode,
  title,
  message,
  payload = {},
}) {
  try {
    // Save to database
    const notification = await prisma.notificationLog.create({
      data: {
        userId,
        companyId,
        departmentId,
        notificationCode,
        title,
        message,
        payload,
      },
    });

    // Send via Socket.io
    notifyUser(userId, {
      id: notification.id,
      type: notificationCode,
      title,
      message,
      payload,
      createdAt: notification.createdAt,
      seen: false,
    });

    return notification;
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    throw error;
  }
}

/**
 * Send email notification and log it
 */
async function sendEmailNotification({
  to,
  subject,
  templateName,
  context,
  notificationType,
  recipientUserId,
  companyId,
  metadata = {},
}) {
  try {
    // Send email
    const result = await sendEmail({
      to,
      subject,
      templateName,
      context,
    });

    // Log email sent
    await prisma.emailNotificationLog.create({
      data: {
        notificationType,
        recipientEmail: to,
        recipientUserId,
        companyId,
        subject,
        body: JSON.stringify(context),
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error || null,
        metadata,
      },
    });

    return result;
  } catch (error) {
    console.error('❌ Error sending email notification:', error);
    throw error;
  }
}

/**
 * Notify employee about missed clock-in
 */
async function notifyMissedClockIn(employee, shift, company) {
  const { user, shiftDetails } = employee;

  // Internal notification
  await createNotification({
    userId: user.id,
    companyId: company.id,
    departmentId: user.departmentId,
    notificationCode: 'MISSED_CLOCK_IN',
    title: '⏰ Missed Clock-In',
    message: `You haven't clocked in for your ${shiftDetails.shiftName} shift scheduled at ${shiftDetails.startTime}.`,
    payload: {
      shiftId: shiftDetails.shiftId,
      scheduledStart: shiftDetails.scheduledStart,
      shiftName: shiftDetails.shiftName,
    },
  });

  // Email notification (if enabled)
  if (company.notifyEmployeeMissedIn && user.email) {
    await sendEmailNotification({
      to: user.email,
      subject: '⏰ Reminder: Missing Clock-In',
      templateName: 'missedClockIn',
      context: {
        employeeName: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.username,
        shiftName: shiftDetails.shiftName,
        scheduledStart: shiftDetails.startTime,
        currentTime: new Date().toLocaleTimeString('en-US'),
        department: user.department?.name || 'N/A',
        appUrl: process.env.CLIENT_URL,
      },
      notificationType: 'MISSED_CLOCK_IN',
      recipientUserId: user.id,
      companyId: company.id,
      metadata: { shiftId: shiftDetails.shiftId },
    });
  }
}

/**
 * Notify employee about missed clock-out
 */
async function notifyMissedClockOut(employee, timeLog, company) {
  const { user } = employee;

  // Internal notification
  await createNotification({
    userId: user.id,
    companyId: company.id,
    departmentId: user.departmentId,
    notificationCode: 'MISSED_CLOCK_OUT',
    title: '⏰ Missed Clock-Out',
    message: `You haven't clocked out yet. Your shift ended at ${new Date(timeLog.expectedClockOut).toLocaleTimeString('en-US')}.`,
    payload: {
      timeLogId: timeLog.id,
      clockInTime: timeLog.timeIn,
      expectedClockOut: timeLog.expectedClockOut,
    },
  });

  // Email notification (if enabled)
  if (company.notifyEmployeeMissedOut && user.email) {
    await sendEmailNotification({
      to: user.email,
      subject: '⏰ Reminder: Missing Clock-Out',
      templateName: 'missedClockOut',
      context: {
        employeeName: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.username,
        clockInTime: new Date(timeLog.timeIn).toLocaleTimeString('en-US'),
        expectedClockOut: new Date(timeLog.expectedClockOut).toLocaleTimeString('en-US'),
        hoursWorked: timeLog.hoursWorked,
        appUrl: process.env.CLIENT_URL,
      },
      notificationType: 'MISSED_CLOCK_OUT',
      recipientUserId: user.id,
      companyId: company.id,
      metadata: { timeLogId: timeLog.id },
    });
  }
}

/**
 * Send daily morning report to management
 */
async function sendMorningReport(companyId, missedClockIns, currentlyClockedIn) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });

  if (!company.notifyAdminMissedClocks) return;

  // Get management users
  const managementUsers = await prisma.user.findMany({
    where: {
      companyId,
      role: { in: ['admin', 'superadmin', 'supervisor'] },
      status: 'active',
    },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
    },
  });

  const emailPromises = managementUsers.map(async (manager) => {
    // Internal notification
    await createNotification({
      userId: manager.id,
      companyId,
      departmentId: null,
      notificationCode: 'DAILY_CLOCK_IN_REPORT',
      title: '📊 Morning Clock-In Report',
      message: `${missedClockIns.length} employees missed clock-in. ${currentlyClockedIn.length} employees are currently clocked in.`,
      payload: {
        missedCount: missedClockIns.length,
        clockedInCount: currentlyClockedIn.length,
      },
    });

    // Email notification
    if (manager.email) {
      await sendEmailNotification({
        to: manager.email,
        subject: `🔔 Morning Clock-In Report - ${missedClockIns.length} Missed`,
        templateName: 'morningReport',
        context: {
          managerName: manager.username,
          companyName: company.name,
          reportDate: new Date().toLocaleDateString('en-US'),
          missedClockIns,
          currentlyClockedIn,
          appUrl: process.env.CLIENT_URL,
        },
        notificationType: 'DAILY_CLOCK_IN_REPORT',
        recipientUserId: manager.id,
        companyId,
        metadata: {
          missedCount: missedClockIns.length,
          clockedInCount: currentlyClockedIn.length,
        },
      });
    }
  });

  await Promise.all(emailPromises);
}

/**
 * Send daily evening report to management
 */
async function sendEveningReport(companyId, missedClockOuts, stillClockedIn) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });

  if (!company.notifyAdminMissedClocks) return;

  const managementUsers = await prisma.user.findMany({
    where: {
      companyId,
      role: { in: ['admin', 'superadmin', 'supervisor'] },
      status: 'active',
    },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
    },
  });

  const emailPromises = managementUsers.map(async (manager) => {
    // Internal notification
    await createNotification({
      userId: manager.id,
      companyId,
      departmentId: null,
      notificationCode: 'DAILY_CLOCK_OUT_REPORT',
      title: '📊 Evening Clock-Out Report',
      message: `${missedClockOuts.length} employees haven't clocked out. ${stillClockedIn.length} employees are still clocked in.`,
      payload: {
        missedCount: missedClockOuts.length,
        stillClockedInCount: stillClockedIn.length,
      },
    });

    // Email notification
    if (manager.email) {
      await sendEmailNotification({
        to: manager.email,
        subject: `🔔 Evening Clock-Out Report - ${missedClockOuts.length} Missed`,
        templateName: 'eveningReport',
        context: {
          managerName: manager.username,
          companyName: company.name,
          reportDate: new Date().toLocaleDateString('en-US'),
          missedClockOuts,
          stillClockedIn,
          appUrl: process.env.CLIENT_URL,
        },
        notificationType: 'DAILY_CLOCK_OUT_REPORT',
        recipientUserId: manager.id,
        companyId,
        metadata: {
          missedCount: missedClockOuts.length,
          stillClockedInCount: stillClockedIn.length,
        },
      });
    }
  });

  await Promise.all(emailPromises);
}

/**
 * Notify employee about automatic clock-out after 13 hours
 */
async function notifyAutoClockOut({ user, timeLog }) {
  const companyId = user.companyId;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });

  // 1. Internal notification (database + socket)
  await createNotification({
    userId: user.id,
    companyId: user.companyId,
    departmentId: user.departmentId,
    notificationCode: 'AUTO_CLOCK_OUT',
    title: '⏰ Automatic Clock-Out',
    message: `You were automatically clocked out after working ${timeLog.hoursWorked} hours (13-hour limit reached).`,
    payload: {
      timeLogId: timeLog.id,
      timeIn: timeLog.timeIn,
      timeOut: timeLog.timeOut,
      hoursWorked: timeLog.hoursWorked,
    },
  });

  // 2. Socket.IO real-time notification
  const io = getIO();
  io.to(user.id).emit('autoClockOut', {
    type: 'autoClockOut',
    message: `You were automatically clocked out after 13 hours of work.`,
    data: {
      timeLogId: timeLog.id,
      timeIn: timeLog.timeIn,
      timeOut: timeLog.timeOut,
      hoursWorked: timeLog.hoursWorked,
    },
  });

  // 3. Email notification
  if (user.email) {
    await sendEmailNotification({
      to: user.email,
      subject: '⏰ Automatic Clock-Out - 13 Hour Limit Reached',
      templateName: 'autoClockOut',
      context: {
        employeeName:
          `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
          user.username,
        clockInTime: new Date(timeLog.timeIn).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        clockOutTime: new Date(timeLog.timeOut).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        hoursWorked: timeLog.hoursWorked,
        companyName: company?.name || 'BizBuddy',
        appUrl: process.env.CLIENT_URL,
      },
      notificationType: 'AUTO_CLOCK_OUT',
      recipientUserId: user.id,
      companyId: user.companyId,
      metadata: {
        timeLogId: timeLog.id,
        hoursWorked: timeLog.hoursWorked,
      },
    });
  }
}

module.exports = {
  createNotification,
  sendEmailNotification,
  notifyMissedClockIn,
  notifyMissedClockOut,
  sendMorningReport,
  sendEveningReport,
  notifyAutoClockOut,
};