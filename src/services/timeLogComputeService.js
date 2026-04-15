// src/services/timeLogComputeService.js
//
// Single source of truth for all TimeLog derived field computation.
//
// RULES:
//   - Raw timeIn / timeOut are NEVER modified here. They are immutable after creation.
//   - All shift times are resolved in company.timeZone (PDT / America/Los_Angeles).
//     The server's local timezone (Asia/Manila) is never used.
//   - This function is the ONLY place that writes the derived fields:
//       lateHours, undertimeHours, netWorkedHours,
//       lunchDeductionMinutes, totalBreakMinutes,
//       regularSegmentHours, driverAmSegmentHours, driverPmSegmentHours,
//       rawOtMinutes, calculatedAt
//   - Safe to call multiple times on the same record — always produces the same
//     result for the same inputs (idempotent).
//
// TRIGGERS:
//   1. Clock-out   — called immediately after timeOut is recorded
//   2. Admin edit  — called after any correction to timeIn / timeOut / breaks
//   3. Backfill    — called from scripts/backfill-timelog-compute.js for historical records
//   4. Cutoff recompute — called per-record before a cutoff period is locked
//
// SHIFT CATALOG DEPENDENCY:
//   Segment hours and rawOtMinutes for Driver/Aide employees rely on shift
//   boundaries resolved from the company's Shift catalog. Assigned employees
//   (those with the relevant UserShifts for the day) resolve boundaries directly
//   from their UserShifts. Unassigned employees (e.g. Regular-only employee who
//   covered a Driver PM slot) fall back to a catalog lookup by exact shift name.
//
//   The canonical shift names this service depends on are:
//     "Regular Shift"
//     "Driver/Aide AM Shift"
//     "Driver/Aide PM Shift"
//
//   If any of these names are changed or deleted in the admin shift catalog,
//   the affected segment hours will be null and a warning will be written to
//   the server log. The assigned driver path is unaffected by catalog renames.

const moment = require("moment-timezone");
const { prisma } = require("@config/connection");

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Extracts the stored clock-time string (HH:mm:ss) from a Prisma @db.Time value.
 * Prisma returns db.Time columns as a Date anchored to 1970-01-01T00:00:00Z,
 * so getUTCHours/Minutes/Seconds gives the raw stored clock time.
 */
function timeStrFromDbTime(timeLikeDate) {
  const t = new Date(timeLikeDate);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Resolves the best valid IANA timezone string from the candidates provided.
 * Always falls back to "America/Los_Angeles" (PDT) — never the server timezone.
 */
function resolveTimezone(companyTz) {
  if (companyTz && moment.tz.zone(companyTz)) return companyTz;
  return "America/Los_Angeles";
}

/**
 * Combines a reference date (for the calendar date) with a @db.Time value,
 * interpreted in the given IANA timezone. Returns a UTC Date.
 */
function combineDateWithTimeTz(referenceDate, timeLikeDate, tz) {
  const dateOnly = moment(referenceDate).tz(tz).format("YYYY-MM-DD");
  const timeStr  = timeStrFromDbTime(timeLikeDate);
  return moment.tz(`${dateOnly} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz).toDate();
}

// ── Break helpers ─────────────────────────────────────────────────────────────

/**
 * Sums all completed coffee break durations in minutes.
 * A break is only counted if it has both a start and end timestamp.
 * Open (unfinished) breaks are excluded.
 */
function sumCoffeeBreakMinutes(coffeeBreaks) {
  if (!Array.isArray(coffeeBreaks) || coffeeBreaks.length === 0) return 0;
  return coffeeBreaks.reduce((total, b) => {
    if (!b.start || !b.end) return total;
    const diffMs = new Date(b.end) - new Date(b.start);
    if (diffMs <= 0) return total;
    return total + diffMs / 60000;
  }, 0);
}

/**
 * Returns the lunch break duration in minutes, or 0 if no completed lunch break.
 */
function lunchBreakMinutes(lunchBreak) {
  if (!lunchBreak?.start || !lunchBreak?.end) return 0;
  const diffMs = new Date(lunchBreak.end) - new Date(lunchBreak.start);
  return diffMs > 0 ? diffMs / 60000 : 0;
}

// ── Segment helper ────────────────────────────────────────────────────────────

/**
 * Computes hours worked within a single shift segment window.
 * Clamps timeIn/timeOut to the segment boundary and returns hours (2dp).
 * Returns null if the segment boundary itself is null (missing shift data).
 */
function computeSegmentHours(timeIn, timeOut, segStart, segEnd) {
  if (!segStart || !segEnd) return null;
  const start = Math.max(timeIn.getTime(),  segStart.getTime());
  const end   = Math.min(timeOut.getTime(), segEnd.getTime());
  return +(Math.max(0, end - start) / 3600000).toFixed(2);
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Computes all derived fields for a completed TimeLog record and writes them
 * back to the database.
 *
 * @param {string} timeLogId  - The TimeLog.id to compute
 * @returns {object}          - The derived fields that were written, or null if skipped
 *
 * SKIPS computation if:
 *   - timeOut is null (log is still active / employee still clocked in)
 *
 * netWorkedHours semantics by punch type:
 *   REGULAR        → gross (timeOut − timeIn) minus all break deductions
 *   DRIVER_AIDE_*  → sum of computed segment hours (schedule-bounded, OT excluded)
 *
 * rawOtMinutes semantics by punch type:
 *   REGULAR        → minutes past assigned shift end (grace-adjusted).
 *                    Falls back to timeIn + defaultShiftHours when no shift is assigned.
 *   DRIVER_AIDE_*  → minutes past Driver PM shift end (2:45 PM), grace-adjusted.
 *
 * FALLBACK behavior (no shift assigned for the day):
 *   - shiftStart / shiftEnd are treated as null (or catalog-resolved for DA types)
 *   - lateHours = null (cannot determine lateness without a shift)
 *   - undertimeHours = 0
 *   - netWorkedHours computed from raw punch times and breaks (Regular only)
 *   - rawOtMinutes for REGULAR computed against timeIn + defaultShiftHours
 *   - Segment hours / rawOtMinutes = null for DA if catalog shifts are also missing
 */
async function computeTimeLogSummary(timeLogId) {
  // ── 1. Fetch the TimeLog ────────────────────────────────────────────────────
  const log = await prisma.timeLog.findUnique({
    where: { id: timeLogId },
    include: {
      user: {
        select: { companyId: true },
      },
    },
  });

  if (!log) {
    console.warn(`[computeTimeLogSummary] TimeLog ${timeLogId} not found.`);
    return null;
  }

  if (!log.timeOut) return null;

  const timeIn  = new Date(log.timeIn);
  const timeOut = new Date(log.timeOut);

  // Punch type flags — used throughout
  const isDriverAm  = log.punchType === "DRIVER_AIDE_AM"  || log.punchType === "DRIVER_AIDE";
  const isDriverPm  = log.punchType === "DRIVER_AIDE_PM"  || log.punchType === "DRIVER_AIDE";
  const isDriverLog = isDriverAm || isDriverPm;

  // ── 2. Fetch company settings ───────────────────────────────────────────────
  const company = await prisma.company.findUnique({
    where: { id: log.user.companyId },
    select: {
      timeZone:            true,
      gracePeriodMinutes:  true,
      minimumLunchMinutes: true,
      defaultShiftHours:   true,
    },
  });

  const tz                 = resolveTimezone(company?.timeZone);
  const gracePeriodMinutes = company?.gracePeriodMinutes  ?? 15;
  const minimumLunchMins   = company?.minimumLunchMinutes ?? 60;
  const defaultShiftHours  = parseFloat(company?.defaultShiftHours ?? 8);
  const graceMs            = gracePeriodMinutes * 60 * 1000;

  // ── 3. Fetch ALL UserShifts for the clock-in date ───────────────────────────
  // Driver employees have three shifts per day (AM, Regular, PM). Fetching all
  // ensures we use the correct boundaries:
  //   - Earliest startTime → shiftStart (for lateHours)
  //   - Latest endTime     → shiftEnd   (for undertimeHours)
  const dayStart = moment(timeIn).tz(tz).startOf("day").toDate();
  const dayEnd   = moment(timeIn).tz(tz).endOf("day").toDate();

  const userShifts = await prisma.userShift.findMany({
    where: {
      userId:       log.userId,
      assignedDate: { gte: dayStart, lte: dayEnd },
      status:       { not: "cancelled" },
    },
    include: { shift: true },
    orderBy: { shift: { startTime: "asc" } },
  });

  // ── 4. Pre-fetch catalog shifts for any missing DA segment boundaries ────────
  // For Driver/Aide punch types, segment hours require boundaries for all active
  // segments (AM, Regular, PM). If the employee is unassigned for a segment (e.g.
  // Regular-only employee covering Driver PM), the boundary is resolved from the
  // company's Shift catalog by canonical name.
  //
  // This also ensures shiftEnd is correct for undertimeHours computation —
  // an unassigned DA_PM employee's effective day end is the Driver PM catalog end,
  // not the Regular shift end.

  const assignedShiftNames = new Set(
    userShifts.map((us) => us.shift?.shiftName).filter(Boolean)
  );

  const catalogShiftMap = {}; // { shiftName: { startTime, endTime } }

  if (isDriverLog) {
    const neededNames = [];
    if (!assignedShiftNames.has("Regular Shift"))
      neededNames.push("Regular Shift");
    if (isDriverAm && !assignedShiftNames.has("Driver/Aide AM Shift"))
      neededNames.push("Driver/Aide AM Shift");
    if (isDriverPm && !assignedShiftNames.has("Driver/Aide PM Shift"))
      neededNames.push("Driver/Aide PM Shift");

    if (neededNames.length > 0) {
      const catalogShifts = await prisma.shift.findMany({
        where: {
          companyId: log.user.companyId,
          shiftName: { in: neededNames },
        },
        select: { shiftName: true, startTime: true, endTime: true },
      });
      for (const s of catalogShifts) {
        catalogShiftMap[s.shiftName] = s;
      }

      const missing = neededNames.filter((n) => !catalogShiftMap[n]);
      if (missing.length > 0) {
        console.warn(
          `[computeTimeLogSummary] Catalog shifts not found for companyId=${log.user.companyId}: ` +
          `${missing.join(", ")}. Some segment hours will be null for ${timeLogId}.`
        );
      }
    }
  }

  // ── 5. Resolve overall shift boundaries (shiftStart / shiftEnd) ─────────────
  // shiftStart → earliest startTime (Driver AM when present, else Regular)
  // shiftEnd   → latest endTime (Driver PM when present, else Regular)
  //
  // For unassigned DA employees, extend shiftEnd to the catalog Driver PM end
  // so undertimeHours is computed against the correct effective day boundary.

  let shiftStart = null;
  let shiftEnd   = null;

  if (userShifts.length > 0) {
    // Earliest startTime — sorted by startTime asc, so first record
    const firstShift = userShifts[0];
    if (firstShift.shift?.startTime) {
      shiftStart = combineDateWithTimeTz(timeIn, firstShift.shift.startTime, tz);
    }

    // Latest endTime — compare resolved UTC dates across all shifts
    let latestEndDate = null;
    for (const us of userShifts) {
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

  // Extend shiftEnd for unassigned DA_PM employees using catalog Driver PM end
  if (
    isDriverPm &&
    !assignedShiftNames.has("Driver/Aide PM Shift") &&
    catalogShiftMap["Driver/Aide PM Shift"]?.endTime
  ) {
    const catalogPmEnd = combineDateWithTimeTz(
      timeIn,
      catalogShiftMap["Driver/Aide PM Shift"].endTime,
      tz
    );
    if (!shiftEnd || catalogPmEnd > shiftEnd) {
      shiftEnd = catalogPmEnd;
    }
  }

  // No shift at all — fall back to timeIn + defaultShiftHours
  if (!shiftEnd) {
    shiftEnd = new Date(timeIn.getTime() + defaultShiftHours * 60 * 60 * 1000);
  }

  // ── 6. Compute break totals ─────────────────────────────────────────────────
  const coffeeBreakMins = sumCoffeeBreakMinutes(log.coffeeBreaks);
  const lunchMins       = lunchBreakMinutes(log.lunchBreak);

  let lunchDeductionMins;
  if (log.autoLunchDeductionMinutes != null) {
    lunchDeductionMins = log.autoLunchDeductionMinutes;
  } else if (lunchMins > 0) {
    lunchDeductionMins = Math.max(lunchMins, minimumLunchMins);
  } else {
    lunchDeductionMins = minimumLunchMins;
  }

  const totalBreakMins = Math.round(coffeeBreakMins + lunchDeductionMins);

  // ── 7. Compute lateHours ────────────────────────────────────────────────────
  let lateHours = null;

  if (shiftStart) {
    const lateMs = timeIn - shiftStart - graceMs;
    lateHours    = lateMs > 0 ? +(lateMs / 3600000).toFixed(2) : 0;
  }

  // ── 8. Compute undertimeHours ───────────────────────────────────────────────
  const undertimeMs    = shiftEnd - timeOut - graceMs;
  const undertimeHours = undertimeMs > 0 ? +(undertimeMs / 3600000).toFixed(2) : 0;

  // ── 9. Compute netWorkedHours and segment hours ─────────────────────────────
  //
  // REGULAR punch type:
  //   netWorkedHours = gross (timeOut − timeIn) minus all break deductions.
  //   No segment fields — all remain null.
  //
  // DRIVER_AIDE_* punch types:
  //   Segment hours are computed per shift window (AM / Regular / PM).
  //   Each segment clamps timeIn/timeOut to the window boundaries so that:
  //     - Pre-schedule time (e.g. 7:31 AM before 8:00 AM Regular start) is excluded
  //     - Early departure is captured correctly per segment
  //   netWorkedHours = sum of segment hours (OT excluded — OT requires approval)
  //   rawOtMinutes   = minutes past Driver PM end, grace-adjusted

  let netWorkedHours       = null;
  let regularSegmentHours  = null;
  let driverAmSegmentHours = null;
  let driverPmSegmentHours = null;
  let rawOtMinutes         = null;

  if (!isDriverLog) {
    // ── Regular path ──────────────────────────────────────────────────────────
    const grossMs     = timeOut - timeIn;
    const deductionMs = totalBreakMins * 60 * 1000;
    netWorkedHours    = +(Math.max(0, grossMs - deductionMs) / 3600000).toFixed(2);

    // rawOtMinutes = minutes past shift end, grace-adjusted.
    // shiftEnd is always resolved — either from the assigned shift's latest endTime,
    // or the fallback (timeIn + defaultShiftHours) for employees with no assigned shift.
    const otMs = timeOut.getTime() - shiftEnd.getTime() - graceMs;
    rawOtMinutes = otMs > 0 ? Math.round(otMs / 60000) : 0;

  } else {
    // ── Driver/Aide path ──────────────────────────────────────────────────────

    // Resolve boundary for a given segment — prefers assigned UserShift, falls
    // back to catalog entry.
    const resolveSegmentBoundary = (assignedName) => {
      const assigned = userShifts.find((us) => us.shift?.shiftName === assignedName);
      const source   = assigned?.shift ?? catalogShiftMap[assignedName] ?? null;
      if (!source?.startTime || !source?.endTime) return null;
      return {
        start: combineDateWithTimeTz(timeIn, source.startTime, tz),
        end:   combineDateWithTimeTz(timeIn, source.endTime,   tz),
      };
    };

    const regularSeg  = resolveSegmentBoundary("Regular Shift");
    const driverAmSeg = isDriverAm ? resolveSegmentBoundary("Driver/Aide AM Shift") : null;
    const driverPmSeg = isDriverPm ? resolveSegmentBoundary("Driver/Aide PM Shift") : null;

    regularSegmentHours  = computeSegmentHours(timeIn, timeOut, regularSeg?.start,  regularSeg?.end);
    driverAmSegmentHours = computeSegmentHours(timeIn, timeOut, driverAmSeg?.start, driverAmSeg?.end);
    driverPmSegmentHours = computeSegmentHours(timeIn, timeOut, driverPmSeg?.start, driverPmSeg?.end);

    // netWorkedHours = sum of all resolved segments (pre-schedule time excluded)
    const segTotal = [regularSegmentHours, driverAmSegmentHours, driverPmSegmentHours]
      .filter((h) => h !== null)
      .reduce((sum, h) => sum + h, 0);
    netWorkedHours = +segTotal.toFixed(2);

    // rawOtMinutes = minutes past Driver PM shift end, grace-adjusted
    if (driverPmSeg) {
      const otMs = timeOut.getTime() - driverPmSeg.end.getTime() - graceMs;
      rawOtMinutes = otMs > 0 ? Math.round(otMs / 60000) : 0;
    }
  }

  // ── 10. Write back to TimeLog ───────────────────────────────────────────────
  const derivedFields = {
    lateHours:             lateHours            !== null ? lateHours            : undefined,
    undertimeHours,
    netWorkedHours,
    lunchDeductionMinutes: Math.round(lunchDeductionMins),
    totalBreakMinutes:     Math.round(coffeeBreakMins),  // coffee only — lunch is separate
    regularSegmentHours:   regularSegmentHours  !== null ? regularSegmentHours  : undefined,
    driverAmSegmentHours:  driverAmSegmentHours !== null ? driverAmSegmentHours : undefined,
    driverPmSegmentHours:  driverPmSegmentHours !== null ? driverPmSegmentHours : undefined,
    rawOtMinutes:          rawOtMinutes         !== null ? rawOtMinutes         : undefined,
    calculatedAt:          new Date(),
  };

  await prisma.timeLog.update({
    where: { id: timeLogId },
    data:  derivedFields,
  });

  console.log(
    `[computeTimeLogSummary] ✓ ${timeLogId}` +
    ` | punchType=${log.punchType}` +
    ` | lateHours=${lateHours ?? "n/a"}` +
    ` | undertime=${undertimeHours}h` +
    ` | net=${netWorkedHours}h` +
    ` | lunch=${Math.round(lunchDeductionMins)}min` +
    ` | rawOtMins=${rawOtMinutes ?? "n/a"}` +
    (isDriverLog
      ? ` | segs=[AM:${driverAmSegmentHours ?? "-"} REG:${regularSegmentHours ?? "-"} PM:${driverPmSegmentHours ?? "-"}]`
      : "") +
    ` | tz=${tz}`
  );

  return derivedFields;
}

module.exports = { computeTimeLogSummary };
