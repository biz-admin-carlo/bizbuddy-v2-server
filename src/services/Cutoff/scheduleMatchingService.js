// services/Cutoff/scheduleMatchingService.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Get employee's schedule for a specific date
 */
async function getEmployeeScheduleForDate(userId, date) {
  try {
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Find user's shift assignment for this date
    const userShift = await prisma.userShift.findFirst({
      where: {
        userId,
        assignedDate: {
          gte: startOfDay,
          lte: endOfDay
        },
        status: 'scheduled'
      },
      include: {
        shift: true
      }
    });
    
    if (!userShift) {
      return null; // No schedule for this day
    }
    
    const shift = userShift.shift;
    
    // Use custom times if it's a split shift, otherwise use shift template times
    const startTime = userShift.isSplitShift && userShift.customStartTime
      ? userShift.customStartTime
      : shift.startTime;
      
    const endTime = userShift.isSplitShift && userShift.customEndTime
      ? userShift.customEndTime
      : shift.endTime;
    
    // Calculate scheduled times for this specific date
    const scheduledStart = new Date(targetDate);
    const shiftStart = new Date(startTime);
    scheduledStart.setHours(shiftStart.getUTCHours(), shiftStart.getUTCMinutes(), 0, 0);
    
    const scheduledEnd = new Date(targetDate);
    const shiftEnd = new Date(endTime);
    scheduledEnd.setHours(shiftEnd.getUTCHours(), shiftEnd.getUTCMinutes(), 0, 0);
    
    // Handle midnight crossing
    if (shift.crossesMidnight) {
      scheduledEnd.setDate(scheduledEnd.getDate() + 1);
    }
    
    // Calculate scheduled hours
    const scheduledMs = scheduledEnd - scheduledStart;
    const scheduledHours = scheduledMs / (1000 * 60 * 60);
    
    return {
      shiftId: shift.id,
      shiftName: shift.shiftName,
      scheduledStart: scheduledStart,
      scheduledEnd: scheduledEnd,
      scheduledHours: parseFloat(scheduledHours.toFixed(2)),
      crossesMidnight: shift.crossesMidnight,
      differentialMultiplier: parseFloat(shift.differentialMultiplier || 1.0),
      userShiftId: userShift.id,
      isSplitShift: userShift.isSplitShift || false
    };
  } catch (error) {
    console.error('Error getting employee schedule:', error);
    return null;
  }
}

/**
 * Calculate time log metrics vs schedule
 */
function calculateTimeLogMetrics(timeLog, schedule, gracePeriodMinutes = 15) {
  const clockIn = new Date(timeLog.timeIn);
  const clockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
  
  // If not clocked out yet
  if (!clockOut) {
    return {
      actualHours: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      lateStatus: 'not_clocked_out',
      variance: 0,
      hasSchedule: !!schedule
    };
  }
  
  // Calculate actual hours worked
  const actualMs = clockOut - clockIn;
  const actualHours = actualMs / (1000 * 60 * 60);
  
  // If no schedule, actual hours become the baseline
  if (!schedule) {
    return {
      actualHours: parseFloat(actualHours.toFixed(2)),
      lateMinutes: 0,
      earlyMinutes: 0,
      lateStatus: 'no_schedule',
      variance: 0,
      hasSchedule: false
    };
  }
  
  // Calculate late arrival (only apply grace to clock-in)
  const lateMs = clockIn - schedule.scheduledStart;
  const lateMinutes = Math.max(0, Math.floor(lateMs / (1000 * 60)));
  
  let lateStatus = 'on_time';
  if (lateMinutes > 0) {
    if (lateMinutes <= gracePeriodMinutes) {
      lateStatus = 'within_grace'; // No penalty
    } else {
      lateStatus = 'beyond_grace'; // Penalty applies
    }
  } else if (lateMinutes < 0) {
    lateStatus = 'early_arrival'; // Clocked in early
  }
  
  // Calculate early departure
  const earlyMs = schedule.scheduledEnd - clockOut;
  const earlyMinutes = Math.max(0, Math.floor(earlyMs / (1000 * 60)));
  
  // Calculate variance (actual - scheduled)
  const variance = actualHours - schedule.scheduledHours;
  
  return {
    actualHours: parseFloat(actualHours.toFixed(2)),
    lateMinutes,
    earlyMinutes,
    lateStatus,
    variance: parseFloat(variance.toFixed(2)),
    hasSchedule: true,
    scheduledHours: schedule.scheduledHours
  };
}

/**
 * Calculate break deductions from break logs
 */
async function calculateBreakDeductions(timeLogId, companyId) {
  try {
    // Get company's break policy
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        minimumLunchMinutes: true
      }
    });

    // Get user's department break policy
    const timeLog = await prisma.timeLog.findUnique({
      where: { id: timeLogId },
      include: {
        user: {
          include: {
            department: {
              select: {
                paidBreak: true,
                breakDuration: true,
                coffeeBreakMaxCount: true,
                coffeeBreakMinutes: true,
                coffeeBreakPaid: true
              }
            }
          }
        }
      }
    });

    if (!timeLog) {
      return getDefaultBreakData();
    }

    const department = timeLog.user.department;
    
    // Parse break data from timeLog JSON fields
    const lunchBreakData = timeLog.lunchBreak || {};
    const coffeeBreaksData = timeLog.coffeeBreaks || [];

    // Calculate lunch break
    let lunchMinutes = 0;
    let lunchPaid = false;
    
    if (lunchBreakData.start && lunchBreakData.end) {
      const lunchStart = new Date(lunchBreakData.start);
      const lunchEnd = new Date(lunchBreakData.end);
      lunchMinutes = (lunchEnd - lunchStart) / (1000 * 60);
      lunchPaid = department?.paidBreak || false;
    }

    // Calculate coffee breaks
    let coffeeMinutes = 0;
    const coffeeBreaks = [];
    
    if (Array.isArray(coffeeBreaksData)) {
      coffeeBreaksData.forEach(coffeeBreak => {
        if (coffeeBreak.start && coffeeBreak.end) {
          const start = new Date(coffeeBreak.start);
          const end = new Date(coffeeBreak.end);
          const duration = (end - start) / (1000 * 60);
          
          coffeeMinutes += duration;
          coffeeBreaks.push({
            start: start,
            end: end,
            minutes: parseFloat(duration.toFixed(2))
          });
        }
      });
    }

    // Check coffee policy
    const coffeePolicyMinutes = department?.coffeeBreakMinutes || 0;
    const coffeeAllowedCount = department?.coffeeBreakMaxCount || 0;
    const coffeePaid = department?.coffeeBreakPaid || false;
    
    const coffeeExcessMinutes = Math.max(0, coffeeMinutes - coffeePolicyMinutes);
    const coffeeExcessCount = Math.max(0, coffeeBreaks.length - coffeeAllowedCount);
    
    // Calculate total deductions
    const lunchDeduction = lunchPaid ? 0 : lunchMinutes;
    const coffeeDeduction = coffeePaid ? 0 : coffeeExcessMinutes;
    const totalDeductionMinutes = lunchDeduction + coffeeDeduction;

    return {
      lunch: {
        minutes: parseFloat(lunchMinutes.toFixed(2)),
        isPaid: lunchPaid,
        deducted: !lunchPaid && lunchMinutes > 0
      },
      coffee: {
        totalMinutes: parseFloat(coffeeMinutes.toFixed(2)),
        breaks: coffeeBreaks,
        count: coffeeBreaks.length,
        policy: {
          hasPolicy: coffeePolicyMinutes > 0 || coffeeAllowedCount > 0,
          allowedMinutes: coffeePolicyMinutes,
          allowedCount: coffeeAllowedCount,
          exceeded: coffeeMinutes > coffeePolicyMinutes || coffeeBreaks.length > coffeeAllowedCount,
          excessMinutes: parseFloat(coffeeExcessMinutes.toFixed(2)),
          excessCount: coffeeExcessCount,
          isPaid: coffeePaid
        }
      },
      totalDeductions: {
        minutes: parseFloat(totalDeductionMinutes.toFixed(2)),
        hours: parseFloat((totalDeductionMinutes / 60).toFixed(2))
      }
    };
  } catch (error) {
    console.error('Error calculating break deductions:', error);
    return getDefaultBreakData();
  }
}

/**
 * Calculate payroll hours (final payable amount)
 */
function calculatePayrollHours(calculatedData, breakData, schedule) {
  const scheduledHours = schedule?.scheduledHours || 0;
  const actualHours = calculatedData.actualHours || 0;
  
  // Start with scheduled hours as baseline
  let payableRegular = scheduledHours;
  
  // If no schedule, use actual hours
  if (!schedule || scheduledHours === 0) {
    payableRegular = actualHours;
  }
  
  // Deduct unpaid breaks
  const breakHours = breakData.totalDeductions.hours || 0;
  payableRegular = Math.max(0, payableRegular - breakHours);
  
  // Get approved OT (this would come from Overtime table)
  // For now, we'll calculate OT as hours beyond schedule
  const potentialOT = Math.max(0, actualHours - scheduledHours - breakHours);
  
  return {
    payableRegularHours: parseFloat(payableRegular.toFixed(2)),
    approvedOTHours: 0, // Will be set from actual OT approvals
    potentialOTHours: parseFloat(potentialOT.toFixed(2)),
    totalPayableHours: parseFloat(payableRegular.toFixed(2)),
    breakDeductionHours: breakHours
  };
}

/**
 * Helper: Default break data structure
 */
function getDefaultBreakData() {
  return {
    lunch: {
      minutes: 0,
      isPaid: false,
      deducted: false
    },
    coffee: {
      totalMinutes: 0,
      breaks: [],
      count: 0,
      policy: {
        hasPolicy: false,
        allowedMinutes: 0,
        allowedCount: 0,
        exceeded: false,
        excessMinutes: 0,
        excessCount: 0,
        isPaid: false
      }
    },
    totalDeductions: {
      minutes: 0,
      hours: 0
    }
  };
}

/**
 * Get approved overtime for a time log
 */
async function getApprovedOvertime(timeLogId) {
  try {
    const overtime = await prisma.overtime.findFirst({
      where: {
        timeLogId,
        status: 'approved'
      },
      select: {
        requestedHours: true,
        lateHours: true,
        approverComments: true
      }
    });

    if (!overtime) {
      return {
        hasApprovedOT: false,
        approvedOTHours: 0
      };
    }

    const otHours = parseFloat(overtime.requestedHours || overtime.lateHours || 0);

    return {
      hasApprovedOT: true,
      approvedOTHours: parseFloat(otHours.toFixed(2)),
      comments: overtime.approverComments
    };
  } catch (error) {
    console.error('Error getting approved overtime:', error);
    return {
      hasApprovedOT: false,
      approvedOTHours: 0
    };
  }
}

module.exports = {
  getEmployeeScheduleForDate,
  calculateTimeLogMetrics,
  calculateBreakDeductions,
  calculatePayrollHours,
  getApprovedOvertime
};