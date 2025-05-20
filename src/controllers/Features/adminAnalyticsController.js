// src/controllers/Features/adminAnalyticsController.js

const { prisma } = require("@config/connection");
const { differenceInHours, parseISO, startOfDay, endOfDay, addDays } = require("date-fns");

/* ---------- helpers ---------- */
function shiftDurationHours(shift) {
  const s = shift.startTime;
  const e = shift.endTime;
  const diff = (e.getTime() - s.getTime()) / 36e5 + (shift.crossesMidnight ? 24 : 0);
  return diff < 0 ? diff + 24 : diff; // safety net
}

function logDurationHours(log) {
  if (!log.timeOut) return 0;
  let hrs = (log.timeOut.getTime() - log.timeIn.getTime()) / 36e5;
  /* subtract breaks */
  if (Array.isArray(log.coffeeBreaks)) {
    log.coffeeBreaks.forEach((b) => {
      if (b.start && b.end) hrs -= (new Date(b.end) - new Date(b.start)) / 36e5;
    });
  }
  if (log.lunchBreak && log.lunchBreak.start && log.lunchBreak.end) {
    hrs -= (new Date(log.lunchBreak.end) - new Date(log.lunchBreak.start)) / 36e5;
  }
  return hrs > 0 ? hrs : 0;
}

exports.getAdminAnalytics = async (req, res) => {
  try {
    const { companyId } = req.user;
    const from = req.query.from ? parseISO(req.query.from) : addDays(startOfDay(new Date()), -30);
    const to = req.query.to ? endOfDay(parseISO(req.query.to)) : endOfDay(new Date());

    /* ───────────────────────────────────────────────────────────
     *  DB pulls (keep them parallel for speed)
     * ─────────────────────────────────────────────────────────── */
    const [timelogs, userShifts, leaves, paySettings] = await Promise.all([
      prisma.timeLog.findMany({
        where: {
          user: { companyId },
          timeIn: { gte: from, lte: to },
        },
        include: { user: { select: { departmentId: true } } },
      }),
      prisma.userShift.findMany({
        where: {
          user: { companyId },
          assignedDate: { gte: from, lte: to },
        },
        include: { shift: true, user: { select: { departmentId: true } } },
      }),
      prisma.leave.findMany({
        where: {
          user: { companyId },
          startDate: { lte: to },
          endDate: { gte: from },
        },
      }),
      prisma.payrollSettings.findUnique({ where: { companyId } }),
    ]);

    /* ───────────────────────────────────────────────────────────
     *  1. Active staff timeline  (unique users who logged a punch)
     * ─────────────────────────────────────────────────────────── */
    const activeTimeline = {};
    const activeUsersSet = new Set();
    timelogs.forEach((l) => {
      const key = l.timeIn.toISOString().slice(0, 7); // YYYY-MM
      activeTimeline[key] = (activeTimeline[key] || new Set()).add(l.userId);
      activeUsersSet.add(l.userId);
    });
    const activeTimelineArr = Object.entries(activeTimeline).map(([month, set]) => ({ month, count: set.size }));

    /* ───────────────────────────────────────────────────────────
     *  2. Scheduled vs Actual
     * ─────────────────────────────────────────────────────────── */
    let totalScheduled = 0;
    userShifts.forEach((us) => {
      totalScheduled += shiftDurationHours(us.shift);
    });

    let totalActual = 0;
    timelogs.forEach((l) => {
      totalActual += logDurationHours(l);
    });

    /* ───────────────────────────────────────────────────────────
     *  3. Late clock-in / early clock-out
     * ─────────────────────────────────────────────────────────── */
    let lateCnt = 0,
      earlyCnt = 0;
    userShifts.forEach((us) => {
      const logsForUserDate = timelogs.filter(
        (tl) => tl.userId === us.userId && tl.timeIn.toISOString().slice(0, 10) === us.assignedDate.toISOString().slice(0, 10)
      );
      if (!logsForUserDate.length) return;
      const firstIn = logsForUserDate.reduce((min, tl) => (tl.timeIn < min ? tl.timeIn : min), logsForUserDate[0].timeIn);
      const lastOut = logsForUserDate.reduce(
        (max, tl) => (tl.timeOut && tl.timeOut > max ? tl.timeOut : max),
        logsForUserDate[0].timeOut || logsForUserDate[0].timeIn
      );

      const schedStart = new Date(us.assignedDate);
      schedStart.setHours(us.shift.startTime.getHours(), us.shift.startTime.getMinutes());
      const schedEnd = new Date(us.assignedDate);
      schedEnd.setHours(us.shift.endTime.getHours(), us.shift.endTime.getMinutes());
      if (us.shift.crossesMidnight) schedEnd.setDate(schedEnd.getDate() + 1);

      if (firstIn > schedStart) lateCnt++;
      if (lastOut && lastOut < schedEnd) earlyCnt++;
    });
    const totalShifts = userShifts.length;
    const latePct = totalShifts ? ((lateCnt / totalShifts) * 100).toFixed(1) : 0;
    const earlyPct = totalShifts ? ((earlyCnt / totalShifts) * 100).toFixed(1) : 0;

    /* ───────────────────────────────────────────────────────────
     *  4. Attendance reliability
     * ─────────────────────────────────────────────────────────── */
    let onTimeShifts = totalShifts - lateCnt - earlyCnt;
    const attendanceReliability = totalShifts ? ((onTimeShifts / totalShifts) * 100).toFixed(1) : 0;

    /* ───────────────────────────────────────────────────────────
     *  5. Leave usage & approvals
     * ─────────────────────────────────────────────────────────── */
    const leaveUsage = {};
    let approved = 0,
      pending = 0,
      rejected = 0;
    leaves.forEach((lv) => {
      const days = differenceInHours(lv.endDate > to ? to : lv.endDate, lv.startDate < from ? from : lv.startDate) / 24;
      if (lv.status === "approved") {
        approved++;
        leaveUsage[lv.leaveType] = (leaveUsage[lv.leaveType] || 0) + days;
      } else if (lv.status === "pending") pending++;
      else if (lv.status === "rejected") rejected++;
    });

    /* ───────────────────────────────────────────────────────────
     *  6. Overtime
     * ─────────────────────────────────────────────────────────── */
    const shiftHoursMap = {}; // userId+date -> schedHrs
    userShifts.forEach((us) => {
      const key = us.userId + "-" + us.assignedDate.toISOString().slice(0, 10);
      shiftHoursMap[key] = (shiftHoursMap[key] || 0) + shiftDurationHours(us.shift);
    });

    let totalOvertime = 0;
    const overtimeByDept = {};
    timelogs.forEach((l) => {
      const dateKey = l.timeIn.toISOString().slice(0, 10);
      const key = l.userId + "-" + dateKey;
      const sched = shiftHoursMap[key] || 0;
      const actual = logDurationHours(l);
      if (actual > sched) {
        const ot = actual - sched;
        totalOvertime += ot;
        const dept = l.user.departmentId || "none";
        overtimeByDept[dept] = (overtimeByDept[dept] || 0) + ot;
      }
    });

    /* cost impact */
    const otRate = paySettings ? paySettings.overtimeRate : 1.5;
    const overtimeCost = Number((totalOvertime * otRate).toFixed(2));

    /* ───────────────────────────────────────────────────────────
     *  7. Shift coverage (simply: % of userShift rows that have
     *     at least ONE timelog for that user / date)
     * ─────────────────────────────────────────────────────────── */
    let covered = 0;
    userShifts.forEach((us) => {
      const hasPunch = timelogs.some(
        (tl) => tl.userId === us.userId && tl.timeIn.toISOString().slice(0, 10) === us.assignedDate.toISOString().slice(0, 10)
      );
      if (hasPunch) covered++;
    });
    const coverageRate = totalShifts ? ((covered / totalShifts) * 100).toFixed(1) : 0;

    /* ───────────────────────────────────────────────────────────
     *  Response
     * ─────────────────────────────────────────────────────────── */
    return res.status(200).json({
      message: "Analytics ready",
      data: {
        period: { from, to },
        activeStaff: {
          totalUnique: activeUsersSet.size,
          timeline: activeTimelineArr,
        },
        scheduledVsActual: {
          scheduledHours: Number(totalScheduled.toFixed(2)),
          actualHours: Number(totalActual.toFixed(2)),
          variance: Number((totalActual - totalScheduled).toFixed(2)),
        },
        lateEarlyRate: {
          lateCnt,
          earlyCnt,
          latePct,
          earlyPct,
        },
        attendanceReliability,
        leaveUsageByType: leaveUsage,
        leaveRequestsVsApprovals: { approved, pending, rejected },
        overtime: {
          totalHours: Number(totalOvertime.toFixed(2)),
          overtimeCostImpact: overtimeCost,
          byDepartment: overtimeByDept,
        },
        shiftCoverageRate: coverageRate,
      },
    });
  } catch (err) {
    console.error("getAdminAnalytics error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};
