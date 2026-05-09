// src/services/strategies/bncStrategy.js
//
// TimeLog compute strategy for B&C (REGULAR punch type, multi-shift employees).
//
// Each punch is computed independently against its own matched shift window —
// separate lateHours, undertimeHours, and OT per TimeLog.
//
// Segment fields (regularSegmentHours, driverAmSegmentHours, driverPmSegmentHours)
// are not applicable here and are left untouched (undefined in the update payload).

const moment = require("moment-timezone");
const { prisma } = require("@config/connection");
const {
  resolveTimezone,
  combineDateWithTimeTz,
  sumCoffeeBreakMinutes,
  lunchBreakMinutes,
  matchShiftToWindow,
} = require("@services/timeLogComputeUtils");

async function computeBnC(timeLogId) {
  // ── 1. Fetch TimeLog ──────────────────────────────────────────────────────
  const log = await prisma.timeLog.findUnique({
    where: { id: timeLogId },
    include: {
      user: { select: { companyId: true, departmentId: true } },
    },
  });

  if (!log || !log.timeOut) return null;

  const timeIn  = new Date(log.timeIn);
  const timeOut = new Date(log.timeOut);

  // ── 2. Company settings ───────────────────────────────────────────────────
  const company = await prisma.company.findUnique({
    where: { id: log.user.companyId },
    select: {
      timeZone:             true,
      gracePeriodMinutes:   true,
      minimumLunchMinutes:  true,
      defaultShiftHours:    true,
      otBasis:              true,
      dailyOtThresholdHours: true,
      autoBreakBasis:       true,
      autoLunchEnabled:     true,
      autoCoffeeEnabled:    true,
    },
  });

  const tz                = resolveTimezone(company?.timeZone);
  const gracePeriodMins   = company?.gracePeriodMinutes   ?? 15;
  const minimumLunchMins  = company?.minimumLunchMinutes  ?? 60;
  const defaultShiftHours = parseFloat(company?.defaultShiftHours ?? 8);
  const graceMs           = (gracePeriodMins * 60 + 59) * 1000;
  const otBasis           = company?.otBasis              ?? "daily";
  const dailyOtThreshold  = parseFloat(company?.dailyOtThresholdHours ?? 8);

  // ── 2b. Department break config (when autoBreakBasis = "department") ──────────
  // Shift-based break config is resolved in step 4b after shift matching.
  let breakConfig = null;
  if (company?.autoBreakBasis === "department" && log.user.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: log.user.departmentId },
      select: {
        autoLunchEntitled:         true,
        autoBreakLunchMinutes:     true,
        autoBreakLunchAfterHours:  true,
        autoBreakLunchDeductible:  true,
        autoCoffeeEntitled:        true,
        autoBreakCoffeeMinutes:    true,
        autoBreakCoffeeCount:      true,
        autoBreakCoffeeDeductible: true,
      },
    });
    breakConfig = dept;
  }

  // ── 3. UserShifts for the clock-in date ──────────────────────────────────
  const localDateStr = moment(timeIn).tz(tz).format("YYYY-MM-DD");
  const dayStart     = new Date(`${localDateStr}T00:00:00.000Z`);
  const dayEnd       = new Date(`${localDateStr}T23:59:59.999Z`);

  const userShifts = await prisma.userShift.findMany({
    where: {
      userId:       log.userId,
      assignedDate: { gte: dayStart, lte: dayEnd },
      status:       { not: "cancelled" },
    },
    include: { shift: true },
    orderBy: { shift: { startTime: "asc" } },
  });

  // ── 3b. ShiftSchedule fallback ────────────────────────────────────────────
  if (userShifts.length === 0) {
    const dayOfWeek = moment(localDateStr).day();
    const { companyId, departmentId } = log.user;

    const orConditions = [
      { assignmentType: "individual", targetId: log.userId },
      { assignmentType: "all" },
    ];
    if (departmentId) {
      orConditions.push({ assignmentType: "department", targetId: departmentId });
    }

    const schedules = await prisma.shiftSchedule.findMany({
      where: {
        companyId,
        OR:        orConditions,
        startDate: { lte: dayStart },
        endDate:   { gte: dayStart },
        isActive:  true,
      },
      include: { shift: true },
    });

    const PRIORITY = { individual: 0, department: 1, all: 2 };

    // Collect ALL schedules that include this day of week, then keep only
    // the highest-priority tier. This ensures a B&C employee with two
    // individual ShiftSchedules on the same day (e.g. AM + PM) both land
    // in userShifts so matchShiftToWindow can pick the right one per punch.
    const allMatched = schedules.filter((s) =>
      Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(dayOfWeek)
    );

    if (allMatched.length > 0) {
      const highestPriority = Math.min(...allMatched.map((s) => PRIORITY[s.assignmentType] ?? 99));
      const bestMatched     = allMatched.filter((s) => (PRIORITY[s.assignmentType] ?? 99) === highestPriority);

      for (const s of bestMatched) {
        if (s.shift) {
          userShifts.push({
            id:              s.id,
            shift:           s.shift,
            assignedDate:    dayStart,
            customStartTime: null,
            customEndTime:   null,
          });
        }
      }
    }
  }

  // ── 4. Resolve shift boundaries ───────────────────────────────────────────
  // Multi-shift B&C: narrow to the one shift this punch belongs to.
  const matchedUserShift = userShifts.length > 1
    ? matchShiftToWindow(userShifts, timeIn, timeOut, tz)
    : null;

  const effectiveShifts = matchedUserShift ? [matchedUserShift] : userShifts;

  // ── 4b. Shift-based break config ──────────────────────────────────────────
  if (company?.autoBreakBasis === "shift") {
    breakConfig = matchedUserShift?.shift ?? (userShifts[0]?.shift ?? null);
  }

  let shiftStart = null;
  let shiftEnd   = null;

  if (effectiveShifts.length > 0) {
    const firstShift = effectiveShifts[0];
    if (firstShift.shift?.startTime) {
      shiftStart = combineDateWithTimeTz(timeIn, firstShift.shift.startTime, tz);
    }

    let latestEndDate = null;
    for (const us of effectiveShifts) {
      if (!us.shift?.endTime) continue;
      const endDate = combineDateWithTimeTz(timeIn, us.shift.endTime, tz);
      if (!latestEndDate || endDate > latestEndDate) latestEndDate = endDate;
    }
    if (latestEndDate) {
      shiftEnd = latestEndDate;
      if (shiftStart && shiftEnd <= shiftStart) {
        shiftEnd = moment(shiftEnd).add(1, "day").toDate();
      }
    }
  }

  // Fallback: no shift assigned — use timeIn + defaultShiftHours
  if (!shiftEnd) {
    shiftEnd = new Date(timeIn.getTime() + defaultShiftHours * 60 * 60 * 1000);
  }

  // ── 5. Gross hours ────────────────────────────────────────────────────────
  const grossHours = +((timeOut.getTime() - timeIn.getTime()) / 3600000).toFixed(2);

  // ── 6. Break totals ───────────────────────────────────────────────────────
  const coffeeBreakMins = sumCoffeeBreakMinutes(log.coffeeBreaks);
  const lunchMins       = lunchBreakMinutes(log.lunchBreak);

  let lunchDeductionMins;
  if (log.autoLunchDeductionMinutes != null) {
    // Auto-injected deductible lunch — exact value set at injection time
    lunchDeductionMins = log.autoLunchDeductionMinutes;
  } else if (log.autoLunchApplied) {
    // Auto-injected but non-deductible — paper trail only, no pay impact
    lunchDeductionMins = 0;
  } else if (lunchMins > 0) {
    // Manual lunch taken
    lunchDeductionMins = Math.max(lunchMins, minimumLunchMins);
  } else {
    // No lunch taken, no auto-lunch applied.
    // B&C: only deduct if this shift/dept has deductible auto-lunch configured.
    // Never blindly deduct minimumLunchMins — toggle must be explicitly on.
    lunchDeductionMins = (breakConfig?.autoLunchEntitled && breakConfig?.autoBreakLunchDeductible)
      ? (breakConfig?.autoBreakLunchMinutes ?? minimumLunchMins)
      : 0;
  }

  const totalBreakMins = Math.round(coffeeBreakMins + lunchDeductionMins);

  // ── 7. Scheduled hours ────────────────────────────────────────────────────
  let scheduledHours = null;

  if (effectiveShifts.length > 0) {
    let totalScheduledMs = 0;
    const seenShiftIds   = new Set();
    for (const us of effectiveShifts) {
      if (!us.shift?.startTime || !us.shift?.endTime) continue;
      if (us.shift.id) {
        if (seenShiftIds.has(us.shift.id)) continue;
        seenShiftIds.add(us.shift.id);
      }
      const segStart = combineDateWithTimeTz(timeIn, us.shift.startTime, tz);
      let   segEnd   = combineDateWithTimeTz(timeIn, us.shift.endTime,   tz);
      if (segEnd <= segStart) segEnd = moment(segEnd).add(1, "day").toDate();
      totalScheduledMs += segEnd.getTime() - segStart.getTime();
    }
    if (totalScheduledMs > 0) {
      scheduledHours = +(totalScheduledMs / 3600000).toFixed(2);
    }
  }

  // ── 8. Late hours ─────────────────────────────────────────────────────────
  let lateHours = null;
  if (shiftStart) {
    const rawLateMs = timeIn.getTime() - shiftStart.getTime();
    lateHours = rawLateMs > graceMs ? +(rawLateMs / 3600000).toFixed(2) : 0;
  }

  // ── 9. Undertime hours ────────────────────────────────────────────────────
  const rawUndertimeMs = shiftEnd.getTime() - timeOut.getTime();
  const undertimeHours = rawUndertimeMs > graceMs ? +(rawUndertimeMs / 3600000).toFixed(2) : 0;

  // ── 10. Net worked hours ──────────────────────────────────────────────────
  const grossMs        = timeOut - timeIn;
  const deductionMs    = totalBreakMins * 60 * 1000;
  const netWorkedHours = +(Math.max(0, grossMs - deductionMs) / 3600000).toFixed(2);

  // rawOtMinutes is intentionally null for B&C — OT is not a per-punch
  // calculation. It is aggregated per day/week/cutoff period in the
  // cutoff controller based on company.otBasis and the relevant threshold.
  const rawOtMinutes = null;

  // ── 11. Write back ────────────────────────────────────────────────────────
  const derivedFields = {
    lateHours:             lateHours      !== null ? lateHours      : undefined,
    undertimeHours,
    netWorkedHours,
    lunchDeductionMinutes: Math.round(lunchDeductionMins),
    totalBreakMinutes:     Math.round(coffeeBreakMins),
    rawOtMinutes,
    scheduledHours:        scheduledHours !== null ? scheduledHours : undefined,
    grossHours,
    calculatedAt:          new Date(),
  };

  await prisma.timeLog.update({
    where: { id: timeLogId },
    data:  derivedFields,
  });

  console.log(
    `[computeBnC] ✓ ${timeLogId}` +
    ` | punchType=${log.punchType}` +
    ` | lateHours=${lateHours ?? "n/a"}` +
    ` | undertime=${undertimeHours}h` +
    ` | gross=${grossHours}h` +
    ` | net=${netWorkedHours}h` +
    ` | scheduled=${scheduledHours ?? "n/a"}h` +
    ` | lunch=${Math.round(lunchDeductionMins)}min` +
    ` | rawOtMins=${rawOtMinutes}` +
    ` | tz=${tz}`
  );

  return derivedFields;
}

module.exports = { computeBnC };
