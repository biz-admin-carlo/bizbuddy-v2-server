// scripts/estimate-grace-period-fix.js
//
// READ-ONLY. Counts TimeLogs affected by the grace period +59s fix.
// Only logs where lateHours > 0, undertimeHours > 0, or rawOtMinutes > 0
// could have been impacted — all-zero records were already within grace.
//
// Usage:
//   node scripts/estimate-grace-period-fix.js                    # all companies
//   node scripts/estimate-grace-period-fix.js --companyId=<id>   # one company

require("module-alias/register");

const { prisma } = require("@config/connection");

const args      = process.argv.slice(2);
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;

async function run() {
  let companyLabel = "all companies";
  if (companyId) {
    const company = await prisma.company.findUnique({
      where:  { id: companyId },
      select: { name: true, gracePeriodMinutes: true },
    });
    companyLabel = company ? `${company.name} (grace: ${company.gracePeriodMinutes}min)` : companyId;
  }

  console.log("────────────────────────────────────────────────────────");
  console.log(" Grace Period +59s Fix — Impact Estimate (read-only)");
  console.log(`  Company : ${companyLabel}`);
  console.log("────────────────────────────────────────────────────────\n");

  const userFilter = companyId
    ? `AND u."companyId" = '${companyId}'`
    : `AND u."companyId" IS NOT NULL`;

  const [[{ total }], [{ affected }], byCompany] = await Promise.all([
    // All completed logs in scope
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total
      FROM   "TimeLog" tl
      JOIN   "User"    u ON u.id = tl."userId"
      WHERE  tl."timeOut" IS NOT NULL
        AND  tl.status = false
        ${userFilter}
    `),
    // Logs where grace period influenced at least one field
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS affected
      FROM   "TimeLog" tl
      JOIN   "User"    u ON u.id = tl."userId"
      WHERE  tl."timeOut" IS NOT NULL
        AND  tl.status = false
        AND (
          tl."lateHours"     > 0 OR
          tl."undertimeHours" > 0 OR
          tl."rawOtMinutes"  > 0
        )
        ${userFilter}
    `),
    // Breakdown by company (only for all-companies run)
    companyId ? [] : prisma.$queryRawUnsafe(`
      SELECT c.name, c."gracePeriodMinutes", COUNT(tl.id)::int AS affected
      FROM   "TimeLog" tl
      JOIN   "User"    u ON u.id  = tl."userId"
      JOIN   "Company" c ON c.id  = u."companyId"
      WHERE  tl."timeOut" IS NOT NULL
        AND  tl.status = false
        AND (
          tl."lateHours"      > 0 OR
          tl."undertimeHours" > 0 OR
          tl."rawOtMinutes"   > 0
        )
        AND u."companyId" IS NOT NULL
      GROUP  BY c.name, c."gracePeriodMinutes"
      ORDER  BY affected DESC
    `),
  ]);

  console.log("📊 Results");
  console.log(`   Total completed logs         : ${total}`);
  console.log(`   Will be recomputed (affected) : ${affected}`);
  console.log(`   Skipped (already all-zero)    : ${total - affected}\n`);

  if (byCompany.length > 0) {
    console.log("   Breakdown by company:");
    for (const row of byCompany) {
      console.log(`     ${String(row.name).padEnd(32)} grace=${String(row.gracePeriodminutes ?? row.gracePeriodMinutes).padStart(2)}min  affected=${row.affected}`);
    }
    console.log();
  }

  console.log("────────────────────────────────────────────────────────");
  console.log(" Run backfill with:");
  console.log(`   node scripts/backfill-grace-period-fix.js${companyId ? ` --companyId=${companyId}` : ""}`);
  console.log("────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
