// scripts/estimate-approval-segment-bounds.js
//
// READ-ONLY. Shows how many TimeLogApproval rows the backfill will touch.
//
// Usage:
//   node scripts/estimate-approval-segment-bounds.js                    # all companies
//   node scripts/estimate-approval-segment-bounds.js --companyId=<id>   # one company

require("module-alias/register");

const { prisma } = require("@config/connection");

const args      = process.argv.slice(2);
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;

async function run() {
  let companyLabel = "all companies";
  if (companyId) {
    const company = await prisma.company.findUnique({
      where:  { id: companyId },
      select: { name: true },
    });
    companyLabel = company?.name ?? companyId;
  }

  console.log("─────────────────────────────────────────────────────────────");
  console.log(" Estimate — backfill-approval-segment-bounds (read-only)");
  console.log(`  Company : ${companyLabel}`);
  console.log("─────────────────────────────────────────────────────────────\n");

  const userFilter = companyId
    ? `AND u."companyId" = '${companyId}'`
    : `AND u."companyId" IS NOT NULL`;

  // ── Total DRIVER_AIDE approval rows (segmentType not null) ──────────────────
  const [[{ total }], [{ needs_backfill }], [{ already_set }]] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total
      FROM   "TimeLogApproval" a
      JOIN   "TimeLog"         tl ON tl.id = a."timeLogId"
      JOIN   "User"            u  ON u.id  = tl."userId"
      WHERE  a."segmentType" IS NOT NULL
        AND  tl."punchType"  = 'DRIVER_AIDE'
        ${userFilter}
    `),
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS needs_backfill
      FROM   "TimeLogApproval" a
      JOIN   "TimeLog"         tl ON tl.id = a."timeLogId"
      JOIN   "User"            u  ON u.id  = tl."userId"
      WHERE  a."segmentType"  IS NOT NULL
        AND  a."segmentStart" IS NULL
        AND  tl."punchType"   = 'DRIVER_AIDE'
        ${userFilter}
    `),
    prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS already_set
      FROM   "TimeLogApproval" a
      JOIN   "TimeLog"         tl ON tl.id = a."timeLogId"
      JOIN   "User"            u  ON u.id  = tl."userId"
      WHERE  a."segmentType"  IS NOT NULL
        AND  a."segmentStart" IS NOT NULL
        AND  tl."punchType"   = 'DRIVER_AIDE'
        ${userFilter}
    `),
  ]);

  console.log("📊 Approval rows (DRIVER_AIDE segments only)");
  console.log(`   Total DA segment rows     : ${total}`);
  console.log(`   ✅ Already have boundaries : ${already_set}  (backfill will skip)`);
  console.log(`   ⚠️  Missing boundaries     : ${needs_backfill}  (backfill will update)\n`);

  // ── Breakdown by cutoff status ──────────────────────────────────────────────
  const byStatus = await prisma.$queryRawUnsafe(`
    SELECT cp.status, COUNT(a.id)::int AS cnt
    FROM   "TimeLogApproval" a
    JOIN   "TimeLog"         tl ON tl.id  = a."timeLogId"
    JOIN   "User"            u  ON u.id   = tl."userId"
    LEFT JOIN "CutoffPeriod" cp ON cp.id  = a."cutoffPeriodId"
    WHERE  a."segmentType"  IS NOT NULL
      AND  a."segmentStart" IS NULL
      AND  tl."punchType"   = 'DRIVER_AIDE'
      ${userFilter}
    GROUP  BY cp.status
    ORDER  BY cp.status
  `);

  if (byStatus.length > 0) {
    console.log("   Breakdown of missing rows by cutoff status:");
    for (const row of byStatus) {
      console.log(`     ${String(row.status ?? "no cutoff").padEnd(12)} : ${row.cnt}`);
    }
    console.log();
  }

  // ── Breakdown by company (only when all-companies run) ─────────────────────
  if (!companyId) {
    const byCompany = await prisma.$queryRawUnsafe(`
      SELECT c.name, COUNT(a.id)::int AS cnt
      FROM   "TimeLogApproval" a
      JOIN   "TimeLog"         tl ON tl.id = a."timeLogId"
      JOIN   "User"            u  ON u.id  = tl."userId"
      JOIN   "Company"         c  ON c.id  = u."companyId"
      WHERE  a."segmentType"  IS NOT NULL
        AND  a."segmentStart" IS NULL
        AND  tl."punchType"   = 'DRIVER_AIDE'
      GROUP  BY c.name
      ORDER  BY cnt DESC
    `);

    if (byCompany.length > 0) {
      console.log("   Breakdown by company:");
      for (const row of byCompany) {
        console.log(`     ${String(row.name).padEnd(30)} : ${row.cnt}`);
      }
      console.log();
    }
  }

  console.log("─────────────────────────────────────────────────────────────");
  console.log(" Run backfill with:");
  console.log(`   node scripts/backfill-approval-segment-bounds.js${companyId ? ` --companyId=${companyId}` : ""}`);
  console.log("─────────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
