// src/controllers/Features/cutoffPeriodController.js
// COMPLETE VERSION - Grace Period + Break Integration + Timezone Fix

const { prisma } = require("@config/connection");
const moment = require('moment-timezone');

/**
 * Helper function to calculate hours between two timestamps
 */
function calculateHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const diff = new Date(timeOut) - new Date(timeIn);
  return diff / (1000 * 60 * 60); // Convert milliseconds to hours
}

/**
 * Helper function to get date only (no time) for schedule matching
 */
function getDateOnly(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * ✨ FIXED: Timezone-aware combine date + time
 */
function combineDateTime(date, time, shiftTimezone = 'Asia/Manila', companyTimezone = 'Asia/Manila') {
  const dateOnly = moment(date).format('YYYY-MM-DD');
  
  // Extract time as string (HH:mm:ss)
  let timeStr;
  if (typeof time === 'string') {
    timeStr = time;
  } else if (time instanceof Date) {
    const hours = String(time.getUTCHours()).padStart(2, '0');
    const minutes = String(time.getUTCMinutes()).padStart(2, '0');
    const seconds = String(time.getUTCSeconds()).padStart(2, '0');
    timeStr = `${hours}:${minutes}:${seconds}`;
  } else {
    console.error('Invalid time format:', time);
    timeStr = '00:00:00';
  }
  
  const timezone = shiftTimezone || companyTimezone;
  const combined = moment.tz(`${dateOnly} ${timeStr}`, timezone);
  return combined.toDate();
}

/**
 * ✨ Helper: Check if date matches recurrence pattern
 */
function matchesRecurrencePattern(date, pattern) {
  if (!pattern) return false;
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().substring(0, 2);
  return pattern.includes(dayOfWeek);
}

/**
 * ✨ Helper: Fetch schedule (checks UserShift first, then ShiftSchedule)
 */
async function fetchScheduleForDate(userId, dateOnly, userDepartmentId) {
  let userShift = await prisma.userShift.findFirst({
    where: {
      userId,
      assignedDate: {
        gte: dateOnly,
        lt: new Date(dateOnly.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    include: { 
      shift: {
        select: {
          id: true,
          shiftName: true,
          startTime: true,
          endTime: true,
          crossesMidnight: true,
          timeZone: true,
        }
      } 
    },
  });

  if (userShift) return userShift;

  const schedules = await prisma.shiftSchedule.findMany({
    where: {
      OR: [
        { assignedUserId: userId },
        { assignedToAll: true },
        { assignedToDepartment: true, departmentId: userDepartmentId }
      ],
      startDate: { lte: dateOnly },
      OR: [{ endDate: null }, { endDate: { gte: dateOnly } }]
    },
    include: { 
      shift: {
        select: {
          id: true,
          shiftName: true,
          startTime: true,
          endTime: true,
          crossesMidnight: true,
          timeZone: true,
        }
      }
    }
  });

  for (const schedule of schedules) {
    if (matchesRecurrencePattern(dateOnly, schedule.recurrencePattern)) {
      return { 
        shift: schedule.shift, 
        customStartTime: null, 
        customEndTime: null 
      };
    }
  }

  return null;
}

// =====================================================
// BREAK TIME CALCULATION HELPERS
// =====================================================

/**
 * Parse and calculate break times from TimeLog JSON fields
 */
function calculateBreakTimes(timeLog, department) {
  let totalBreakMinutes = 0;
  let unpaidBreakMinutes = 0;
  let coffeeBreakMinutes = 0;
  let lunchBreakMinutes = 0;
  const coffeeBreaksList = [];
  
  // Parse lunch break
  if (timeLog.lunchBreak && typeof timeLog.lunchBreak === 'object') {
    const { breakOut, breakIn } = timeLog.lunchBreak;
    
    if (breakOut && breakIn) {
      const lunchOut = new Date(breakOut);
      const lunchIn = new Date(breakIn);
      lunchBreakMinutes = (lunchIn - lunchOut) / (60 * 1000);
      
      totalBreakMinutes += lunchBreakMinutes;
      
      if (!department.paidBreak) {
        unpaidBreakMinutes += lunchBreakMinutes;
      }
    }
  }
  
  // Parse coffee breaks
  if (timeLog.coffeeBreaks && Array.isArray(timeLog.coffeeBreaks)) {
    timeLog.coffeeBreaks.forEach((coffeeBreak, index) => {
      if (coffeeBreak.breakOut && coffeeBreak.breakIn) {
        const coffeeOut = new Date(coffeeBreak.breakOut);
        const coffeeIn = new Date(coffeeBreak.breakIn);
        const duration = (coffeeIn - coffeeOut) / (60 * 1000);
        
        coffeeBreaksList.push({
          index: index + 1,
          breakOut: coffeeOut,
          breakIn: coffeeIn,
          duration: duration,
        });
        
        coffeeBreakMinutes += duration;
        totalBreakMinutes += duration;
      }
    });
  }
  
  return {
    totalBreakMinutes: parseFloat(totalBreakMinutes.toFixed(2)),
    unpaidBreakMinutes: parseFloat(unpaidBreakMinutes.toFixed(2)),
    lunchBreakMinutes: parseFloat(lunchBreakMinutes.toFixed(2)),
    coffeeBreakMinutes: parseFloat(coffeeBreakMinutes.toFixed(2)),
    coffeeBreaksList,
    hasLunchBreak: lunchBreakMinutes > 0,
    hasCoffeeBreaks: coffeeBreakMinutes > 0,
  };
}

/**
 * Check if coffee breaks exceed department policy
 */
function checkCoffeeBreakPolicy(coffeeBreakMinutes, department) {
  const maxCount = department.coffeeBreakMaxCount || 0;
  const minutesPerBreak = department.coffeeBreakMinutes || 0;
  const allowedMinutes = maxCount * minutesPerBreak;
  const isPaid = department.coffeeBreakPaid || false;
  
  if (maxCount === 0 || minutesPerBreak === 0) {
    return {
      hasPolicy: false,
      exceeded: false,
      allowedMinutes: 0,
      actualMinutes: coffeeBreakMinutes,
      excessMinutes: 0,
      deductMinutes: 0,
      isPaid: false,
    };
  }
  
  const exceeded = coffeeBreakMinutes > allowedMinutes;
  const excessMinutes = exceeded ? coffeeBreakMinutes - allowedMinutes : 0;
  const deductMinutes = excessMinutes; // Always deduct excess
  
  return {
    hasPolicy: true,
    exceeded,
    allowedMinutes: parseFloat(allowedMinutes.toFixed(2)),
    actualMinutes: parseFloat(coffeeBreakMinutes.toFixed(2)),
    excessMinutes: parseFloat(excessMinutes.toFixed(2)),
    deductMinutes: parseFloat(deductMinutes.toFixed(2)),
    isPaid,
  };
}

/**
 * Calculate total deductions from breaks
 */
function calculateBreakDeductions(breakData, coffeePolicy) {
  let totalDeductMinutes = 0;
  totalDeductMinutes += breakData.unpaidBreakMinutes;
  totalDeductMinutes += coffeePolicy.deductMinutes;
  return parseFloat(totalDeductMinutes.toFixed(2));
}

/**
 * Create a new cutoff period
 * POST /api/cutoff-periods/create
 * Access: Admin, Supervisor, Superadmin
 */
const createCutoffPeriod = async (req, res) => {
  try {
    const { periodStart, periodEnd, paymentDate, frequency } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!periodStart || !periodEnd || !paymentDate || !frequency) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const validFrequencies = ["bi-weekly", "bi-monthly", "monthly"];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ 
        message: "Invalid frequency. Must be: bi-weekly, bi-monthly, or monthly." 
      });
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    const payDate = new Date(paymentDate);

    if (endDate <= startDate) {
      return res.status(400).json({ 
        message: "Period end date must be after start date." 
      });
    }

    if (payDate < endDate) {
      return res.status(400).json({ 
        message: "Payment date must be on or after period end date." 
      });
    }

    const overlapping = await prisma.cutoffPeriod.findFirst({
      where: {
        creator: { companyId },
        OR: [
          {
            AND: [
              { periodStart: { lte: startDate } },
              { periodEnd: { gte: startDate } },
            ],
          },
          {
            AND: [
              { periodStart: { lte: endDate } },
              { periodEnd: { gte: endDate } },
            ],
          },
          {
            AND: [
              { periodStart: { gte: startDate } },
              { periodEnd: { lte: endDate } },
            ],
          },
        ],
      },
    });

    if (overlapping) {
      return res.status(400).json({ 
        message: "Cutoff period overlaps with an existing period." 
      });
    }

    const cutoffPeriod = await prisma.cutoffPeriod.create({
      data: {
        periodStart: startDate,
        periodEnd: endDate,
        paymentDate: payDate,
        frequency,
        status: "open",
        createdBy: userId,
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
      },
    });

    const timeLogs = await prisma.timeLog.findMany({
      where: {
        user: { companyId },
        timeIn: {
          gte: startDate,
          lte: endDate,
        },
        timeOut: { not: null },
      },
      select: { id: true },
    });

    if (timeLogs.length > 0) {
      await prisma.timeLogApproval.createMany({
        data: timeLogs.map((log) => ({
          timeLogId: log.id,
          cutoffPeriodId: cutoffPeriod.id,
          status: "pending",
        })),
      });
    }

    console.log("[✅ Cutoff period created]", cutoffPeriod.id);

    return res.status(201).json({
      message: "Cutoff period created successfully.",
      data: {
        ...cutoffPeriod,
        totalTimeLogs: timeLogs.length,
      },
    });
  } catch (error) {
    console.error("❌ Error creating cutoff period:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * Get all cutoff periods for the company
 * GET /api/cutoff-periods
 * Access: Admin, Supervisor, Superadmin
 */
const getCutoffPeriods = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, page = 1, limit = 100, departmentId } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause with department filter
    const where = {
      companyId, // ✅ Use companyId directly instead of nested creator
      ...(status && { status }),
      ...(departmentId && departmentId !== 'none' && { departmentId }) // ✅ Filter by department
    };
    
    // ✅ Special case: filter for null departmentId when "none" is passed
    if (departmentId === 'none') {
      where.departmentId = null;
    }

    const [cutoffPeriods, total] = await Promise.all([
      prisma.cutoffPeriod.findMany({
        where,
        include: {
          creator: {
            select: {
              id: true,
              email: true,
              username: true,
              profile: true,
            },
          },
          department: { // ✅ Include department info
            select: { 
              id: true, 
              name: true 
            }
          },
          _count: {
            select: {
              approvals: true,
            },
          },
        },
        orderBy: { periodStart: "desc" }, // ✅ Sort by period start date
        skip,
        take,
      }),
      prisma.cutoffPeriod.count({ where }),
    ]);

    // ✅ Calculate approval stats for each period
    const periodsWithStats = await Promise.all(
      cutoffPeriods.map(async (period) => {
        const approvalStats = await prisma.timeLogApproval.groupBy({
          by: ["status"],
          where: { cutoffPeriodId: period.id },
          _count: true,
        });

        const stats = {
          pending: 0,
          approved: 0,
          rejected: 0,
        };

        approvalStats.forEach((stat) => {
          stats[stat.status] = stat._count;
        });

        return {
          ...period,
          approvalStats: stats,
        };
      })
    );

    console.log("[✅ Cutoff periods retrieved]", periodsWithStats.length, `(department: ${departmentId || 'all'})`);

    return res.status(200).json({
      message: "Cutoff periods retrieved successfully.",
      data: periodsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Error retrieving cutoff periods:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * Get single cutoff period with detailed approval info
 * GET /api/cutoff-periods/:id
 * Access: Admin, Supervisor, Superadmin
 */
const getCutoffPeriodById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
        approvals: {
          include: {
            timeLog: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    username: true,
                    profile: true,
                  },
                },
              },
            },
            approver: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
              },
            },
          },
          orderBy: {
            timeLog: {
              timeIn: "asc",
            },
          },
        },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    console.log("[✅ Cutoff period retrieved]", cutoffPeriod.id);

    return res.status(200).json({
      message: "Cutoff period retrieved successfully.",
      data: cutoffPeriod,
    });
  } catch (error) {
    console.error("❌ Error retrieving cutoff period:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * Update cutoff period status (lock/process)
 * PATCH /api/cutoff-periods/:id/status
 * Access: Admin, Superadmin
 */
const updateCutoffStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.companyId;

    const validStatuses = ["open", "locked", "processed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be: open, locked, or processed." 
      });
    }

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "processed" && status !== "processed") {
      return res.status(400).json({ 
        message: "Cannot change status of a processed cutoff period." 
      });
    }

    if (status === "locked") {
      const pendingCount = await prisma.timeLogApproval.count({
        where: {
          cutoffPeriodId: id,
          status: "pending",
        },
      });

      if (pendingCount > 0) {
        return res.status(400).json({ 
          message: `Cannot lock cutoff period. ${pendingCount} pending approval(s) remaining.` 
        });
      }
    }

    const updated = await prisma.cutoffPeriod.update({
      where: { id },
      data: { status },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
      },
    });

    console.log("[✅ Cutoff status updated]", updated.id, "->", status);

    return res.status(200).json({
      message: `Cutoff period status updated to ${status}.`,
      data: updated,
    });
  } catch (error) {
    console.error("❌ Error updating cutoff status:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * Delete cutoff period
 * DELETE /api/cutoff-periods/:id
 * Access: Admin, Superadmin
 */
const deleteCutoffPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "processed") {
      return res.status(400).json({ 
        message: "Cannot delete a processed cutoff period." 
      });
    }

    await prisma.cutoffPeriod.delete({
      where: { id },
    });

    console.log("[✅ Cutoff period deleted]", id);

    return res.status(200).json({
      message: "Cutoff period deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting cutoff period:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * ✨ COMPLETE: Get all approvals for a cutoff period WITH calculations
 * GET /api/cutoff-periods/:id/approvals?status=approved
 * GET /api/cutoff-periods/:id/approvals?status=rejected
 * Access: Admin, Supervisor, Superadmin
 */
const getCutoffApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, employeeId } = req.query;
    const companyId = req.user.companyId;

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    // Fetch company settings
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { 
        gracePeriodMinutes: true,
        minimumLunchMinutes: true,
      },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;

    const where = {
      cutoffPeriodId: id,
      ...(status && { status }),
      ...(employeeId && {
        timeLog: {
          userId: employeeId,
        },
      }),
    };

    const approvals = await prisma.timeLogApproval.findMany({
      where,
      include: {
        timeLog: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
                departmentId: true,
                department: {
                  select: {
                    id: true,
                    name: true,
                    paidBreak: true,
                    breakDuration: true,
                    coffeeBreakMaxCount: true,
                    coffeeBreakMinutes: true,
                    coffeeBreakPaid: true,
                  },
                },
              },
            },
            overtime: {
              where: { status: "approved" },
              select: {
                id: true,
                requestedHours: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
      },
      orderBy: {
        timeLog: {
          timeIn: "asc",
        },
      },
    });

    // ✅ ENRICH WITH CALCULATIONS (same as getPendingApprovals)
    const enrichedApprovals = await Promise.all(
      approvals.map(async (approval) => {
        const timeLog = approval.timeLog;
        const timeInDate = new Date(timeLog.timeIn);
        const dateOnly = getDateOnly(timeInDate);
        const department = timeLog.user.department;

        // Fetch schedule
        const userShift = await fetchScheduleForDate(
          timeLog.userId, 
          dateOnly,
          timeLog.user.departmentId
        );

        let scheduledHours = null;
        let scheduledStart = null;
        let scheduledEnd = null;
        let payableHours = null;
        let payableClockIn = null;
        let payableClockOut = null;
        
        let breakData = null;
        let coffeePolicy = null;
        let totalBreakDeductions = 0;

        if (userShift && userShift.shift) {
          const startTime = userShift.customStartTime || userShift.shift.startTime;
          const endTime = userShift.customEndTime || userShift.shift.endTime;
          const shiftTimezone = userShift.shift.timeZone;

          scheduledStart = combineDateTime(dateOnly, startTime, shiftTimezone);
          scheduledEnd = combineDateTime(dateOnly, endTime, shiftTimezone);

          if (userShift.shift.crossesMidnight) {
            scheduledEnd.setDate(scheduledEnd.getDate() + 1);
          }

          scheduledHours = calculateHours(scheduledStart, scheduledEnd);

          // For approved/rejected, use the APPROVED times if available
          // Otherwise fall back to actual times
          const actualClockIn = approval.approvedClockIn 
            ? new Date(approval.approvedClockIn)
            : new Date(timeLog.timeIn);
          const actualClockOut = approval.approvedClockOut
            ? new Date(approval.approvedClockOut)
            : (timeLog.timeOut ? new Date(timeLog.timeOut) : null);

          // Apply grace period
          if (actualClockIn > scheduledStart) {
            const lateMs = actualClockIn - scheduledStart;
            const lateMinutes = lateMs / (60 * 1000);
            
            if (lateMinutes <= gracePeriodMinutes) {
              payableClockIn = scheduledStart;
            } else {
              payableClockIn = actualClockIn;
            }
          } else {
            payableClockIn = scheduledStart;
          }

          if (actualClockOut) {
            if (actualClockOut < scheduledEnd) {
              payableClockOut = actualClockOut;
            } else {
              payableClockOut = scheduledEnd;
            }
          } else {
            payableClockOut = scheduledEnd;
          }

          const grossPayableHours = calculateHours(payableClockIn, payableClockOut);

          // Calculate break deductions
          if (department) {
            breakData = calculateBreakTimes(timeLog, department);
            coffeePolicy = checkCoffeeBreakPolicy(breakData.coffeeBreakMinutes, department);
            totalBreakDeductions = calculateBreakDeductions(breakData, coffeePolicy);
          }

          const breakDeductionHours = totalBreakDeductions / 60;
          payableHours = grossPayableHours - breakDeductionHours;
        } else {
          // ✅ NO SCHEDULE: Use actual hours
          payableHours = timeLog.timeOut 
            ? calculateHours(timeLog.timeIn, timeLog.timeOut)
            : null;
        }

        // Calculate actual hours
        const actualHours = timeLog.timeOut 
          ? calculateHours(timeLog.timeIn, timeLog.timeOut)
          : null;

        // Calculate variance
        const variance = scheduledHours && actualHours 
          ? actualHours - scheduledHours 
          : null;

        // Calculate approved OT
        const approvedOTHours = timeLog.overtime.reduce((sum, ot) => {
          return sum + parseFloat(ot.requestedHours || 0);
        }, 0);

        // Calculate lateness/early departure
        let lateMinutes = 0;
        let earlyMinutes = 0;
        let lateStatus = null;
        let earlyStatus = null;

        if (scheduledStart && scheduledEnd) {
          const actualClockIn = approval.approvedClockIn 
            ? new Date(approval.approvedClockIn)
            : new Date(timeLog.timeIn);
          const actualClockOut = approval.approvedClockOut
            ? new Date(approval.approvedClockOut)
            : (timeLog.timeOut ? new Date(timeLog.timeOut) : null);

          if (actualClockIn > scheduledStart) {
            lateMinutes = (actualClockIn - scheduledStart) / (60 * 1000);
            
            if (lateMinutes <= gracePeriodMinutes) {
              lateStatus = "within_grace";
            } else {
              lateStatus = "beyond_grace";
            }
          }

          if (actualClockOut && actualClockOut < scheduledEnd) {
            earlyMinutes = (scheduledEnd - actualClockOut) / (60 * 1000);
            earlyStatus = "left_early";
          }
        }

        return {
          ...approval,
          schedule: userShift ? {
            id: userShift.id,
            shiftName: userShift.shift?.shiftName,
            scheduledStart,
            scheduledEnd,
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            payableHours: payableHours ? parseFloat(payableHours.toFixed(2)) : null,
            crossesMidnight: userShift.shift?.crossesMidnight || false,
          } : null,
          calculatedData: {
            actualHours: actualHours ? parseFloat(actualHours.toFixed(2)) : null,
            variance: variance ? parseFloat(variance.toFixed(2)) : null,
            approvedOTHours: parseFloat(approvedOTHours.toFixed(2)),
            hasApprovedOT: approvedOTHours > 0,
            lateMinutes: parseFloat(lateMinutes.toFixed(2)),
            lateStatus,
            earlyMinutes: parseFloat(earlyMinutes.toFixed(2)),
            earlyStatus,
          },
          breakData: breakData && department ? {
            lunch: {
              minutes: breakData.lunchBreakMinutes,
              isPaid: department.paidBreak || false,
              deducted: !department.paidBreak && breakData.lunchBreakMinutes > 0,
            },
            coffee: {
              totalMinutes: breakData.coffeeBreakMinutes,
              breaks: breakData.coffeeBreaksList,
              policy: coffeePolicy ? {
                hasPolicy: coffeePolicy.hasPolicy,
                allowedMinutes: coffeePolicy.allowedMinutes,
                exceeded: coffeePolicy.exceeded,
                excessMinutes: coffeePolicy.excessMinutes,
                isPaid: coffeePolicy.isPaid,
              } : null,
            },
            totalDeductions: {
              minutes: totalBreakDeductions,
              hours: parseFloat((totalBreakDeductions / 60).toFixed(2)),
            },
          } : null,
          payrollSummary: {
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            payableRegularHours: payableHours ? parseFloat(payableHours.toFixed(2)) : null,
            approvedOTHours: parseFloat(approvedOTHours.toFixed(2)),
            totalPayableHours: payableHours 
              ? parseFloat((payableHours + approvedOTHours).toFixed(2)) 
              : null,
          },
        };
      })
    );

    console.log("[✅ Approvals retrieved with calculations]", enrichedApprovals.length);

    return res.status(200).json({
      message: "Approvals retrieved successfully.",
      data: enrichedApprovals,
      gracePeriodMinutes,
    });
  } catch (error) {
    console.error("❌ Error retrieving approvals:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * ✨ COMPLETE: Get pending approvals with schedule, grace period, and break integration
 * GET /api/cutoff-periods/:id/approvals/pending
 * Access: Admin, Supervisor, Superadmin
 */
const getPendingApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // Fetch company settings
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { 
        gracePeriodMinutes: true,
        minimumLunchMinutes: true,
      },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;

    // Verify cutoff period
    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    // Fetch pending approvals
    const pendingApprovals = await prisma.timeLogApproval.findMany({
      where: {
        cutoffPeriodId: id,
        status: "pending",
      },
      include: {
        timeLog: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
                departmentId: true,
                department: {
                  select: {
                    id: true,
                    name: true,
                    paidBreak: true,
                    breakDuration: true,
                    coffeeBreakMaxCount: true,
                    coffeeBreakMinutes: true,
                    coffeeBreakPaid: true,
                  },
                },
              },
            },
            overtime: {
              where: { status: "approved" },
              select: {
                id: true,
                requestedHours: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        timeLog: {
          timeIn: "asc",
        },
      },
    });

    // Enrich with schedule, grace period, and break data
    const enrichedApprovals = await Promise.all(
      pendingApprovals.map(async (approval) => {
        const timeLog = approval.timeLog;
        const timeInDate = new Date(timeLog.timeIn);
        const dateOnly = getDateOnly(timeInDate);
        const department = timeLog.user.department;

        // Fetch schedule
        const userShift = await fetchScheduleForDate(
          timeLog.userId, 
          dateOnly,
          timeLog.user.departmentId
        );

        let scheduledHours = null;
        let scheduledStart = null;
        let scheduledEnd = null;
        let payableHours = null;
        let payableClockIn = null;
        let payableClockOut = null;
        
        // ✅ FIX: Declare break variables OUTSIDE the if block
        let breakData = null;
        let coffeePolicy = null;
        let totalBreakDeductions = 0;

        if (userShift && userShift.shift) {
          const startTime = userShift.customStartTime || userShift.shift.startTime;
          const endTime = userShift.customEndTime || userShift.shift.endTime;
          const shiftTimezone = userShift.shift.timeZone;

          scheduledStart = combineDateTime(dateOnly, startTime, shiftTimezone);
          scheduledEnd = combineDateTime(dateOnly, endTime, shiftTimezone);

          if (userShift.shift.crossesMidnight) {
            scheduledEnd.setDate(scheduledEnd.getDate() + 1);
          }

          scheduledHours = calculateHours(scheduledStart, scheduledEnd);

          // Apply grace period (CLOCK-IN ONLY)
          const actualClockIn = new Date(timeLog.timeIn);
          const actualClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;

          // Clock In: Grace period
          if (actualClockIn > scheduledStart) {
            const lateMs = actualClockIn - scheduledStart;
            const lateMinutes = lateMs / (60 * 1000);
            
            if (lateMinutes <= gracePeriodMinutes) {
              payableClockIn = scheduledStart; // Within grace
            } else {
              payableClockIn = actualClockIn; // Beyond grace
            }
          } else {
            payableClockIn = scheduledStart; // On time/early
          }

          // Clock Out: NO grace period
          if (actualClockOut) {
            if (actualClockOut < scheduledEnd) {
              payableClockOut = actualClockOut; // Left early
            } else {
              payableClockOut = scheduledEnd; // On time/late
            }
          } else {
            payableClockOut = scheduledEnd;
          }

          // Calculate gross payable hours
          const grossPayableHours = calculateHours(payableClockIn, payableClockOut);

          // Calculate break deductions
          if (department) {
            breakData = calculateBreakTimes(timeLog, department);
            coffeePolicy = checkCoffeeBreakPolicy(breakData.coffeeBreakMinutes, department);
            totalBreakDeductions = calculateBreakDeductions(breakData, coffeePolicy);
          }

          // Final payable hours
          const breakDeductionHours = totalBreakDeductions / 60;
          payableHours = grossPayableHours - breakDeductionHours;
        }

        // Calculate actual hours
        const actualHours = timeLog.timeOut 
          ? calculateHours(timeLog.timeIn, timeLog.timeOut)
          : null;

        // Calculate variance
        const variance = scheduledHours && actualHours 
          ? actualHours - scheduledHours 
          : null;

        // Calculate approved OT
        const approvedOTHours = timeLog.overtime.reduce((sum, ot) => {
          return sum + parseFloat(ot.requestedHours || 0);
        }, 0);

        // Calculate lateness/early departure
        let lateMinutes = 0;
        let earlyMinutes = 0;
        let lateStatus = null;
        let earlyStatus = null;

        if (scheduledStart && scheduledEnd) {
          const actualClockIn = new Date(timeLog.timeIn);
          const actualClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;

          if (actualClockIn > scheduledStart) {
            lateMinutes = (actualClockIn - scheduledStart) / (60 * 1000);
            
            if (lateMinutes <= gracePeriodMinutes) {
              lateStatus = "within_grace";
            } else {
              lateStatus = "beyond_grace";
            }
          }

          if (actualClockOut && actualClockOut < scheduledEnd) {
            earlyMinutes = (scheduledEnd - actualClockOut) / (60 * 1000);
            earlyStatus = "left_early";
          }
        }

        return {
          ...approval,
          schedule: userShift ? {
            id: userShift.id,
            shiftName: userShift.shift?.shiftName,
            scheduledStart,
            scheduledEnd,
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            payableHours: payableHours ? parseFloat(payableHours.toFixed(2)) : null,
            crossesMidnight: userShift.shift?.crossesMidnight || false,
          } : null,
          calculatedData: {
            actualHours: actualHours ? parseFloat(actualHours.toFixed(2)) : null,
            variance: variance ? parseFloat(variance.toFixed(2)) : null,
            approvedOTHours: parseFloat(approvedOTHours.toFixed(2)),
            hasApprovedOT: approvedOTHours > 0,
            lateMinutes: parseFloat(lateMinutes.toFixed(2)),
            lateStatus,
            earlyMinutes: parseFloat(earlyMinutes.toFixed(2)),
            earlyStatus,
          },
          breakData: breakData && department ? {
            lunch: {
              minutes: breakData.lunchBreakMinutes,
              isPaid: department.paidBreak || false,
              deducted: !department.paidBreak && breakData.lunchBreakMinutes > 0,
            },
            coffee: {
              totalMinutes: breakData.coffeeBreakMinutes,
              breaks: breakData.coffeeBreaksList,
              policy: coffeePolicy ? {
                hasPolicy: coffeePolicy.hasPolicy,
                allowedMinutes: coffeePolicy.allowedMinutes,
                exceeded: coffeePolicy.exceeded,
                excessMinutes: coffeePolicy.excessMinutes,
                isPaid: coffeePolicy.isPaid,
              } : null,
            },
            totalDeductions: {
              minutes: totalBreakDeductions,
              hours: parseFloat((totalBreakDeductions / 60).toFixed(2)),
            },
          } : null,
          payrollSummary: {
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            payableRegularHours: payableHours ? parseFloat(payableHours.toFixed(2)) : null,
            approvedOTHours: parseFloat(approvedOTHours.toFixed(2)),
            totalPayableHours: payableHours 
              ? parseFloat((payableHours + approvedOTHours).toFixed(2)) 
              : null,
          },
        };
      })
    );

    console.log("[✅ Pending approvals with breaks]", enrichedApprovals.length);

    return res.status(200).json({
      message: "Pending approvals retrieved successfully.",
      data: enrichedApprovals,
      gracePeriodMinutes,
    });
  } catch (error) {
    console.error("❌ Error retrieving pending approvals:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * ✨ COMPLETE: Bulk approve/reject with grace period and break integration
 * PATCH /api/cutoff-periods/:id/approvals/bulk
 * Access: Admin, Supervisor, Superadmin
 */
const bulkUpdateApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeLogIds, action, notes } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!timeLogIds || !Array.isArray(timeLogIds) || timeLogIds.length === 0) {
      return res.status(400).json({ message: "Time log IDs are required." });
    }

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ 
        message: "Invalid action. Must be 'approve' or 'reject'." 
      });
    }

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({ 
        message: `Cannot modify approvals for a ${cutoffPeriod.status} cutoff period.` 
      });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;

    const status = action === "approve" ? "approved" : "rejected";

    if (action === "approve") {
      const approvals = await prisma.timeLogApproval.findMany({
        where: {
          cutoffPeriodId: id,
          timeLogId: { in: timeLogIds },
          status: "pending",
        },
        include: {
          timeLog: {
            include: {
              user: {
                select: {
                  id: true,
                  departmentId: true,
                  department: {
                    select: {
                      paidBreak: true,
                      coffeeBreakMaxCount: true,
                      coffeeBreakMinutes: true,
                      coffeeBreakPaid: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      for (const approval of approvals) {
        const timeLog = approval.timeLog;
        const timeInDate = new Date(timeLog.timeIn);
        const dateOnly = getDateOnly(timeInDate);
        const department = timeLog.user.department;

        const userShift = await fetchScheduleForDate(
          timeLog.userId,
          dateOnly,
          timeLog.user?.departmentId
        );

        // ✅ NEW: These will be the final times written to TimeLog
        let finalClockIn = new Date(timeLog.timeIn);
        let finalClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
        let scheduledHours = null;

        if (userShift && userShift.shift) {
          const startTime = userShift.customStartTime || userShift.shift.startTime;
          const endTime = userShift.customEndTime || userShift.shift.endTime;
          const shiftTimezone = userShift.shift.timeZone;

          let scheduledClockIn = combineDateTime(dateOnly, startTime, shiftTimezone);
          let scheduledClockOut = combineDateTime(dateOnly, endTime, shiftTimezone);

          if (userShift.shift.crossesMidnight) {
            scheduledClockOut.setDate(scheduledClockOut.getDate() + 1);
          }

          const actualClockIn = new Date(timeLog.timeIn);
          const actualClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;

          // ✅ Clock In: Grace period logic
          if (actualClockIn > scheduledClockIn) {
            const lateMs = actualClockIn - scheduledClockIn;
            const lateMinutes = lateMs / (60 * 1000);
            
            if (lateMinutes <= gracePeriodMinutes) {
              // Within grace → Use scheduled time (forgive lateness)
              finalClockIn = scheduledClockIn;
            } else {
              // Beyond grace → Keep actual late time (deduct)
              finalClockIn = actualClockIn;
            }
          } else {
            // On time or early → Use scheduled time
            finalClockIn = scheduledClockIn;
          }

          // ✅ Clock Out: NO grace period
          if (actualClockOut) {
            if (actualClockOut < scheduledClockOut) {
              // Left early → Keep actual early time (deduct)
              finalClockOut = actualClockOut;
            } else {
              // Stayed late → Cap at scheduled time (no extra pay without OT)
              finalClockOut = scheduledClockOut;
            }
          } else {
            // Not clocked out → Use scheduled time
            finalClockOut = scheduledClockOut;
          }

          // Calculate final hours with breaks
          const grossHours = calculateHours(finalClockIn, finalClockOut);

          let totalBreakDeductions = 0;
          if (department) {
            const breakData = calculateBreakTimes(timeLog, department);
            const coffeePolicy = checkCoffeeBreakPolicy(breakData.coffeeBreakMinutes, department);
            totalBreakDeductions = calculateBreakDeductions(breakData, coffeePolicy);
          }

          const breakHours = totalBreakDeductions / 60;
          scheduledHours = grossHours - breakHours;
        } else {
          // ✅ No schedule → Keep actual times as-is (salaried/no schedule)
          finalClockIn = new Date(timeLog.timeIn);
          finalClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
        }

        const actualHours = timeLog.timeOut 
          ? calculateHours(timeLog.timeIn, timeLog.timeOut)
          : null;

        // ✅ UPDATE THE ACTUAL TIME LOG (Main change!)
        await prisma.timeLog.update({
          where: { id: timeLog.id },
          data: {
            // Backup original times (if not already backed up)
            originalTimeIn: timeLog.originalTimeIn || timeLog.timeIn,
            originalTimeOut: timeLog.originalTimeOut || timeLog.timeOut,
            // Update to approved times
            timeIn: finalClockIn,
            timeOut: finalClockOut,
            isApproved: true,
          },
        });

        // ✅ Update approval record (for audit trail)
        await prisma.timeLogApproval.update({
          where: { id: approval.id },
          data: {
            status: "approved",
            approvedBy: userId,
            approvedAt: new Date(),
            approvedClockIn: finalClockIn,
            approvedClockOut: finalClockOut,
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            actualHours: actualHours ? parseFloat(actualHours.toFixed(2)) : null,
            ...(notes && { notes }),
          },
        });
      }

      console.log("[✅ Bulk approval - TimeLog updated]", approvals.length, "records");

      return res.status(200).json({
        message: `${approvals.length} time log(s) approved successfully.`,
        data: { count: approvals.length },
      });
    } else {
      // ✅ REJECTION: Mark approval as rejected (don't touch TimeLog)
      const updated = await prisma.timeLogApproval.updateMany({
        where: {
          cutoffPeriodId: id,
          timeLogId: { in: timeLogIds },
          status: "pending",
        },
        data: {
          status: "rejected",
          approvedBy: userId,
          approvedAt: new Date(),
          ...(notes && { notes }),
        },
      });

      console.log("[✅ Bulk rejection]", updated.count, "records");

      return res.status(200).json({
        message: `${updated.count} time log(s) rejected successfully.`,
        data: { count: updated.count },
      });
    }
  } catch (error) {
    console.error("❌ Error bulk updating approvals:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

/**
 * ✨ COMPLETE: Single approve/reject with grace period and break integration
 * PATCH /api/cutoff-periods/:id/approvals/:approvalId
 * Access: Admin, Supervisor, Superadmin
 */
const updateSingleApproval = async (req, res) => {
  try {
    const { id, approvalId } = req.params;
    const { action, notes, editedHours } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ 
        message: "Invalid action. Must be 'approve' or 'reject'." 
      });
    }

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({ 
        message: `Cannot modify approvals for a ${cutoffPeriod.status} cutoff period.` 
      });
    }

    const approval = await prisma.timeLogApproval.findUnique({
      where: { id: approvalId },
      include: {
        timeLog: {
          include: {
            user: {
              select: {
                id: true,
                departmentId: true,
                department: {
                  select: {
                    paidBreak: true,
                    coffeeBreakMaxCount: true,
                    coffeeBreakMinutes: true,
                    coffeeBreakPaid: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!approval || approval.cutoffPeriodId !== id) {
      return res.status(404).json({ message: "Approval record not found." });
    }

    if (approval.status !== "pending") {
      return res.status(400).json({ 
        message: `Cannot modify an already ${approval.status} approval.` 
      });
    }

    const status = action === "approve" ? "approved" : "rejected";

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;

    // ✅ NEW: These will be the final times written to TimeLog
    let finalClockIn = null;
    let finalClockOut = null;
    let scheduledHours = null;
    let actualHours = null;

    if (action === "approve") {
      const timeLog = approval.timeLog;
      const timeInDate = new Date(timeLog.timeIn);
      const dateOnly = getDateOnly(timeInDate);
      const department = timeLog.user.department;

      const userShift = await fetchScheduleForDate(
        timeLog.userId,
        dateOnly,
        timeLog.user?.departmentId
      );

      if (userShift && userShift.shift) {
        const startTime = userShift.customStartTime || userShift.shift.startTime;
        const endTime = userShift.customEndTime || userShift.shift.endTime;
        const shiftTimezone = userShift.shift.timeZone;

        let scheduledClockIn = combineDateTime(dateOnly, startTime, shiftTimezone);
        let scheduledClockOut = combineDateTime(dateOnly, endTime, shiftTimezone);

        if (userShift.shift.crossesMidnight) {
          scheduledClockOut.setDate(scheduledClockOut.getDate() + 1);
        }

        const actualClockIn = new Date(timeLog.timeIn);
        const actualClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;

        // ✅ Clock In: Grace period logic
        if (actualClockIn > scheduledClockIn) {
          const lateMs = actualClockIn - scheduledClockIn;
          const lateMinutes = lateMs / (60 * 1000);
          
          if (lateMinutes <= gracePeriodMinutes) {
            // Within grace → Use scheduled time (forgive lateness)
            finalClockIn = scheduledClockIn;
          } else {
            // Beyond grace → Keep actual late time (deduct)
            finalClockIn = actualClockIn;
          }
        } else {
          // On time or early → Use scheduled time
          finalClockIn = scheduledClockIn;
        }

        // ✅ Clock Out: NO grace period
        if (actualClockOut) {
          if (actualClockOut < scheduledClockOut) {
            // Left early → Keep actual early time (deduct)
            finalClockOut = actualClockOut;
          } else {
            // Stayed late → Cap at scheduled time (no extra pay without OT)
            finalClockOut = scheduledClockOut;
          }
        } else {
          // Not clocked out → Use scheduled time
          finalClockOut = scheduledClockOut;
        }

        // Calculate final hours with breaks
        const grossHours = calculateHours(finalClockIn, finalClockOut);

        let totalBreakDeductions = 0;
        if (department) {
          const breakData = calculateBreakTimes(timeLog, department);
          const coffeePolicy = checkCoffeeBreakPolicy(breakData.coffeeBreakMinutes, department);
          totalBreakDeductions = calculateBreakDeductions(breakData, coffeePolicy);
        }

        const breakHours = totalBreakDeductions / 60;
        scheduledHours = grossHours - breakHours;
      } else {
        // ✅ No schedule → Keep actual times as-is (salaried/no schedule)
        finalClockIn = new Date(timeLog.timeIn);
        finalClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
      }

      actualHours = timeLog.timeOut 
        ? calculateHours(timeLog.timeIn, timeLog.timeOut)
        : null;

      // ✅ UPDATE THE ACTUAL TIME LOG (Main change!)
      await prisma.timeLog.update({
        where: { id: timeLog.id },
        data: {
          // Backup original times (if not already backed up)
          originalTimeIn: timeLog.originalTimeIn || timeLog.timeIn,
          originalTimeOut: timeLog.originalTimeOut || timeLog.timeOut,
          // Update to approved times
          timeIn: finalClockIn,
          timeOut: finalClockOut,
          isApproved: true,
        },
      });
    }

    // ✅ Update approval record (for audit trail)
    const updated = await prisma.timeLogApproval.update({
      where: { id: approvalId },
      data: {
        status,
        approvedBy: userId,
        approvedAt: new Date(),
        ...(action === "approve" && {
          approvedClockIn: finalClockIn,
          approvedClockOut: finalClockOut,
          scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
          actualHours: actualHours ? parseFloat(actualHours.toFixed(2)) : null,
        }),
        ...(notes && { notes }),
        ...(editedHours && { editedHours: parseFloat(editedHours) }),
      },
      include: {
        timeLog: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    console.log(`[✅ Single ${action} - TimeLog ${action === "approve" ? "updated" : "unchanged"}]`, updated.timeLogId);

    return res.status(200).json({
      message: `Time log ${action}d successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error("❌ Error updating single approval:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};


/**
 * ✨ ENHANCED: Get employee hours summary with OT for payroll processing
 * GET /api/cutoff-periods/:id/summary
 * Access: Admin, Supervisor, Superadmin
 */
const getCutoffSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await prisma.cutoffPeriod.findFirst({
      where: {
        id,
        creator: { companyId },
      },
    });

    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    const approvedApprovals = await prisma.timeLogApproval.findMany({
      where: {
        cutoffPeriodId: id,
        status: "approved",
      },
      include: {
        timeLog: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
              },
            },
            overtime: {
              where: { status: "approved" },
              select: {
                id: true,
                requestedHours: true,
              },
            },
          },
        },
      },
    });

    const employeeSummary = {};

    approvedApprovals.forEach((approval) => {
      const { timeLog } = approval;
      const userId = timeLog.userId;

      if (!employeeSummary[userId]) {
        employeeSummary[userId] = {
          userId,
          employee: timeLog.user,
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
          approvedLogs: 0,
          editedLogs: 0,
        };
      }

      const regularHours = approval.scheduledHours || 0;

      const overtimeHours = timeLog.overtime.reduce((sum, ot) => {
        return sum + parseFloat(ot.requestedHours || 0);
      }, 0);

      employeeSummary[userId].regularHours += regularHours;
      employeeSummary[userId].overtimeHours += overtimeHours;
      employeeSummary[userId].totalHours += (regularHours + overtimeHours);
      employeeSummary[userId].approvedLogs += 1;
      
      if (approval.editedHours) {
        employeeSummary[userId].editedLogs += 1;
      }
    });

    const summary = Object.values(employeeSummary).map((emp) => ({
      ...emp,
      regularHours: parseFloat(emp.regularHours.toFixed(2)),
      overtimeHours: parseFloat(emp.overtimeHours.toFixed(2)),
      totalHours: parseFloat(emp.totalHours.toFixed(2)),
    }));

    console.log("[✅ Cutoff summary generated with OT]", summary.length, "employees");

    return res.status(200).json({
      message: "Cutoff summary generated successfully.",
      data: {
        cutoffPeriod: {
          id: cutoffPeriod.id,
          periodStart: cutoffPeriod.periodStart,
          periodEnd: cutoffPeriod.periodEnd,
          paymentDate: cutoffPeriod.paymentDate,
          frequency: cutoffPeriod.frequency,
          status: cutoffPeriod.status,
        },
        employees: summary,
        totals: {
          totalEmployees: summary.length,
          totalRegularHours: parseFloat(summary.reduce((sum, emp) => sum + emp.regularHours, 0).toFixed(2)),
          totalOvertimeHours: parseFloat(summary.reduce((sum, emp) => sum + emp.overtimeHours, 0).toFixed(2)),
          totalHours: parseFloat(summary.reduce((sum, emp) => sum + emp.totalHours, 0).toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error("❌ Error generating cutoff summary:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

module.exports = {
  createCutoffPeriod,
  getCutoffPeriods,
  getCutoffPeriodById,
  updateCutoffStatus,
  deleteCutoffPeriod,
  getCutoffApprovals,
  getPendingApprovals,
  bulkUpdateApprovals,
  updateSingleApproval,
  getCutoffSummary,
};