// src/controllers/Features/cutoffPeriodController.js
// ✅ CONSOLIDATED & FIXED
//
// Changes from previous version:
//  1. createCutoffPeriod   — now saves companyId + departmentId
//  2. getCutoffPeriodById  — uses companyId directly (consistent with getCutoffPeriods)
//  3. updateCutoffStatus   — uses companyId directly; pending check excludes 'excluded' & 'rejected'
//  4. updateSingleApproval — handles 'approve', 'exclude', AND legacy 'reject' actions
//  5. bulkUpdateApprovals  — handles 'approve' and 'exclude'; legacy 'reject' kept for safety
//  6. finalizeCutoffPeriod — NEW: validates all records done, locks period, non-reversible
//  7. resolveConflict      — NEW: handles punch vs leave conflict resolution
//  8. ID generation        — uses crypto.randomUUID() to prevent collision
//
// Backward compat:
//  - 'rejected' status treated same as 'excluded' in all business logic checks
//  - Old records without companyId fall back to creator.companyId lookup

const { prisma } = require("@config/connection");
const moment = require("moment-timezone");
const { randomUUID } = require("crypto");
const { createNotification } = require("@services/notificationService");
const { computeTimeLogSummary, resolveDriverAideSegments } = require("@services/timeLogComputeService");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calculateHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const diff = new Date(timeOut) - new Date(timeIn);
  return diff / (1000 * 60 * 60);
}

function getDateOnly(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ✅ FIX: combineDateTime now accepts YYYY-MM-DD string OR Date object for `date`.
// Passing a string bypasses the UTC-vs-local ambiguity entirely.
// Callers that know the correct local date (e.g. enrichApprovals) should pass a string.
function combineDateTime(date, time, shiftTimezone = "Asia/Manila", companyTimezone = "Asia/Manila") {
  // If already a YYYY-MM-DD string, use directly — no timezone conversion needed
  const dateStr = (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : moment.tz(date, shiftTimezone || companyTimezone).format("YYYY-MM-DD");

  let timeStr;
  if (typeof time === "string") {
    timeStr = time;
  } else if (time instanceof Date) {
    const h = String(time.getUTCHours()).padStart(2, "0");
    const m = String(time.getUTCMinutes()).padStart(2, "0");
    const s = String(time.getUTCSeconds()).padStart(2, "0");
    timeStr = `${h}:${m}:${s}`;
  } else {
    timeStr = "00:00:00";
  }
  return moment.tz(`${dateStr} ${timeStr}`, shiftTimezone || companyTimezone).toDate();
}

// matchesRecurrencePattern removed — ShiftSchedule now uses daysOfWeek int array

// ✅ FIX: Rewritten for new ShiftSchedule schema
// Old fields removed: assignedUserId, assignedToAll, assignedToDepartment, recurrencePattern
// New fields used:    assignmentType ('individual'|'department'|'all'), targetId, daysOfWeek (int[])
//
// @param localDateStr  YYYY-MM-DD string in company timezone — used for day-of-week matching.
//                      This avoids JS Date .getDay() returning the wrong UTC day.
// @param dateOnly      Date object (midnight local) — used for DB date range queries.
async function fetchScheduleForDate(userId, dateOnly, userDepartmentId, companyId, localDateStr) {
  const SHIFT_SELECT = {
    id: true, shiftName: true, startTime: true,
    endTime: true, crossesMidnight: true, timeZone: true,
  };

  // 1. UserShift — highest priority (explicit daily assignment)
  const userShift = await prisma.userShift.findFirst({
    where: {
      userId,
      assignedDate: {
        gte: dateOnly,
        lt: new Date(dateOnly.getTime() + 24 * 60 * 60 * 1000),
      },
      status: { not: "cancelled" },
    },
    include: { shift: { select: SHIFT_SELECT } },
  });
  if (userShift) return userShift;

  // 2. ShiftSchedule — individual > department > all
  const orConditions = [
    { assignmentType: "individual", targetId: userId },
    { assignmentType: "all" },
  ];
  if (userDepartmentId) {
    orConditions.push({ assignmentType: "department", targetId: userDepartmentId });
  }

  const schedules = await prisma.shiftSchedule.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      OR: orConditions,
      startDate: { lte: dateOnly },
      endDate:   { gte: dateOnly },
      isActive:  true,
    },
    include: { shift: { select: SHIFT_SELECT } },
  });

  if (!schedules.length) return null;

  // Sort: individual(0) > department(1) > all(2)
  const PRIORITY = { individual: 0, department: 1, all: 2 };
  schedules.sort((a, b) => (PRIORITY[a.assignmentType] ?? 99) - (PRIORITY[b.assignmentType] ?? 99));

  // ✅ FIX: Use localDateStr (YYYY-MM-DD) for day-of-week extraction.
  const dayOfWeek = localDateStr
    ? moment(localDateStr).day()
    : dateOnly.getDay();

  // Try exact date first
  for (const schedule of schedules) {
    const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
    if (days.includes(dayOfWeek)) {
      return {
        id:              schedule.id,
        shift:           schedule.shift,
        customStartTime: null,
        customEndTime:   null,
      };
    }
  }

  // ✅ FIX: Company timezone may differ from shift timezone (e.g. LA company, Manila workers).
  // If no schedule found for the computed day, try adjacent days (+1 / -1).
  // This handles: 6:45 AM Manila = 2:45 PM previous day in LA → wrong weekday extracted.
  for (const offset of [1, -1]) {
    const adjDay = localDateStr
      ? moment(localDateStr).add(offset, "day").day()
      : (dayOfWeek + offset + 7) % 7;
    for (const schedule of schedules) {
      const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
      if (days.includes(adjDay)) {
        return {
          id:              schedule.id,
          shift:           schedule.shift,
          customStartTime: null,
          customEndTime:   null,
          _adjDate:        moment(localDateStr || dateOnly).add(offset, "day").format("YYYY-MM-DD"),
        };
      }
    }
  }

  return null;
}

// Break computation is handled by timeLogComputeService — enrichApprovals reads
// stored lunchDeductionMinutes and totalBreakMinutes directly from the TimeLog.

/**
 * Shared: resolve companyId for a cutoff period
 * Supports both old records (companyId via creator) and new records (companyId direct)
 */
async function findCutoffForCompany(id, companyId) {
  return prisma.cutoffPeriod.findFirst({
    where: {
      id,
      OR: [
        { companyId },
        { creator: { companyId } },
      ],
    },
  });
}

/**
 * Shared: enrich approval records using stored computed fields from timeLogComputeService.
 * Reads lateHours, undertimeHours, netWorkedHours, segment hours etc. directly from the
 * TimeLog — no independent recomputation. For DRIVER_AIDE punches, maps each segmentType
 * to its stored segment field.
 */
function enrichApprovals(approvals, gracePeriodMinutes) {
  return approvals.map((approval) => {
    const tl = approval.timeLog;
    if (!tl) return approval;

    const isDriverAide   = tl.punchType === "DRIVER_AIDE";
    const segmentType    = approval.segmentType ?? null;

    const lateHours      = parseFloat(tl.lateHours      ?? 0);
    const undertimeHours = parseFloat(tl.undertimeHours ?? 0);
    const grossHours     = parseFloat(tl.grossHours     ?? 0);
    const rawOtMinutes   = tl.rawOtMinutes ?? 0;

    const approvedOTHours = (tl.overtime || []).reduce(
      (sum, ot) => sum + parseFloat(ot.requestedHours || 0), 0
    );

    let segmentHours      = null;
    let segLateHours      = 0;
    let segUndertimeHours = 0;
    let segScheduledHours = null;
    let segRawOtMinutes   = 0;

    if (isDriverAide) {
      if (segmentType === "driver_am") {
        segmentHours      = parseFloat(tl.driverAmSegmentHours ?? 0);
        segLateHours      = lateHours; // AM is the late-bearing segment (earliest shift)
        segScheduledHours = segmentHours;
      } else if (segmentType === "regular") {
        segmentHours      = parseFloat(tl.regularSegmentHours ?? 0);
        segScheduledHours = segmentHours;
      } else if (segmentType === "driver_pm") {
        segmentHours      = parseFloat(tl.driverPmSegmentHours ?? 0);
        segUndertimeHours = undertimeHours; // PM is the undertime-bearing segment (latest shift)
        segScheduledHours = segmentHours;
        segRawOtMinutes   = rawOtMinutes;
      }
    } else {
      segmentHours      = tl.netWorkedHours != null ? parseFloat(tl.netWorkedHours) : grossHours;
      segLateHours      = lateHours;
      segUndertimeHours = undertimeHours;
      segScheduledHours = tl.scheduledHours != null ? parseFloat(tl.scheduledHours) : null;
      segRawOtMinutes   = rawOtMinutes;
    }

    const lateMinutes  = parseFloat((segLateHours * 60).toFixed(2));
    const earlyMinutes = parseFloat((segUndertimeHours * 60).toFixed(2));
    const totalPayable = segmentHours != null
      ? parseFloat((segmentHours + approvedOTHours).toFixed(2))
      : null;

    const lunchMins  = tl.lunchDeductionMinutes ?? 0;
    const coffeeMins = tl.totalBreakMinutes     ?? 0;

    return {
      ...approval,
      segmentType,
      schedule: {
        scheduledHours: segScheduledHours != null ? parseFloat(segScheduledHours.toFixed(2)) : null,
      },
      calculatedData: {
        actualHours:     segmentHours != null ? parseFloat(segmentHours.toFixed(2)) : (grossHours || null),
        approvedOTHours: parseFloat(approvedOTHours.toFixed(2)),
        hasApprovedOT:   approvedOTHours > 0,
        lateMinutes,
        lateStatus: lateMinutes > 0
          ? (lateMinutes <= gracePeriodMinutes ? "within_grace" : "beyond_grace")
          : null,
        earlyMinutes,
        earlyStatus: earlyMinutes > 0 ? "left_early" : null,
        rawOtMinutes: segRawOtMinutes,
      },
      breakData: {
        lunch:  { minutes: lunchMins,  deducted: lunchMins > 0 },
        coffee: { totalMinutes: coffeeMins },
        totalDeductions: {
          minutes: lunchMins + coffeeMins,
          hours:   +((lunchMins + coffeeMins) / 60).toFixed(2),
        },
      },
      payrollSummary: {
        scheduledHours:      segScheduledHours != null ? parseFloat(segScheduledHours.toFixed(2)) : null,
        payableRegularHours: segmentHours      != null ? parseFloat(segmentHours.toFixed(2))      : null,
        approvedOTHours:     parseFloat(approvedOTHours.toFixed(2)),
        totalPayableHours:   totalPayable,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDARD APPROVAL INCLUDE — reused across all approval queries
// ─────────────────────────────────────────────────────────────────────────────
const APPROVAL_INCLUDE = {
  timeLog: {
    select: {
      id: true, userId: true, timeIn: true, timeOut: true,
      punchType: true, status: true, isApproved: true,
      autoClockOut: true, lunchBreak: true, coffeeBreaks: true,
      originalTimeIn: true, originalTimeOut: true,
      // Derived fields — written by timeLogComputeService (source of truth)
      lateHours: true, undertimeHours: true,
      netWorkedHours: true, grossHours: true, scheduledHours: true,
      rawOtMinutes: true, lunchDeductionMinutes: true, totalBreakMinutes: true,
      regularSegmentHours: true, driverAmSegmentHours: true, driverPmSegmentHours: true,
      calculatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          profile: true,
          companyId: true,
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
        select: { id: true, requestedHours: true, status: true },
      },
    },
  },
  approver: {
    select: {
      id: true,
      email: true,
      username: true,
      profile: { select: { firstName: true, lastName: true } },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/cutoff-periods/create
 * Create a manual cutoff period
 * ✅ FIX: Now saves companyId + departmentId
 */
const createCutoffPeriod = async (req, res) => {
  try {
    const { periodStart, periodEnd, paymentDate, frequency, departmentId } = req.body;
    const userId    = req.user.id;
    const companyId = req.user.companyId;

    if (!periodStart || !periodEnd || !paymentDate || !frequency) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const validFrequencies = ["bi-weekly", "bi-monthly", "monthly"];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ message: "Invalid frequency. Must be: bi-weekly, bi-monthly, or monthly." });
    }

    const startDate = new Date(periodStart);
    const endDate   = new Date(periodEnd);
    const payDate   = new Date(paymentDate);

    if (endDate <= startDate) {
      return res.status(400).json({ message: "Period end date must be after start date." });
    }
    if (payDate < endDate) {
      return res.status(400).json({ message: "Payment date must be on or after period end date." });
    }

    // ✅ FIX: Overlap check scoped to company + department
    const overlapping = await prisma.cutoffPeriod.findFirst({
      where: {
        companyId,
        ...(departmentId ? { departmentId } : { departmentId: null }),
        OR: [
          { AND: [{ periodStart: { lte: startDate } }, { periodEnd: { gte: startDate } }] },
          { AND: [{ periodStart: { lte: endDate   } }, { periodEnd: { gte: endDate   } }] },
          { AND: [{ periodStart: { gte: startDate } }, { periodEnd: { lte: endDate   } }] },
        ],
      },
    });

    if (overlapping) {
      return res.status(400).json({ message: "Cutoff period overlaps with an existing period." });
    }

    // ✅ FIX: companyId + departmentId now persisted
    const cutoffPeriod = await prisma.cutoffPeriod.create({
      data: {
        id:          randomUUID(),
        companyId,
        departmentId: departmentId || null,
        periodStart:  startDate,
        periodEnd:    endDate,
        paymentDate:  payDate,
        frequency,
        status:       "open",
        createdBy:    userId,
        isAutoGenerated: false,
      },
    });

    // Create approval records for existing time logs in this period
    const userWhere = { companyId };
    if (departmentId) userWhere.departmentId = departmentId;

    const timeLogs = await prisma.timeLog.findMany({
      where: {
        user: userWhere,
        timeIn:  { gte: startDate, lte: endDate },
        timeOut: { not: null },
      },
      select: { id: true, punchType: true },
    });

    if (timeLogs.length > 0) {
      const approvalData = timeLogs.flatMap((log) => {
        if (log.punchType === "DRIVER_AIDE") {
          return ["driver_am", "regular", "driver_pm"].map((segmentType) => ({
            id: randomUUID(), timeLogId: log.id, cutoffPeriodId: cutoffPeriod.id, status: "pending", segmentType,
          }));
        }
        return [{ id: randomUUID(), timeLogId: log.id, cutoffPeriodId: cutoffPeriod.id, status: "pending", segmentType: null }];
      });
      await prisma.timeLogApproval.createMany({ data: approvalData, skipDuplicates: true });
    }

    console.log("[✅ Cutoff period created]", cutoffPeriod.id, `(${timeLogs.length} approvals)`);

    return res.status(201).json({
      message: "Cutoff period created successfully.",
      data: { ...cutoffPeriod, totalTimeLogs: timeLogs.length },
    });
  } catch (error) {
    console.error("❌ createCutoffPeriod:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * GET /api/cutoff-periods
 * Get all cutoff periods for the company
 */
const getCutoffPeriods = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, page = 1, limit = 100, departmentId } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      companyId,
      ...(status && { status }),
      ...(departmentId && departmentId !== "none" && { departmentId }),
      ...(departmentId === "none" && { departmentId: null }),
    };

    const [cutoffPeriods, total] = await Promise.all([
      prisma.cutoffPeriod.findMany({
        where,
        include: {
          creator: {
            select: { id: true, email: true, username: true, profile: true },
          },
          department: {
            select: { id: true, name: true },
          },
          _count: { select: { approvals: true } },
        },
        orderBy: { periodStart: "desc" },
        skip,
        take,
      }),
      prisma.cutoffPeriod.count({ where }),
    ]);

    // Approval stats per period
    // ✅ 'rejected' counted as 'excluded' for display consistency
    const periodsWithStats = await Promise.all(
      cutoffPeriods.map(async (period) => {
        const approvalStats = await prisma.timeLogApproval.groupBy({
          by: ["status"],
          where: { cutoffPeriodId: period.id },
          _count: true,
        });

        const stats = { pending: 0, approved: 0, excluded: 0 };
        approvalStats.forEach((s) => {
          if (s.status === "approved") stats.approved += s._count;
          else if (s.status === "pending") stats.pending += s._count;
          // Both 'excluded' and legacy 'rejected' roll into excluded
          else if (s.status === "excluded" || s.status === "rejected") stats.excluded += s._count;
        });

        return { ...period, approvalStats: stats };
      })
    );

    return res.status(200).json({
      message: "Cutoff periods retrieved successfully.",
      data: periodsWithStats,
      pagination: {
        page:       parseInt(page),
        limit:      parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ getCutoffPeriods:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * GET /api/cutoff-periods/:id
 * Get single cutoff period with full details
 * ✅ FIX: Uses companyId directly with OR fallback for old records
 */
const getCutoffPeriodById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    // Re-fetch with relations
    const full = await prisma.cutoffPeriod.findUnique({
      where: { id },
      include: {
        creator:    { select: { id: true, email: true, username: true, profile: true } },
        department: { select: { id: true, name: true } },
        approvals: {
          include: {
            timeLog: {
              include: {
                user: { select: { id: true, email: true, username: true, profile: true } },
              },
            },
            approver: {
              select: { id: true, email: true, username: true, profile: true },
            },
          },
          orderBy: { timeLog: { timeIn: "asc" } },
        },
      },
    });

    return res.status(200).json({
      message: "Cutoff period retrieved successfully.",
      data: full,
    });
  } catch (error) {
    console.error("❌ getCutoffPeriodById:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * PATCH /api/cutoff-periods/:id/status
 * Update cutoff status (open ↔ locked ↔ processed)
 * ✅ FIX: consistent companyId check; pending check respects excluded + legacy rejected
 */
const updateCutoffStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.companyId;

    const validStatuses = ["open", "locked", "processed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be: open, locked, or processed." });
    }

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "processed") {
      return res.status(400).json({ message: "Cannot change status of a processed cutoff period." });
    }

    // ✅ FIX: Only truly pending records block locking
    if (status === "locked") {
      const pendingCount = await prisma.timeLogApproval.count({
        where: {
          cutoffPeriodId: id,
          status: "pending",
        },
      });
      if (pendingCount > 0) {
        return res.status(400).json({
          message: `Cannot lock cutoff period. ${pendingCount} pending approval(s) remaining.`,
        });
      }
    }

    const updated = await prisma.cutoffPeriod.update({
      where: { id },
      data: { status },
    });

    console.log("[✅ Cutoff status updated]", id, "→", status);

    // Send notifications based on the new status
    try {
      const startStr = cutoffPeriod.startDate ? new Date(cutoffPeriod.startDate).toLocaleDateString() : null;
      const endStr = cutoffPeriod.endDate ? new Date(cutoffPeriod.endDate).toLocaleDateString() : null;
      const periodLabel = startStr && endStr ? `${startStr} - ${endStr}` : `Cutoff #${id.slice(-6)}`;

      if (status === 'locked') {
        // Notify management
        const managementUsers = await prisma.user.findMany({
          where: { companyId, role: { in: ['admin', 'superadmin', 'supervisor'] }, status: 'active' },
          select: { id: true, departmentId: true },
        });
        await Promise.all(managementUsers.map(manager =>
          createNotification({
            userId: manager.id,
            companyId,
            departmentId: manager.departmentId,
            notificationCode: 'CUTOFF_PERIOD_LOCKED',
            title: 'Cutoff Period Locked',
            message: `Cutoff period ${periodLabel} has been locked and is ready for processing.`,
            payload: { cutoffPeriodId: id, periodLabel },
          })
        ));
      } else if (status === 'processed') {
        // Notify all active employees in the company
        const employees = await prisma.user.findMany({
          where: { companyId, status: 'active' },
          select: { id: true, departmentId: true },
        });
        await Promise.all(employees.map(emp =>
          createNotification({
            userId: emp.id,
            companyId,
            departmentId: emp.departmentId,
            notificationCode: 'CUTOFF_PROCESSED',
            title: 'Payroll Processed',
            message: `Payroll for cutoff period ${periodLabel} has been processed.`,
            payload: { cutoffPeriodId: id, periodLabel },
          })
        ));
      }
    } catch (notifError) {
      console.error('❌ Failed to send cutoff status notification:', notifError);
    }

    return res.status(200).json({
      message: `Cutoff period status updated to ${status}.`,
      data: updated,
    });
  } catch (error) {
    console.error("❌ updateCutoffStatus:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * POST /api/cutoff-periods/:id/finalize
 * ✅ NEW: Finalize a cutoff period — locks it and marks it as ready for payroll
 * Non-reversible. Validates all records are approved or excluded before locking.
 * Treats legacy 'rejected' as excluded for backward compatibility.
 */
const finalizeCutoffPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({
        message: `Cutoff period is already ${cutoffPeriod.status}.`,
      });
    }

    // ✅ Check: no pending records remain
    const pendingCount = await prisma.timeLogApproval.count({
      where: { cutoffPeriodId: id, status: "pending" },
    });

    if (pendingCount > 0) {
      return res.status(400).json({
        message: `Cannot finalize. ${pendingCount} record(s) still pending review.`,
        data: { pendingCount },
      });
    }

    // Gather final stats for the response
    const statsRaw = await prisma.timeLogApproval.groupBy({
      by: ["status"],
      where: { cutoffPeriodId: id },
      _count: true,
    });

    const stats = { approved: 0, excluded: 0 };
    statsRaw.forEach((s) => {
      if (s.status === "approved") stats.approved += s._count;
      if (s.status === "excluded" || s.status === "rejected") stats.excluded += s._count;
    });

    // ✅ Lock the period
    // NOTE: finalizedAt / finalizedBy not in schema yet — add via migration if needed
    const locked = await prisma.cutoffPeriod.update({
      where: { id },
      data: { status: "locked" },
    });

    console.log("[✅ Cutoff finalized]", id, `— ${stats.approved} approved, ${stats.excluded} excluded`);

    // Notify management that the cutoff period is locked
    try {
      const startStr = cutoffPeriod.startDate ? new Date(cutoffPeriod.startDate).toLocaleDateString() : null;
      const endStr = cutoffPeriod.endDate ? new Date(cutoffPeriod.endDate).toLocaleDateString() : null;
      const periodLabel = startStr && endStr ? `${startStr} - ${endStr}` : `Cutoff #${id.slice(-6)}`;

      const managementUsers = await prisma.user.findMany({
        where: { companyId, role: { in: ['admin', 'superadmin', 'supervisor'] }, status: 'active' },
        select: { id: true, departmentId: true },
      });
      await Promise.all(managementUsers.map(manager =>
        createNotification({
          userId: manager.id,
          companyId,
          departmentId: manager.departmentId,
          notificationCode: 'CUTOFF_PERIOD_LOCKED',
          title: 'Cutoff Period Locked',
          message: `Cutoff period ${periodLabel} has been locked and is ready for processing.`,
          payload: { cutoffPeriodId: id, periodLabel, finalStats: stats },
        })
      ));
    } catch (notifError) {
      console.error('❌ Failed to send cutoff finalize notification:', notifError);
    }

    return res.status(200).json({
      message:  "Cutoff period finalized and locked. Records are now passed to payroll.",
      data: {
        ...locked,
        finalStats: stats,
      },
    });
  } catch (error) {
    console.error("❌ finalizeCutoffPeriod:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * DELETE /api/cutoff-periods/:id
 */
const deleteCutoffPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }
    if (cutoffPeriod.status === "processed") {
      return res.status(400).json({ message: "Cannot delete a processed cutoff period." });
    }

    await prisma.cutoffPeriod.delete({ where: { id } });

    console.log("[✅ Cutoff deleted]", id);
    return res.status(200).json({ message: "Cutoff period deleted successfully." });
  } catch (error) {
    console.error("❌ deleteCutoffPeriod:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SYNC HELPER
// Creates missing TimeLogApproval records for a cutoff period.
// Safe to call multiple times — uses skipDuplicates.
// Handles both department-scoped and company-wide cutoffs.
// ─────────────────────────────────────────────────────────────────────────────
async function syncApprovalRecords(cutoffPeriod, companyId) {
  const { id: cutoffPeriodId, periodStart, periodEnd, departmentId } = cutoffPeriod;

  const userWhere = { companyId };
  if (departmentId) userWhere.departmentId = departmentId;

  const timeLogs = await prisma.timeLog.findMany({
    where: {
      timeIn:  { gte: periodStart, lte: periodEnd },
      timeOut: { not: null },
      user:    userWhere,
    },
    select: { id: true, punchType: true, timeIn: true, userId: true },
  });

  if (timeLogs.length === 0) {
    console.log(`[ℹ️  Sync] No time logs found for cutoff ${cutoffPeriodId}`);
    return 0;
  }

  // DRIVER_AIDE punches get 3 segment records; all others get 1 record (segmentType = null).
  // Clean up stale null-segmentType records for DRIVER_AIDE logs before inserting — a previous
  // sync (or cutoff creation with old code) may have created a single segmentType:null record,
  // which would become an orphan alongside the 3 proper segment records.
  const driverAideLogs = timeLogs.filter((l) => l.punchType === "DRIVER_AIDE");
  const driverAideIds  = driverAideLogs.map((l) => l.id);

  if (driverAideIds.length > 0) {
    await prisma.timeLogApproval.deleteMany({
      where: {
        cutoffPeriodId,
        timeLogId:   { in: driverAideIds },
        segmentType: null,
        status:      "pending",
      },
    });
  }

  // Pre-resolve segment boundaries for DRIVER_AIDE logs so segmentStart / segmentEnd
  // are populated on the approval record at creation time.
  const segBoundaries = await resolveDriverAideSegments(driverAideLogs, companyId);

  // DRIVER_AIDE punches get 3 segment records; all others get 1 record (segmentType = null)
  const approvalData = timeLogs.flatMap((log) => {
    if (log.punchType === "DRIVER_AIDE") {
      const segs = segBoundaries[log.id] ?? {};
      return ["driver_am", "regular", "driver_pm"].map((segmentType) => {
        const seg = segs[segmentType] ?? null;
        return {
          id: randomUUID(), timeLogId: log.id, cutoffPeriodId, status: "pending", segmentType,
          segmentStart: seg?.start ?? null,
          segmentEnd:   seg?.end   ?? null,
        };
      });
    }
    return [{ id: randomUUID(), timeLogId: log.id, cutoffPeriodId, status: "pending", segmentType: null }];
  });

  const result = await prisma.timeLogApproval.createMany({
    data: approvalData,
    skipDuplicates: true,
  });

  if (result.count > 0) {
    console.log(`[✅ Sync] Created ${result.count} approval records for cutoff ${cutoffPeriodId}`);
  }

  return result.count;
}

/**
 * POST /api/cutoff-periods/:id/sync
 * Manually sync approval records — creates any missing TimeLogApproval rows.
 * Useful for cutoffs created before the auto-sync was added, or when new
 * punch logs are added after the cutoff was generated.
 */
const syncCutoffApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }
    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({
        message: `Cannot sync a ${cutoffPeriod.status} cutoff period.`,
      });
    }

    const created = await syncApprovalRecords(cutoffPeriod, companyId);

    const total = await prisma.timeLogApproval.count({
      where: { cutoffPeriodId: id },
    });

    return res.status(200).json({
      message: created > 0
        ? `Sync complete. ${created} new approval record(s) created.`
        : "Already in sync — no new records needed.",
      data: { created, total },
    });
  } catch (error) {
    console.error("❌ syncCutoffApprovals:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * GET /api/cutoff-periods/:id/approvals?status=pending|approved|excluded
 * Get all approvals for a cutoff, optionally filtered by status.
 * ✅ AUTO-SYNC: if no approval records exist, creates them before querying.
 * ✅ 'rejected' normalized to 'excluded' in response.
 */
const getCutoffApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, employeeId } = req.query;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    // ✅ AUTO-SYNC: if this is an open cutoff with no approval records yet,
    // create them now. Covers manually created cutoffs and backfilled periods.
    if (cutoffPeriod.status === "open") {
      const existingCount = await prisma.timeLogApproval.count({
        where: { cutoffPeriodId: id },
      });
      if (existingCount === 0) {
        await syncApprovalRecords(cutoffPeriod, companyId);
      }
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true, timeZone: true },
    });
    const gracePeriodMinutes  = company?.gracePeriodMinutes ?? 15;
    const companyTimezone     = company?.timeZone || "Asia/Manila";

    // ✅ When filtering by 'excluded', also include legacy 'rejected'
    let statusFilter;
    if (status === "excluded") {
      statusFilter = { in: ["excluded", "rejected"] };
    } else if (status) {
      statusFilter = status;
    }

    const approvals = await prisma.timeLogApproval.findMany({
      where: {
        cutoffPeriodId: id,
        ...(statusFilter && { status: statusFilter }),
        ...(employeeId && { timeLog: { userId: employeeId } }),
      },
      include: APPROVAL_INCLUDE,
      orderBy: { timeLog: { timeIn: "asc" } },
    });

    const enriched = await enrichApprovals(approvals, gracePeriodMinutes, companyTimezone);

    // ✅ Normalize legacy 'rejected' → 'excluded' in response
    const normalized = enriched.map((a) => ({
      ...a,
      status: a.status === "rejected" ? "excluded" : a.status,
    }));

    // ✅ Fetch Leave records for this cutoff period
    // Includes: approved leaves (shown as leave rows + conflict detection)
    //           pending leaves (shown as warning tag on punch row)
    const userWhere = { companyId };
    if (cutoffPeriod.departmentId) userWhere.departmentId = cutoffPeriod.departmentId;

    const leaveRecords = await prisma.leave.findMany({
      where: {
        status:    { in: ["approved", "pending"] },
        startDate: { lte: cutoffPeriod.periodEnd   },
        endDate:   { gte: cutoffPeriod.periodStart },
        User:      userWhere,
      },
      include: {
        User: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
            companyId: true,
            departmentId: true,
          },
        },
      },
      orderBy: { startDate: "asc" },
    });

    // ✅ Resolve leave type names — leaveType field may store a LeavePolicy ID
    // Fetch all LeavePolicy records once and build a lookup map
    const leavePolicies = await prisma.leavePolicy.findMany({
      where: { companyId },
      select: { id: true, leaveType: true },
    });
    const leavePolicyMap = Object.fromEntries(leavePolicies.map((p) => [p.id, p.leaveType]));

    // Helper: resolve leaveType string — if it looks like a cuid, look up the name
    const resolveLeaveType = (rawType) => {
      if (!rawType) return "Leave";
      // cuid pattern: starts with 'c' followed by ~24 alphanumeric chars
      const looksLikeId = /^c[a-z0-9]{20,30}$/.test(rawType);
      return looksLikeId ? (leavePolicyMap[rawType] || "Leave") : rawType;
    };

    // ✅ Attach pending leave warnings to matching punch records
    // ✅ Attach conflict flag when approved leave overlaps same day as punch
    const withLeaveContext = normalized.map((approval) => {
      const timeIn    = new Date(approval.timeLog.timeIn);
      const userId    = approval.timeLog.userId;
      const shiftTz   = approval.schedule?.scheduledStart
        ? companyTimezone
        : companyTimezone;
      // ✅ FIX: Use shift timezone for punch date, plain ISO strings for leave dates.
      // Leave dates are calendar dates — timezone-converting them shifts them by 1 day.
      const punchDate = moment.tz(timeIn, companyTimezone).format("YYYY-MM-DD");

      const dayLeaves = leaveRecords.filter((leave) => {
        if (leave.userId !== userId) return false;
        // Read leave date as plain ISO string — no timezone conversion
        const leaveStart = (leave.startDate instanceof Date
          ? leave.startDate.toISOString()
          : String(leave.startDate)).split("T")[0];
        const leaveEnd = (leave.endDate instanceof Date
          ? leave.endDate.toISOString()
          : String(leave.endDate)).split("T")[0];
        return punchDate >= leaveStart && punchDate <= leaveEnd;
      });

      const approvedLeave = dayLeaves.find((l) => l.status === "approved");
      const pendingLeave  = dayLeaves.find((l) => l.status === "pending");

      return {
        ...approval,
        hasLeaveConflict: !!approvedLeave,
        leaveRecord:      approvedLeave
          ? { id: approvedLeave.id, leaveType: approvedLeave.leaveType, status: "approved" }
          : null,
        pendingLeave: pendingLeave
          ? { id: pendingLeave.id, leaveType: pendingLeave.leaveType, status: "pending" }
          : null,
      };
    });

    // ✅ Build standalone leave rows for approved leaves with NO matching punch
    const punchUserDates = new Set(
      normalized.map((a) => {
        const punchDate = moment.tz(a.timeLog.timeIn, companyTimezone).format("YYYY-MM-DD");
        return `${a.timeLog.userId}__${punchDate}`;
      })
    );

    const standaloneLeaves = leaveRecords
      .filter((leave) => leave.status === "approved")
      .flatMap((leave) => {
        const rows = [];
        // ✅ FIX: Leave dates are calendar dates — read date part directly from ISO string.
        // NEVER timezone-convert: 2026-03-27T00:00:00Z in LA becomes Mar 26, giving wrong day.
        const startStr = (leave.startDate instanceof Date
          ? leave.startDate.toISOString()
          : String(leave.startDate)).split("T")[0];
        const endStr = (leave.endDate instanceof Date
          ? leave.endDate.toISOString()
          : String(leave.endDate)).split("T")[0];

        let cursor = moment(startStr); // plain moment — no timezone
        const endDay = moment(endStr);

        while (cursor.isSameOrBefore(endDay)) {
          const dateStr = cursor.format("YYYY-MM-DD");
          const key = `${leave.userId}__${dateStr}`;
          // Only add if this day is within cutoff AND no punch exists
          const cursorDate = cursor.toDate();
          const inCutoff =
            cursorDate >= cutoffPeriod.periodStart &&
            cursorDate <= cutoffPeriod.periodEnd;
          if (inCutoff && !punchUserDates.has(key)) {
            rows.push({
              _type:     "leave",
              id:        `leave_${leave.id}_${dateStr}`,
              leaveDate: dateStr,
              leave: {
                ...leave,
                leaveType: resolveLeaveType(leave.leaveType),
              },
              user: leave.User,
            });
          }
          cursor.add(1, "day");
        }
        return rows;
      });

    return res.status(200).json({
      message:           "Approvals retrieved successfully.",
      data:              withLeaveContext,
      leaves:            standaloneLeaves,
      gracePeriodMinutes,
      companyTimezone,
      synced:            true,
    });
  } catch (error) {
    console.error("❌ getCutoffApprovals:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * GET /api/cutoff-periods/:id/approvals/pending
 * Get only pending approvals with full enrichment
 */
const getPendingApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true, timeZone: true },
    });
    const gracePeriodMinutes  = company?.gracePeriodMinutes ?? 15;
    const companyTimezone     = company?.timeZone || "Asia/Manila";

    const approvals = await prisma.timeLogApproval.findMany({
      where: { cutoffPeriodId: id, status: "pending" },
      include: APPROVAL_INCLUDE,
      orderBy: { timeLog: { timeIn: "asc" } },
    });

    const enriched = await enrichApprovals(approvals, gracePeriodMinutes, companyTimezone);

    console.log("[✅ Pending approvals]", enriched.length);

    return res.status(200).json({
      message:             "Pending approvals retrieved successfully.",
      data:                enriched,
      gracePeriodMinutes,
    });
  } catch (error) {
    console.error("❌ getPendingApprovals:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * PATCH /api/cutoff-periods/:id/approvals/:approvalId
 * Approve, exclude, or reject a single time log
 * ✅ FIX: Now handles 'approve', 'exclude', and legacy 'reject' actions
 * ✅ FIX: On approve, applies snap rules and updates the actual TimeLog
 */
const updateSingleApproval = async (req, res) => {
  try {
    const { id, approvalId } = req.params;
    const { action, notes, reason, withOT, editedClockIn, editedClockOut } = req.body;
    const userId    = req.user.id;
    const companyId = req.user.companyId;

    const validActions = ["approve", "exclude", "reject"];
    if (!validActions.includes(action)) {
      return res.status(400).json({ message: "Action must be approve, exclude, or reject." });
    }

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }
    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({ message: `Cannot modify a ${cutoffPeriod.status} cutoff period.` });
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
      return res.status(404).json({ message: "Approval record not found in this cutoff period." });
    }

    if (approval.status !== "pending") {
      return res.status(400).json({ message: `Cannot modify an already ${approval.status} record.` });
    }

    // ── EXCLUDE ──
    if (action === "exclude") {
      const updated = await prisma.timeLogApproval.update({
        where: { id: approvalId },
        data: {
          status:     "excluded",
          approvedBy: userId,
          approvedAt: new Date(),
          notes:      reason || notes || null,
        },
      });

      console.log("[✅ Record excluded]", approvalId);
      return res.status(200).json({
        message: "Record excluded from payroll.",
        data: updated,
      });
    }

    // ── REJECT (legacy — treated as exclude for consistency) ──
    if (action === "reject") {
      const updated = await prisma.timeLogApproval.update({
        where: { id: approvalId },
        data: {
          status:     "excluded",
          approvedBy: userId,
          approvedAt: new Date(),
          notes:      notes || "Rejected by supervisor",
        },
      });

      return res.status(200).json({
        message: "Record excluded from payroll.",
        data: updated,
      });
    }

    // ── APPROVE ──
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true, timeZone: true },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;
    const companyTz          = company?.timeZone || "America/Los_Angeles";

    const timeLog    = approval.timeLog;
    const department = timeLog.user.department;

    // ── DRIVER_AIDE segment: no snap, trust stored computed segment hours ──
    if (timeLog.punchType === "DRIVER_AIDE") {
      try {
        await computeTimeLogSummary(timeLog.id);
      } catch (computeErr) {
        console.error(`[updateSingleApproval] computeTimeLogSummary failed for ${timeLog.id}:`, computeErr.message);
      }

      const fresh = await prisma.timeLog.findUnique({
        where:  { id: timeLog.id },
        select: { driverAmSegmentHours: true, regularSegmentHours: true, driverPmSegmentHours: true },
      });

      const segHoursMap = {
        driver_am: fresh?.driverAmSegmentHours,
        regular:   fresh?.regularSegmentHours,
        driver_pm: fresh?.driverPmSegmentHours,
      };
      const segHours = segHoursMap[approval.segmentType];

      const updated = await prisma.timeLogApproval.update({
        where: { id: approvalId },
        data: {
          status:          "approved",
          approvedBy:      userId,
          approvedAt:      new Date(),
          approvedClockIn:  new Date(timeLog.timeIn),
          approvedClockOut: timeLog.timeOut ? new Date(timeLog.timeOut) : null,
          scheduledHours:   segHours != null ? parseFloat(segHours.toString()) : null,
          actualHours:      segHours != null ? parseFloat(segHours.toString()) : null,
          ...(notes && { notes }),
        },
      });

      console.log("[✅ Segment approved]", approvalId, approval.segmentType);
      return res.status(200).json({ message: "Segment approved successfully.", data: updated });
    }

    // ── REGULAR punch: apply snap then recompute ──
    const localDateStr        = moment.tz(timeLog.timeIn, companyTz).format("YYYY-MM-DD");
    const dateOnlyForSchedule = moment.tz(timeLog.timeIn, companyTz).startOf("day").toDate();

    const userShift = await fetchScheduleForDate(
      timeLog.userId, dateOnlyForSchedule, timeLog.user?.departmentId, companyId, localDateStr
    );

    let finalClockIn  = editedClockIn  ? new Date(editedClockIn)  : new Date(timeLog.timeIn);
    let finalClockOut = editedClockOut ? new Date(editedClockOut) : (timeLog.timeOut ? new Date(timeLog.timeOut) : null);
    let scheduledHours = null;

    if (userShift?.shift) {
      const startTime = userShift.customStartTime || userShift.shift.startTime;
      const endTime   = userShift.customEndTime   || userShift.shift.endTime;
      const tz        = userShift.shift.timeZone || companyTz;

      const scheduledClockIn  = combineDateTime(localDateStr, startTime, tz);
      const scheduledClockOut = combineDateTime(localDateStr, endTime, tz);
      if (userShift.shift.crossesMidnight) scheduledClockOut.setDate(scheduledClockOut.getDate() + 1);

      if (!editedClockIn) {
        if (finalClockIn > scheduledClockIn) {
          const lateMinutes = (finalClockIn - scheduledClockIn) / 60000;
          finalClockIn = lateMinutes <= gracePeriodMinutes ? scheduledClockIn : finalClockIn;
        } else {
          finalClockIn = scheduledClockIn;
        }
      }

      if (!editedClockOut) {
        if (finalClockOut) {
          finalClockOut = finalClockOut < scheduledClockOut ? finalClockOut : scheduledClockOut;
          if (withOT && timeLog.timeOut && new Date(timeLog.timeOut) > scheduledClockOut) {
            finalClockOut = new Date(timeLog.timeOut);
          }
        } else {
          finalClockOut = scheduledClockOut;
        }
      }

      scheduledHours = calculateHours(finalClockIn, finalClockOut);
    }

    const actualHours = timeLog.timeOut ? calculateHours(timeLog.timeIn, timeLog.timeOut) : null;

    await prisma.timeLog.update({
      where: { id: timeLog.id },
      data: {
        originalTimeIn:  timeLog.originalTimeIn  || timeLog.timeIn,
        originalTimeOut: timeLog.originalTimeOut || timeLog.timeOut,
        timeIn:          finalClockIn,
        timeOut:         finalClockOut,
        isApproved:      true,
      },
    });

    try {
      await computeTimeLogSummary(timeLog.id);
    } catch (computeErr) {
      console.error(`[updateSingleApproval] computeTimeLogSummary failed for ${timeLog.id}:`, computeErr.message);
    }

    const updated = await prisma.timeLogApproval.update({
      where: { id: approvalId },
      data: {
        status:          "approved",
        approvedBy:      userId,
        approvedAt:      new Date(),
        approvedClockIn:  finalClockIn,
        approvedClockOut: finalClockOut,
        scheduledHours:   scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
        actualHours:      actualHours    ? parseFloat(actualHours.toFixed(2))    : null,
        ...(notes && { notes }),
      },
    });

    console.log("[✅ Approval approved]", approvalId, withOT ? "(with OT)" : "");

    return res.status(200).json({
      message: `Time log approved successfully.`,
      data:    updated,
    });
  } catch (error) {
    console.error("❌ updateSingleApproval:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * PATCH /api/cutoff-periods/:id/approvals/bulk
 * Bulk approve or exclude multiple time logs
 * ✅ FIX: action is now 'approve' | 'exclude' (reject treated as exclude)
 */
const bulkUpdateApprovals = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeLogIds, action, notes } = req.body;
    const userId    = req.user.id;
    const companyId = req.user.companyId;

    if (!Array.isArray(timeLogIds) || timeLogIds.length === 0) {
      return res.status(400).json({ message: "timeLogIds must be a non-empty array." });
    }
    if (!["approve", "exclude", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action must be approve or exclude." });
    }

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }
    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({ message: `Cannot modify a ${cutoffPeriod.status} cutoff period.` });
    }

    // ✅ Exclude / reject — simple status update, no TimeLog mutation
    if (action === "exclude" || action === "reject") {
      const updated = await prisma.timeLogApproval.updateMany({
        where: {
          cutoffPeriodId: id,
          timeLogId: { in: timeLogIds },
          status:    "pending",
        },
        data: {
          status:     "excluded",
          approvedBy: userId,
          approvedAt: new Date(),
          ...(notes && { notes }),
        },
      });

      return res.status(200).json({
        message: `${updated.count} record(s) excluded from payroll.`,
        data: { count: updated.count },
      });
    }

    // ── BULK APPROVE ──
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true, timeZone: true },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;

    const approvals = await prisma.timeLogApproval.findMany({
      where: {
        cutoffPeriodId: id,
        timeLogId: { in: timeLogIds },
        status:    "pending",
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

    let successCount = 0;
    let failCount    = 0;

    const companyTz = company?.timeZone || "America/Los_Angeles";

    for (const approval of approvals) {
      try {
        const timeLog = approval.timeLog;

        // ── DRIVER_AIDE segment: no snap, trust stored computed segment hours ──
        if (timeLog.punchType === "DRIVER_AIDE") {
          try { await computeTimeLogSummary(timeLog.id); } catch (_) {}

          const fresh = await prisma.timeLog.findUnique({
            where:  { id: timeLog.id },
            select: { driverAmSegmentHours: true, regularSegmentHours: true, driverPmSegmentHours: true },
          });
          const segHoursMap = { driver_am: fresh?.driverAmSegmentHours, regular: fresh?.regularSegmentHours, driver_pm: fresh?.driverPmSegmentHours };
          const segHours = segHoursMap[approval.segmentType];

          await prisma.timeLogApproval.update({
            where: { id: approval.id },
            data: {
              status: "approved", approvedBy: userId, approvedAt: new Date(),
              approvedClockIn: new Date(timeLog.timeIn),
              approvedClockOut: timeLog.timeOut ? new Date(timeLog.timeOut) : null,
              scheduledHours: segHours != null ? parseFloat(segHours.toString()) : null,
              actualHours:    segHours != null ? parseFloat(segHours.toString()) : null,
              ...(notes && { notes }),
            },
          });
          successCount++;
          continue;
        }

        // ── REGULAR punch: snap then recompute ──
        const localDateStr        = moment.tz(timeLog.timeIn, companyTz).format("YYYY-MM-DD");
        const dateOnlyForSchedule = moment.tz(timeLog.timeIn, companyTz).startOf("day").toDate();

        const userShift = await fetchScheduleForDate(
          timeLog.userId, dateOnlyForSchedule, timeLog.user?.departmentId, companyId, localDateStr
        );

        let finalClockIn  = new Date(timeLog.timeIn);
        let finalClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
        let scheduledHours = null;

        if (userShift?.shift) {
          const startTime = userShift.customStartTime || userShift.shift.startTime;
          const endTime   = userShift.customEndTime   || userShift.shift.endTime;
          const tz        = userShift.shift.timeZone || companyTz;

          const scheduledClockIn  = combineDateTime(localDateStr, startTime, tz);
          const scheduledClockOut = combineDateTime(localDateStr, endTime, tz);
          if (userShift.shift.crossesMidnight) scheduledClockOut.setDate(scheduledClockOut.getDate() + 1);

          if (finalClockIn > scheduledClockIn) {
            const lateMinutes = (finalClockIn - scheduledClockIn) / 60000;
            finalClockIn = lateMinutes <= gracePeriodMinutes ? scheduledClockIn : finalClockIn;
          } else {
            finalClockIn = scheduledClockIn;
          }
          finalClockOut = finalClockOut
            ? (finalClockOut < scheduledClockOut ? finalClockOut : scheduledClockOut)
            : scheduledClockOut;

          scheduledHours = calculateHours(finalClockIn, finalClockOut);
        }

        const actualHours = timeLog.timeOut ? calculateHours(timeLog.timeIn, timeLog.timeOut) : null;

        await prisma.timeLog.update({
          where: { id: timeLog.id },
          data: {
            originalTimeIn:  timeLog.originalTimeIn  || timeLog.timeIn,
            originalTimeOut: timeLog.originalTimeOut || timeLog.timeOut,
            timeIn: finalClockIn, timeOut: finalClockOut, isApproved: true,
          },
        });

        try { await computeTimeLogSummary(timeLog.id); } catch (_) {}

        await prisma.timeLogApproval.update({
          where: { id: approval.id },
          data: {
            status: "approved", approvedBy: userId, approvedAt: new Date(),
            approvedClockIn: finalClockIn, approvedClockOut: finalClockOut,
            scheduledHours: scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
            actualHours:    actualHours    ? parseFloat(actualHours.toFixed(2))    : null,
            ...(notes && { notes }),
          },
        });

        successCount++;
      } catch (err) {
        console.error(`❌ Bulk approve failed for ${approval.id}:`, err.message);
        failCount++;
      }
    }

    console.log(`[✅ Bulk approve] ${successCount} approved, ${failCount} failed`);

    return res.status(200).json({
      message: `${successCount} time log(s) approved successfully.${failCount > 0 ? ` ${failCount} failed.` : ""}`,
      data: { approved: successCount, failed: failCount },
    });
  } catch (error) {
    console.error("❌ bulkUpdateApprovals:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * PATCH /api/cutoff-periods/:id/approvals/:approvalId/conflict
 * ✅ NEW: Resolve a punch vs approved leave conflict
 *
 * choice === 'punch':
 *   - Approve the punch (apply snap rules)
 *   - Cancel the leave for that day and return the credit
 *
 * choice === 'leave':
 *   - Exclude the punch (with auto-reason)
 *   - Leave record stays as-is
 */
const resolveConflict = async (req, res) => {
  try {
    const { id, approvalId } = req.params;
    const { choice } = req.body;
    const userId    = req.user.id;
    const companyId = req.user.companyId;

    if (!["punch", "leave"].includes(choice)) {
      return res.status(400).json({ message: "Choice must be 'punch' or 'leave'." });
    }

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }
    if (cutoffPeriod.status === "locked" || cutoffPeriod.status === "processed") {
      return res.status(400).json({ message: `Cannot modify a ${cutoffPeriod.status} cutoff period.` });
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
      return res.status(400).json({ message: `Cannot resolve — record is already ${approval.status}.` });
    }

    const timeLog = approval.timeLog;

    // Fetch company settings up front — needed for timezone in both branches
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true, timeZone: true },
    });
    const gracePeriodMinutes = company?.gracePeriodMinutes ?? 15;
    const tzForConflict      = company?.timeZone || "America/Los_Angeles";

    const localDateStr        = moment.tz(timeLog.timeIn, tzForConflict).format("YYYY-MM-DD");
    const dateOnlyForSchedule = moment.tz(timeLog.timeIn, tzForConflict).startOf("day").toDate();

    // ── HONOR LEAVE: exclude the punch ──
    if (choice === "leave") {
      await prisma.timeLogApproval.update({
        where: { id: approvalId },
        data: {
          status:     "excluded",
          approvedBy: userId,
          approvedAt: new Date(),
          notes:      "Conflict resolved — leave takes precedence",
        },
      });

      console.log("[✅ Conflict resolved — leave honored]", approvalId);

      return res.status(200).json({
        message: "Leave honored. Punch excluded from payroll.",
        data: { choice, leaveKept: true, punchExcluded: true },
      });
    }

    // ── HONOR PUNCH: approve the punch + cancel the leave ──

    const userShift = await fetchScheduleForDate(
      timeLog.userId,
      dateOnlyForSchedule,
      timeLog.user?.departmentId,
      companyId,
      localDateStr
    );

    let finalClockIn  = new Date(timeLog.timeIn);
    let finalClockOut = timeLog.timeOut ? new Date(timeLog.timeOut) : null;
    let scheduledHours = null;

    if (userShift?.shift) {
      const startTime = userShift.customStartTime || userShift.shift.startTime;
      const endTime   = userShift.customEndTime   || userShift.shift.endTime;
      const tz        = userShift.shift.timeZone || tzForConflict;

      const scheduledClockIn  = combineDateTime(localDateStr, startTime, tz);
      const scheduledClockOut = combineDateTime(localDateStr, endTime, tz);
      if (userShift.shift.crossesMidnight) scheduledClockOut.setDate(scheduledClockOut.getDate() + 1);

      if (finalClockIn > scheduledClockIn) {
        const lateMinutes = (finalClockIn - scheduledClockIn) / 60000;
        finalClockIn = lateMinutes <= gracePeriodMinutes ? scheduledClockIn : finalClockIn;
      } else {
        finalClockIn = scheduledClockIn;
      }

      finalClockOut = finalClockOut
        ? (finalClockOut < scheduledClockOut ? finalClockOut : scheduledClockOut)
        : scheduledClockOut;

      const grossHours = calculateHours(finalClockIn, finalClockOut);
      let totalBreakDeductions = 0;
      const dept = timeLog.user.department;
      if (dept) {
        const breakData    = calculateBreakTimes(timeLog, dept);
        const coffeePolicy = checkCoffeeBreakPolicy(breakData.coffeeBreakMinutes, dept);
        totalBreakDeductions = getTotalBreakDeductions(breakData, coffeePolicy);
      }
      scheduledHours = grossHours - totalBreakDeductions / 60;
    }

    // Update TimeLog
    await prisma.timeLog.update({
      where: { id: timeLog.id },
      data: {
        originalTimeIn:  timeLog.originalTimeIn  || timeLog.timeIn,
        originalTimeOut: timeLog.originalTimeOut || timeLog.timeOut,
        timeIn:          finalClockIn,
        timeOut:         finalClockOut,
        isApproved:      true,
      },
    });

    // Recompute derived fields against the conflict-resolved times
    try {
      await computeTimeLogSummary(timeLog.id);
    } catch (computeErr) {
      console.error(`[resolveConflict] computeTimeLogSummary failed for ${timeLog.id}:`, computeErr.message);
    }

    // Approve the punch
    await prisma.timeLogApproval.update({
      where: { id: approvalId },
      data: {
        status:          "approved",
        approvedBy:      userId,
        approvedAt:      new Date(),
        approvedClockIn:  finalClockIn,
        approvedClockOut: finalClockOut,
        scheduledHours:   scheduledHours ? parseFloat(scheduledHours.toFixed(2)) : null,
        notes:            "Conflict resolved — punch takes precedence",
      },
    });

    // ✅ Cancel the leave for that day and return the credit
    // Schema: model is Leave (not LeaveRequest), credit is LeaveBalance.balanceHours
    let leaveCancelled = false;
    try {
      const leave = await prisma.leave.findFirst({
        where: {
          userId:    timeLog.userId,
          status:    "approved",
          startDate: { lte: new Date(timeLog.timeIn) },
          endDate:   { gte: new Date(timeLog.timeIn) },
        },
      });

      if (leave) {
        // Cancel the leave record
        await prisma.leave.update({
          where: { id: leave.id },
          data: {
            status:          "cancelled",
            approverComments: "Cancelled — conflict resolved in favour of punch during cutoff review",
          },
        });

        // Return the leave credit via LeaveBalance
        // Calculate days covered by this leave that overlap with punch date
        // Use company defaultShiftHours (default 8h) per day as credit unit
        try {
          const leavePolicy = await prisma.leavePolicy.findFirst({
            where: { companyId, leaveType: leave.leaveType },
          });
          if (leavePolicy) {
            const leaveBalance = await prisma.leaveBalance.findFirst({
              where: { userId: timeLog.userId, policyId: leavePolicy.id },
            });
            if (leaveBalance) {
              // Return 1 day worth of hours (8h default)
              const hoursToReturn = 8;
              await prisma.leaveBalance.update({
                where: { id: leaveBalance.id },
                data: { balanceHours: { increment: hoursToReturn } },
              });
              console.log("[✅ Leave credit returned]", hoursToReturn, "hours to", timeLog.userId);
            }
          }
        } catch (creditErr) {
          // Credit return is best-effort — leave cancellation already succeeded
          console.warn("[⚠️  Could not return leave credit]", creditErr.message);
        }

        leaveCancelled = true;
        console.log("[✅ Leave cancelled]", leave.id);
      }
    } catch (leaveErr) {
      // Leave cancellation is best-effort — don't fail the whole operation
      console.warn("[⚠️  Could not cancel leave record]", leaveErr.message);
    }

    console.log("[✅ Conflict resolved — punch honored]", approvalId);

    return res.status(200).json({
      message: `Punch honored. ${leaveCancelled ? "Leave credit returned to employee balance." : "Note: leave record could not be automatically cancelled — please review manually."}`,
      data: { choice, punchApproved: true, leaveCancelled },
    });
  } catch (error) {
    console.error("❌ resolveConflict:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

/**
 * GET /api/cutoff-periods/:id/summary
 * Payroll summary for a finalized/locked cutoff period
 */
const getCutoffSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const cutoffPeriod = await findCutoffForCompany(id, companyId);
    if (!cutoffPeriod) {
      return res.status(404).json({ message: "Cutoff period not found." });
    }

    const approvedApprovals = await prisma.timeLogApproval.findMany({
      where: { cutoffPeriodId: id, status: "approved" },
      include: {
        timeLog: {
          include: {
            user: { select: { id: true, email: true, username: true, profile: true } },
            overtime: {
              where: { status: "approved" },
              select: { id: true, requestedHours: true },
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
          employee:     timeLog.user,
          regularHours: 0,
          overtimeHours: 0,
          totalHours:   0,
          approvedLogs: 0,
        };
      }

      const regularHours  = approval.scheduledHours || 0;
      const overtimeHours = timeLog.overtime.reduce(
        (sum, ot) => sum + parseFloat(ot.requestedHours || 0),
        0
      );

      employeeSummary[userId].regularHours  += regularHours;
      employeeSummary[userId].overtimeHours += overtimeHours;
      employeeSummary[userId].totalHours    += regularHours + overtimeHours;
      employeeSummary[userId].approvedLogs  += 1;
    });

    const summary = Object.values(employeeSummary).map((emp) => ({
      ...emp,
      regularHours:  parseFloat(emp.regularHours.toFixed(2)),
      overtimeHours: parseFloat(emp.overtimeHours.toFixed(2)),
      totalHours:    parseFloat(emp.totalHours.toFixed(2)),
    }));

    return res.status(200).json({
      message: "Cutoff summary generated successfully.",
      data: {
        cutoffPeriod: {
          id:           cutoffPeriod.id,
          periodStart:  cutoffPeriod.periodStart,
          periodEnd:    cutoffPeriod.periodEnd,
          paymentDate:  cutoffPeriod.paymentDate,
          frequency:    cutoffPeriod.frequency,
          status:       cutoffPeriod.status,
          departmentId: cutoffPeriod.departmentId,
        },
        employees: summary,
        totals: {
          totalEmployees:    summary.length,
          totalRegularHours: parseFloat(summary.reduce((s, e) => s + e.regularHours,  0).toFixed(2)),
          totalOvertimeHours:parseFloat(summary.reduce((s, e) => s + e.overtimeHours, 0).toFixed(2)),
          totalHours:        parseFloat(summary.reduce((s, e) => s + e.totalHours,    0).toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error("❌ getCutoffSummary:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

module.exports = {
  createCutoffPeriod,
  getCutoffPeriods,
  getCutoffPeriodById,
  updateCutoffStatus,
  finalizeCutoffPeriod,
  deleteCutoffPeriod,
  getCutoffApprovals,
  getPendingApprovals,
  syncCutoffApprovals,
  bulkUpdateApprovals,
  updateSingleApproval,
  resolveConflict,
  getCutoffSummary,
};