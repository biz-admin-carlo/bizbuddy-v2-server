// src/services/shiftNotificationService.js

const { prisma } = require('@config/connection');
const { notifyUser } = require('./socketService');

/**
 * Helper: Create notification and send via socket
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
    console.error('❌ Error creating shift notification:', error);
    throw error;
  }
}

/**
 * Notify employee about new shift assignment
 */
async function notifyEmployeeShiftAssigned({
  user,
  shift,
  dates,
  assignedBy,
  companyId,
}) {
  const employeeName = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email;
  
  const dateList = dates.length <= 3 
    ? dates.map(d => new Date(d).toLocaleDateString()).join(', ')
    : `${dates.length} dates`;

  await createNotification({
    userId: user.id,
    companyId,
    departmentId: user.departmentId,
    notificationCode: 'NOTIF001', // General notification
    title: '📅 New Shift Assignment',
    message: `You've been assigned to "${shift.shiftName}" for ${dateList}`,
    payload: {
      shiftId: shift.id,
      shiftName: shift.shiftName,
      startTime: shift.startTime,
      endTime: shift.endTime,
      dates: dates,
      assignedBy: assignedBy,
    },
  });
}

/**
 * Notify employee about shift schedule (recurring)
 */
async function notifyEmployeeScheduleCreated({
  user,
  shift,
  schedule,
  assignedBy,
  companyId,
  totalDates,
}) {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selectedDays = schedule.daysOfWeek
    .map(day => daysOfWeek[day])
    .join(', ');

  await createNotification({
    userId: user.id,
    companyId,
    departmentId: user.departmentId,
    notificationCode: 'NOTIF001',
    title: '📅 Recurring Shift Schedule',
    message: `You've been scheduled for "${shift.shiftName}" on ${selectedDays} (${totalDates} days total)`,
    payload: {
      shiftId: shift.id,
      shiftName: shift.shiftName,
      scheduleId: schedule.id,
      daysOfWeek: selectedDays,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      totalDates,
      assignedBy,
    },
  });
}

/**
 * Notify management about bulk shift assignment
 */
async function notifyManagementShiftAssignment({
  companyId,
  shift,
  assignedCount,
  dates,
  assignmentType,
  assignedBy,
}) {
  // Get all admins, supervisors, and superadmins
  const managementUsers = await prisma.user.findMany({
    where: {
      companyId,
      role: { in: ['admin', 'superadmin', 'supervisor'] },
      status: 'active',
    },
    select: {
      id: true,
      departmentId: true,
    },
  });

  const dateList = dates.length <= 3 
    ? dates.map(d => new Date(d).toLocaleDateString()).join(', ')
    : `${dates.length} dates`;

  const assignmentTypeLabel = {
    all: 'all employees',
    department: 'department',
    individual: `${assignedCount} employee(s)`,
  }[assignmentType] || 'employees';

  // Notify each manager
  const notifications = managementUsers.map(manager =>
    createNotification({
      userId: manager.id,
      companyId,
      departmentId: manager.departmentId,
      notificationCode: 'NOTIF002',
      title: '✅ Shift Assignment Completed',
      message: `"${shift.shiftName}" assigned to ${assignmentTypeLabel} for ${dateList} (${assignedCount} assignments created)`,
      payload: {
        shiftId: shift.id,
        shiftName: shift.shiftName,
        assignedCount,
        dates,
        assignmentType,
        assignedBy,
      },
    })
  );

  await Promise.all(notifications);
}

/**
 * Notify management about recurring schedule creation
 */
async function notifyEmployeeShiftAssigned(userId, shiftData) {
    try {
      if (!shiftData || !shiftData.shiftName) return;
  
      const message = `📅 New Shift Assignment\n\nYou've been assigned to "${shiftData.shiftName}" for ${shiftData.dates.join(', ')}`;
  
      await prisma.notification.create({
        data: {
          userId,
          message,
          type: 'shift_assigned',
        },
      });
  
      io.to(userId).emit('notification', {
        message,
        type: 'shift_assigned',
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error notifying employee about shift assignment:', error);
    }
  }
  
  /**
   * Notify employee when assigned to a recurring schedule
   */
  async function notifyEmployeeScheduleCreated(userId, scheduleData) {
    try {
      if (!scheduleData || !scheduleData.daysOfWeek) return;
  
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const daysFormatted = scheduleData.daysOfWeek
        .sort((a, b) => a - b)
        .map(d => dayNames[d])
        .join(', ');
  
      const message = `📅 Recurring Shift Schedule\n\nYou've been scheduled for "${scheduleData.shiftName}" on ${daysFormatted} (${scheduleData.totalDays} days total)`;
  
      await prisma.notification.create({
        data: {
          userId,
          message,
          type: 'schedule_created',
        },
      });
  
      io.to(userId).emit('notification', {
        message,
        type: 'schedule_created',
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error notifying employee about schedule creation:', error);
    }
  }
  
  /**
   * Notify management about shift assignments
   */
  async function notifyManagementShiftAssignment(companyId, assignmentData) {
    try {
      if (!assignmentData) return;
  
      const managers = await prisma.user.findMany({
        where: {
          companyId,
          role: { in: ['admin', 'superadmin', 'supervisor'] },
        },
        select: { id: true },
      });
  
      const message = `✅ Shift Assignment Completed\n\n"${assignmentData.shiftName}" assigned to ${assignmentData.employeeCount} employee(s) for ${assignmentData.dates.join(', ')} (${assignmentData.totalAssignments} assignments created)`;
  
      const notifications = managers.map(manager => ({
        userId: manager.id,
        message,
        type: 'shift_assignment',
        createdAt: new Date(),
      }));
  
      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
  
        managers.forEach(manager => {
          io.to(manager.id).emit('notification', {
            message,
            type: 'shift_assignment',
            timestamp: new Date(),
          });
        });
      }
    } catch (error) {
      console.error('Error notifying management about shift assignment:', error);
    }
  }
  
  /**
   * Notify management when a recurring schedule is created
   */
  async function notifyManagementScheduleCreated(companyId, scheduleData) {
    try {
      // Validation
      if (!scheduleData || !scheduleData.daysOfWeek) {
        console.error('Invalid scheduleData provided to notifyManagementScheduleCreated');
        return;
      }
  
      const managers = await prisma.user.findMany({
        where: {
          companyId,
          role: { in: ['admin', 'superadmin', 'supervisor'] },
        },
        select: { id: true },
      });
  
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const daysFormatted = scheduleData.daysOfWeek
        .sort((a, b) => a - b)
        .map(d => dayNames[d])
        .join(', ');
  
      const message = `✅ Schedule Created\n\nRecurring schedule for "${scheduleData.shiftName}" (${daysFormatted}) assigned to ${scheduleData.targetCount} employee(s) - ${scheduleData.totalShifts} shifts created`;
  
      const notifications = managers.map(manager => ({
        userId: manager.id,
        message,
        type: 'schedule_created',
        createdAt: new Date(),
      }));
  
      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
  
        managers.forEach(manager => {
          io.to(manager.id).emit('notification', {
            message,
            type: 'schedule_created',
            timestamp: new Date(),
          });
        });
      }
    } catch (error) {
      console.error('Error notifying management about schedule creation:', error);
    }
  }
  
  /**
   * Notify employee when their shift is replaced due to conflict
   */
  async function notifyEmployeeShiftReplaced(userId, replacementData) {
    try {
      if (!replacementData) return;
  
      const message = `⚠️ Shift Changed\n\nYour "${replacementData.oldShiftName}" on ${replacementData.date} was replaced with "${replacementData.newShiftName}"`;
  
      await prisma.notification.create({
        data: {
          userId,
          message,
          type: 'shift_replaced',
        },
      });
  
      io.to(userId).emit('notification', {
        message,
        type: 'shift_replaced',
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error notifying employee about shift replacement:', error);
    }
  }
  
/**
 * Notify employee about shift conflict resolution
 */
async function notifyEmployeeShiftReplaced({
  user,
  oldShift,
  newShift,
  date,
  companyId,
}) {
  await createNotification({
    userId: user.id,
    companyId,
    departmentId: user.departmentId,
    notificationCode: 'NOTIF003',
    title: '⚠️ Shift Changed',
    message: `Your "${oldShift.shiftName}" on ${new Date(date).toLocaleDateString()} was replaced with "${newShift.shiftName}"`,
    payload: {
      oldShiftId: oldShift.id,
      oldShiftName: oldShift.shiftName,
      newShiftId: newShift.id,
      newShiftName: newShift.shiftName,
      date,
    },
  });
}

module.exports = {
  notifyEmployeeShiftAssigned,
  notifyEmployeeScheduleCreated,
  notifyManagementShiftAssignment,
  notifyManagementScheduleCreated,
  notifyEmployeeShiftReplaced,
};