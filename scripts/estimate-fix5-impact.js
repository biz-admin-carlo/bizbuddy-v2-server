// scripts/estimate-fix5-impact.js
//
// Estimates how many completed REGULAR TimeLogs have a multi-shift day
// and would be recomputed by Fix 5 (B&C multi-shift wrong shift reference).
//
// READ-ONLY — no records are modified.
//
// Usage:
//   node scripts/estimate-fix5-impact.js                    # all companies
//   node scripts/estimate-fix5-impact.js --companyId=<id>   # one company

require("module-alias/register");

const { prisma } = require("@config/connection");

const args      = process.argv.slice(2);
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;

async function run() {
  // Resolve company name + timezone for display
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

  console.log("────────────────────────────────────────────");
  console.log(" Fix 5 — Impact Estimate (read-only)");
  console.log(`  Company : ${companyLabel}`);
  console.log(`  TZ      : ${tz}`);
  console.log("────────────────────────────────────────────\n");

  // Total completed REGULAR TimeLogs in scope
  const totalWhere = {
    punchType: "REGULAR",
    timeOut:   { not: null },
    status:    false,
    ...(companyId ? { user: { companyId } } : {}),
  };
  const total = await prisma.timeLog.count({ where: totalWhere });

  // Count those where the employee had >1 UserShift on the punch day.
  // Uses AT TIME ZONE for accurate day boundary matching against assignedDate.
  const companyFilter = companyId
    ? `AND u."companyId" = '${companyId}'`
    : "";

  const tzLiteral = tz.replace(/'/g, "''"); // basic SQL-escape for the TZ string

  const [row] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT tl.id)::int AS affected
    FROM   "TimeLog"  tl
    JOIN   "User"     u  ON u.id = tl."userId"
    WHERE  tl."punchType" = 'REGULAR'
      AND  tl."timeOut"  IS NOT NULL
      AND  tl.status     = false
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

  const affected    = Number(row?.affected ?? 0);
  const notAffected = total - affected;

  console.log(`📊 Results`);
  console.log(`   Total REGULAR completed TimeLogs : ${total}`);
  console.log(`   Affected (multi-shift day)        : ${affected}`);
  console.log(`   Not affected                      : ${notAffected}`);

  if (affected > 0) {
    console.log(`\n   To recompute affected records:`);
    console.log(`   node scripts/backfill-timelog-compute.js --force${companyId ? ` --companyId=${companyId}` : ""}`);
  }

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
