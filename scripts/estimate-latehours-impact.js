// scripts/estimate-latehours-impact.js
//
// Estimates how many completed TimeLogs have likely-wrong lateHours due to
// the multi-shift wrong-shift-reference bug. Covers two root causes:
//
//   Cause A — UserShift multi-shift:
//     Employee had >1 UserShift on the punch day. Fix 5 + dual-anchor fix
//     address this. The old code used the earliest shiftStart across all shifts.
//
//   Cause B — Same-day multi-punch (ShiftSchedule or unassigned):
//     Employee has 2+ completed TimeLogs on the same calendar day. Each punch
//     resolves the same single ShiftSchedule entry, so non-first punches get
//     the wrong shiftStart. Confirmed by suspiciously high lateHours (> 1 hr)
//     on a non-first punch of the day.
//
// READ-ONLY — no records are modified.
//
// Usage:
//   node scripts/estimate-latehours-impact.js                    # all companies
//   node scripts/estimate-latehours-impact.js --companyId=<id>   # one company

require("module-alias/register");

const { prisma } = require("@config/connection");

const args      = process.argv.slice(2);
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;

async function run() {
  let companyLabel = "all companies";
  let tz           = "America/Los_Angeles";

  if (companyId) {
    const company = await prisma.company.findUnique({
      where:  { id: companyId },
      select: { name: true, timeZone: true },
    });
    tz           = company?.timeZone ?? tz;
    companyLabel = company?.name     ?? companyId;
  }

  const tzLiteral    = tz.replace(/'/g, "''");
  const companyFilter = companyId ? `AND u."companyId" = '${companyId}'` : "";

  console.log("────────────────────────────────────────────────────");
  console.log(" Late Hours Impact Estimate (read-only)");
  console.log(`  Company : ${companyLabel}`);
  console.log(`  TZ      : ${tz}`);
  console.log("────────────────────────────────────────────────────\n");

  // ── Total completed TimeLogs in scope ───────────────────────────────────────
  const total = await prisma.timeLog.count({
    where: {
      timeOut:  { not: null },
      lateHours: { not: null },
      ...(companyId ? { user: { companyId } } : {}),
    },
  });

  // ── Cause A: UserShift multi-shift ──────────────────────────────────────────
  // Employee had >1 UserShift on the punch day (non-cancelled).
  const [rowA] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT tl.id)::int AS affected
    FROM   "TimeLog" tl
    JOIN   "User"    u ON u.id = tl."userId"
    WHERE  tl."timeOut"   IS NOT NULL
      AND  tl."lateHours" IS NOT NULL
      ${companyFilter}
      AND (
        SELECT COUNT(*)
        FROM   "UserShift" us
        WHERE  us."userId"       = tl."userId"
          AND  us."assignedDate" >= (tl."timeIn" AT TIME ZONE '${tzLiteral}')::date::timestamp
          AND  us."assignedDate" <  ((tl."timeIn" AT TIME ZONE '${tzLiteral}')::date + interval '1 day')::timestamp
          AND  us.status         != 'cancelled'
      ) > 1
  `);

  // ── Cause B: Same-day multi-punch with high lateHours ───────────────────────
  // Employee has 2+ completed TimeLogs on the same local calendar day AND
  // lateHours > 1.0 (strong signal of wrong shift reference — genuine lateness
  // rarely exceeds 1 hr without disciplinary action).
  const [rowB] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT tl.id)::int AS affected
    FROM   "TimeLog" tl
    JOIN   "User"    u ON u.id = tl."userId"
    WHERE  tl."timeOut"   IS NOT NULL
      AND  tl."lateHours" > 1
      ${companyFilter}
      AND (
        SELECT COUNT(*)
        FROM   "TimeLog" tl2
        WHERE  tl2."userId"  = tl."userId"
          AND  tl2."timeOut" IS NOT NULL
          AND  tl2.id       != tl.id
          AND  (tl2."timeIn" AT TIME ZONE '${tzLiteral}')::date
             = (tl."timeIn"  AT TIME ZONE '${tzLiteral}')::date
      ) >= 1
  `);

  // ── Cause B (all): Same-day multi-punch regardless of lateHours ─────────────
  // Total non-first punches on multi-punch days — all need recompute even if
  // lateHours looks normal (undertimeHours may also be wrong).
  const [rowBAll] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT tl.id)::int AS affected
    FROM   "TimeLog" tl
    JOIN   "User"    u ON u.id = tl."userId"
    WHERE  tl."timeOut"   IS NOT NULL
      AND  tl."lateHours" IS NOT NULL
      ${companyFilter}
      AND (
        SELECT COUNT(*)
        FROM   "TimeLog" tl2
        WHERE  tl2."userId"  = tl."userId"
          AND  tl2."timeOut" IS NOT NULL
          AND  tl2.id       != tl.id
          AND  (tl2."timeIn" AT TIME ZONE '${tzLiteral}')::date
             = (tl."timeIn"  AT TIME ZONE '${tzLiteral}')::date
      ) >= 1
  `);

  // ── Per-company breakdown (all companies run only) ──────────────────────────
  let companyBreakdown = [];
  if (!companyId) {
    companyBreakdown = await prisma.$queryRawUnsafe(`
      SELECT
        c.name                                          AS company,
        c."timeZone"                                    AS tz,
        COUNT(DISTINCT tl.id)::int                      AS total_logs,
        SUM(CASE WHEN tl."lateHours" > 1 THEN 1 ELSE 0 END)::int AS high_late_count
      FROM   "TimeLog" tl
      JOIN   "User"    u ON u.id = tl."userId"
      JOIN   "Company" c ON c.id = u."companyId"
      WHERE  tl."timeOut"   IS NOT NULL
        AND  tl."lateHours" IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM   "TimeLog" tl2
          WHERE  tl2."userId"  = tl."userId"
            AND  tl2."timeOut" IS NOT NULL
            AND  tl2.id       != tl.id
            AND  (tl2."timeIn" AT TIME ZONE c."timeZone")::date
               = (tl."timeIn"  AT TIME ZONE c."timeZone")::date
        ) >= 1
      GROUP  BY c.id, c.name, c."timeZone"
      ORDER  BY high_late_count DESC
    `);
  }

  const causeA    = Number(rowA?.affected    ?? 0);
  const causeBHigh = Number(rowB?.affected   ?? 0);
  const causeBAll  = Number(rowBAll?.affected ?? 0);

  console.log("📊 Results");
  console.log(`   Total completed TimeLogs with lateHours  : ${total}`);
  console.log("");
  console.log("   Cause A — UserShift multi-shift day");
  console.log(`     Affected records                        : ${causeA}`);
  console.log("");
  console.log("   Cause B — Same-day multi-punch");
  console.log(`     Confirmed wrong (lateHours > 1 hr)      : ${causeBHigh}`);
  console.log(`     All same-day multi-punch (full recompute): ${causeBAll}`);
  console.log("");
  console.log(`   Conservative backfill target              : ${Math.max(causeA, causeBAll)}`);

  if (companyBreakdown.length > 0) {
    console.log("\n📋 Per-company breakdown (multi-punch days only)");
    console.log("   " + "Company".padEnd(30) + "TZ".padEnd(25) + "Total".padEnd(10) + "High Late");
    console.log("   " + "─".repeat(75));
    for (const row of companyBreakdown) {
      console.log(
        "   " +
        String(row.company).padEnd(30) +
        String(row.tz).padEnd(25) +
        String(row.total_logs).padEnd(10) +
        String(row.high_late_count)
      );
    }
  }

  if (causeBHigh > 0 || causeA > 0) {
    console.log("\n   To recompute:");
    console.log(`   node scripts/backfill-timelog-compute.js${companyId ? ` --companyId=${companyId}` : ""}`);
  }

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
