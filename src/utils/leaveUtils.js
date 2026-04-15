// src/utils/leaveUtils.js
const { prisma } = require("@config/connection");
const moment     = require("moment-timezone");

/**
 * Calculates the number of deductible hours for a leave request.
 *
 * Deductible days are those that are:
 *   1. Within the startDate–endDate range (inclusive)
 *   2. Not a weekend (Saturday/Sunday)
 *   3. Not a company holiday (Holiday table, scoped to companyId)
 *   4. A working day for the employee — determined by:
 *        - If the employee has UserShift records in the range → only dates with
 *          at least one non-cancelled UserShift count
 *        - If no UserShifts exist in the range (SV/Manager/salaried staff) →
 *          all non-weekend, non-holiday dates count
 *
 * All date comparisons use the company's configured timezone (America/Los_Angeles
 * for California clients). Falls back to "America/Los_Angeles" if not set.
 *
 * @param {string} userId    - The employee requesting leave
 * @param {string} startISO  - Leave start date (ISO string or YYYY-MM-DD)
 * @param {string} endISO    - Leave end date (ISO string or YYYY-MM-DD)
 * @returns {number}         - Total deductible hours (2dp)
 */
async function calcRequestedHours(userId, startISO, endISO) {
  const user = await prisma.user.findUnique({
    where:   { id: userId },
    include: { company: true },
  });
  if (!user?.company) throw new Error("Company not found for user");

  const tz         = user.company.timeZone || "America/Los_Angeles";
  const shiftHours = Number(user.company.defaultShiftHours || 8);
  const companyId  = user.company.id;

  // Resolve start/end as calendar dates in the company timezone
  const startDate = moment.tz(startISO, tz).startOf("day");
  const endDate   = moment.tz(endISO,   tz).startOf("day");

  // ── 1. Fetch company holidays in the range ──────────────────────────────────
  const holidays = await prisma.holiday.findMany({
    where: {
      companyId,
      date: {
        gte: startDate.toDate(),
        lte: endDate.toDate(),
      },
    },
    select: { date: true },
  });

  // Build a Set of holiday date strings (YYYY-MM-DD) in company timezone
  const holidaySet = new Set(
    holidays.map((h) => moment(h.date).tz(tz).format("YYYY-MM-DD"))
  );

  // ── 2. Fetch UserShifts for this employee in the range ──────────────────────
  const userShifts = await prisma.userShift.findMany({
    where: {
      userId,
      assignedDate: {
        gte: startDate.toDate(),
        lte: endDate.clone().endOf("day").toDate(),
      },
      status: { not: "cancelled" },
    },
    select: { assignedDate: true },
  });

  // Build a Set of assigned shift date strings (YYYY-MM-DD) in company timezone
  const shiftDateSet = new Set(
    userShifts.map((us) => moment(us.assignedDate).tz(tz).format("YYYY-MM-DD"))
  );

  const hasShifts = shiftDateSet.size > 0;

  // ── 3. Walk each calendar day and count deductible days ────────────────────
  let deductibleDays = 0;
  const cursor = startDate.clone();

  while (cursor.isSameOrBefore(endDate, "day")) {
    const dateStr  = cursor.format("YYYY-MM-DD");
    const dayOfWeek = cursor.day(); // 0 = Sunday, 6 = Saturday

    const isWeekend  = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday  = holidaySet.has(dateStr);
    const hasShift   = shiftDateSet.has(dateStr);

    if (!isWeekend && !isHoliday) {
      if (hasShifts) {
        // Shift-assigned employee: only count days with an actual assigned shift
        if (hasShift) deductibleDays++;
      } else {
        // Salaried/unassigned employee: count all non-weekend, non-holiday weekdays
        deductibleDays++;
      }
    }

    cursor.add(1, "day");
  }

  return +(deductibleDays * shiftHours).toFixed(2);
}

function monthlyIncrement(policy, defaultShiftHours = 8) {
  const alloc  = Number(policy.annualAllocation);
  const perYear =
    policy.accrualUnit === "days" ? alloc * defaultShiftHours : alloc;
  return +(perYear / 12).toFixed(2);
}

module.exports = { calcRequestedHours, monthlyIncrement };
