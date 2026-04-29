// src/services/autoBreakService.js
const { prisma } = require("@config/connection");
const { resolveShiftForTimeLog } = require("@services/timeLogComputeService");

const AUTO_BREAK_FIELDS = {
  autoLunchEntitled: true,
  autoBreakLunchMinutes: true,
  autoBreakLunchAfterHours: true,
  autoBreakLunchDeductible: true,
  autoCoffeeEntitled: true,
  autoBreakCoffeeMinutes: true,
  autoBreakCoffeeCount: true,
  autoBreakCoffeeDeductible: true,
};

/**
 * Resolves full auto-break config for the employee from their department or shift,
 * based on the company's autoBreakBasis.
 */
async function resolveBreakConfig(userId, timeIn, timeOut, company) {
  const empty = {
    autoLunchEntitled: false,
    autoBreakLunchMinutes: null,
    autoBreakLunchAfterHours: null,
    autoBreakLunchDeductible: false,
    autoCoffeeEntitled: false,
    autoBreakCoffeeMinutes: null,
    autoBreakCoffeeCount: null,
    autoBreakCoffeeDeductible: false,
  };

  if (!company.autoBreakBasis) return empty;

  if (company.autoBreakBasis === "department") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { department: { select: AUTO_BREAK_FIELDS } },
    });
    return user?.department ?? empty;
  }

  if (company.autoBreakBasis === "shift") {
    const userShift = await resolveShiftForTimeLog(userId, timeIn, timeOut, company.timeZone);
    return userShift?.shift ?? empty;
  }

  return empty;
}

/**
 * Called after clock-out is persisted. Injects lunch and/or coffee break records
 * into the TimeLog when the employee did not take them manually.
 * Duration, timing, and deductibility are all read from the dept/shift config.
 * Returns the injected fields, or null if nothing was applied.
 */
async function applyAutoBreaks(timeLogId, userId) {
  const timeLog = await prisma.timeLog.findUnique({
    where: { id: timeLogId },
    select: {
      timeIn: true,
      timeOut: true,
      lunchBreak: true,
      coffeeBreaks: true,
      autoLunchApplied: true,
      autoCoffeeApplied: true,
    },
  });

  if (!timeLog?.timeOut) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true },
  });

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: {
      autoBreakBasis: true,
      autoLunchEnabled: true,
      autoCoffeeEnabled: true,
      timeZone: true,
    },
  });

  if (!company.autoBreakBasis) return null;

  const timeIn  = new Date(timeLog.timeIn);
  const timeOut = new Date(timeLog.timeOut);
  const config  = await resolveBreakConfig(userId, timeIn, timeOut, company);
  const updates = {};

  // ── Auto-lunch ──────────────────────────────────────────────────────────────
  if (company.autoLunchEnabled && config.autoLunchEntitled && !timeLog.autoLunchApplied) {
    const hasManualLunch =
      timeLog.lunchBreak != null &&
      typeof timeLog.lunchBreak === "object" &&
      timeLog.lunchBreak.start;

    if (!hasManualLunch) {
      const afterMs = (config.autoBreakLunchAfterHours ?? 4) * 60 * 60 * 1000;
      const durationMins = config.autoBreakLunchMinutes ?? 60;
      const lunchStart = new Date(timeIn.getTime() + afterMs);
      const lunchEnd = new Date(lunchStart.getTime() + durationMins * 60 * 1000);

      updates.lunchBreak = {
        start: lunchStart.toISOString(),
        end: lunchEnd.toISOString(),
        auto: true,
        deductible: config.autoBreakLunchDeductible,
      };
      updates.autoLunchApplied = true;

      if (config.autoBreakLunchDeductible) {
        updates.autoLunchDeductionMinutes = durationMins;
      }
    }
  }

  // ── Auto-coffee ─────────────────────────────────────────────────────────────
  if (company.autoCoffeeEnabled && config.autoCoffeeEntitled && !timeLog.autoCoffeeApplied) {
    const existingCoffees = Array.isArray(timeLog.coffeeBreaks) ? timeLog.coffeeBreaks : [];

    if (existingCoffees.length === 0) {
      const count = Math.max(1, config.autoBreakCoffeeCount ?? 1);
      const durationMs = (config.autoBreakCoffeeMinutes ?? 15) * 60 * 1000;
      const totalMs = timeOut.getTime() - timeIn.getTime();
      const segmentMs = totalMs / (count + 1);

      const injected = [];
      for (let i = 1; i <= count; i++) {
        const coffeeStart = new Date(timeIn.getTime() + segmentMs * i);
        const coffeeEnd = new Date(coffeeStart.getTime() + durationMs);
        injected.push({
          start: coffeeStart.toISOString(),
          end: coffeeEnd.toISOString(),
          auto: true,
          deductible: config.autoBreakCoffeeDeductible,
        });
      }

      updates.coffeeBreaks = injected;
      updates.autoCoffeeApplied = true;
    }
  }

  if (Object.keys(updates).length === 0) return null;

  await prisma.timeLog.update({ where: { id: timeLogId }, data: updates });

  return updates;
}

module.exports = { applyAutoBreaks };
