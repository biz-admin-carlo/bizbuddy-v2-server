// src/services/cutoff/cutoffOtService.js
//
// Computes and persists CutoffOtBlock records for B&C companies.
//
// Logic (daily OT basis):
//   Sum netWorkedHours of all *approved* TimeLogApproval records for a given
//   employee on a given calendar day within the cutoff. If the total exceeds
//   dailyOtThresholdHours, upsert a CutoffOtBlock with otHours = excess.
//   If the total drops to/below the threshold (e.g. after an edit), delete
//   the block so it disappears from the review page.
//
// Upsert resets status to "pending" whenever otHours changes — the admin must
// re-approve after any punch edit that alters the OT amount.
//
// Only "daily" otBasis is implemented. Weekly/cutoff are no-ops for now.

const { prisma } = require("@config/connection");
const moment     = require("moment-timezone");

/**
 * Recompute the OT block for one employee on one calendar day.
 *
 * @param {string} cutoffPeriodId
 * @param {string} userId
 * @param {string} dateStr   — "YYYY-MM-DD" in the company timezone
 * @param {string} companyId
 */
async function computeOtForEmployeeDay(cutoffPeriodId, userId, dateStr, companyId) {
  const company = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { otBasis: true, dailyOtThresholdHours: true, timeZone: true },
  });

  // Only daily OT is implemented — skip other bases silently.
  if (!company || company.otBasis !== "daily") return;

  const threshold = parseFloat(company.dailyOtThresholdHours ?? 8);
  const tz        = company.timeZone || "America/Los_Angeles";

  // Build the UTC window that covers the company-timezone calendar day.
  const dayStart = moment.tz(dateStr, tz).startOf("day").toDate();
  const dayEnd   = moment.tz(dateStr, tz).endOf("day").toDate();

  // Sum approved hours for this user on this day.
  // Uses actualHours from the TimeLogApproval — set explicitly at approval time and
  // authoritative for payroll. Falls back to computing from approved timestamps if
  // actualHours is null (legacy records approved before bncCutoffStrategy), then to
  // netWorkedHours as a last resort.
  const approved = await prisma.timeLogApproval.findMany({
    where: {
      cutoffPeriodId,
      status:  "approved",
      timeLog: {
        userId,
        timeIn: { gte: dayStart, lte: dayEnd },
      },
    },
    select: {
      actualHours:      true,
      approvedClockIn:  true,
      approvedClockOut: true,
      timeLog: { select: { netWorkedHours: true } },
    },
  });

  const totalHours = approved.reduce((sum, a) => {
    if (a.actualHours != null) {
      return sum + parseFloat(a.actualHours.toString());
    }
    if (a.approvedClockIn && a.approvedClockOut) {
      return sum + (new Date(a.approvedClockOut) - new Date(a.approvedClockIn)) / 3600000;
    }
    return sum + parseFloat(a.timeLog?.netWorkedHours?.toString() ?? 0);
  }, 0);

  const otHours = parseFloat(Math.max(0, totalHours - threshold).toFixed(2));
  const date    = new Date(dateStr);

  if (otHours > 0) {
    const existing = await prisma.cutoffOtBlock.findUnique({
      where: { cutoffPeriodId_userId_date: { cutoffPeriodId, userId, date } },
      select: { otHours: true, status: true },
    });

    const currentOt = existing ? parseFloat(existing.otHours.toString()) : null;
    const hoursChanged = currentOt === null || Math.abs(currentOt - otHours) >= 0.01;

    await prisma.cutoffOtBlock.upsert({
      where:  { cutoffPeriodId_userId_date: { cutoffPeriodId, userId, date } },
      create: { cutoffPeriodId, userId, date, otHours, status: "pending" },
      // Reset to pending when the OT amount changes — admin must re-review.
      update: hoursChanged ? { otHours, status: "pending" } : { otHours },
    });

    console.log(`[OT] Upserted block — ${userId} on ${dateStr}: ${otHours}h OT`);
  } else {
    const deleted = await prisma.cutoffOtBlock.deleteMany({
      where: { cutoffPeriodId, userId, date },
    });
    if (deleted.count > 0) {
      console.log(`[OT] Removed block — ${userId} on ${dateStr}: total hours now ≤ threshold`);
    }
  }
}

/**
 * Called after a single punch approval or edit.
 * Derives the employee and calendar date from the TimeLog, then recomputes.
 *
 * @param {string} timeLogId
 * @param {string} cutoffPeriodId
 * @param {string} companyId
 */
async function recomputeOtForTimeLog(timeLogId, cutoffPeriodId, companyId) {
  const company = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { otBasis: true, timeZone: true },
  });
  if (!company || company.otBasis !== "daily") return;

  const timeLog = await prisma.timeLog.findUnique({
    where:  { id: timeLogId },
    select: { userId: true, timeIn: true },
  });
  if (!timeLog) return;

  const tz      = company.timeZone || "America/Los_Angeles";
  const dateStr = moment.tz(timeLog.timeIn, tz).format("YYYY-MM-DD");

  await computeOtForEmployeeDay(cutoffPeriodId, timeLog.userId, dateStr, companyId);
}

/**
 * Called after bulk approval or sync — recomputes OT for every distinct
 * employee-day that has at least one approved punch in this cutoff.
 *
 * @param {string} cutoffPeriodId
 * @param {string} companyId
 */
async function recomputeAllOtForCutoff(cutoffPeriodId, companyId) {
  const company = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { otBasis: true, timeZone: true },
  });
  if (!company || company.otBasis !== "daily") return;

  const tz = company.timeZone || "America/Los_Angeles";

  const approved = await prisma.timeLogApproval.findMany({
    where:   { cutoffPeriodId, status: "approved" },
    include: { timeLog: { select: { userId: true, timeIn: true } } },
  });

  // Deduplicate to unique userId + dateStr pairs.
  const seen = new Set();
  const pairs = [];
  for (const a of approved) {
    if (!a.timeLog) continue;
    const dateStr = moment.tz(a.timeLog.timeIn, tz).format("YYYY-MM-DD");
    const key = `${a.timeLog.userId}:${dateStr}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ userId: a.timeLog.userId, dateStr });
    }
  }

  for (const { userId, dateStr } of pairs) {
    try {
      await computeOtForEmployeeDay(cutoffPeriodId, userId, dateStr, companyId);
    } catch (err) {
      console.error(`[OT] recomputeAllOtForCutoff failed for ${userId} on ${dateStr}:`, err.message);
    }
  }
}

module.exports = { recomputeOtForTimeLog, recomputeAllOtForCutoff };
