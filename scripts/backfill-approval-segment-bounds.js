// scripts/backfill-approval-segment-bounds.js
//
// Populates segmentStart / segmentEnd on existing DRIVER_AIDE TimeLogApproval rows
// that were created before those fields existed.
//
// SAFE TO RE-RUN — skips rows where segmentStart IS NOT NULL unless --force is passed.
//
// Usage:
//   node scripts/backfill-approval-segment-bounds.js                         # incremental
//   node scripts/backfill-approval-segment-bounds.js --force                 # rewrite all
//   node scripts/backfill-approval-segment-bounds.js --companyId=<id>        # scope to company
//   node scripts/backfill-approval-segment-bounds.js --cutoffId=<id>         # scope to one cutoff

require("module-alias/register");

const { prisma }                    = require("@config/connection");
const { resolveDriverAideSegments } = require("@services/timeLogComputeService");

const BATCH_SIZE = 200;

const args       = process.argv.slice(2);
const FORCE      = args.includes("--force");
const companyId  = (args.find((a) => a.startsWith("--companyId="))  ?? "").split("=")[1] || null;
const cutoffId   = (args.find((a) => a.startsWith("--cutoffId="))   ?? "").split("=")[1] || null;

async function run() {
  console.log("──────────────────────────────────────────────────────────");
  console.log(" TimeLogApproval Backfill — segmentStart / segmentEnd");
  console.log(`  Mode     : ${FORCE ? "FORCE (rewrite all)" : "INCREMENTAL (skip already-set)"}`);
  console.log(`  Company  : ${companyId ?? "all"}`);
  console.log(`  Cutoff   : ${cutoffId  ?? "all"}`);
  console.log(`  Batch    : ${BATCH_SIZE} approvals at a time`);
  console.log("──────────────────────────────────────────────────────────\n");

  // ── Build where clause ──────────────────────────────────────────────────────
  const where = {
    segmentType: { not: null },           // only DRIVER_AIDE rows have a segmentType
    ...(FORCE ? {} : { segmentStart: null }),
    timeLog: {
      punchType: "DRIVER_AIDE",
      user: companyId ? { companyId } : { companyId: { not: null } },
    },
    ...(cutoffId ? { cutoffPeriodId: cutoffId } : {}),
  };

  const total = await prisma.timeLogApproval.count({ where });

  if (total === 0) {
    console.log("✅ Nothing to process — no matching approval rows found.");
    await prisma.$disconnect();
    return;
  }

  console.log(`📋 Found ${total} approval row(s) to process.\n`);

  const startedAt  = Date.now();
  const elapsed    = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  let processed = 0;
  let updated   = 0;
  let skipped   = 0;
  let failed    = 0;

  // Always fetch from skip=0. In incremental mode, updated rows drop out of the
  // `segmentStart: null` filter so the next fetch naturally advances. Using an
  // offset cursor here would over-skip as rows are removed from the result set.
  while (true) {
    const batch = await prisma.timeLogApproval.findMany({
      where,
      select: {
        id:          true,
        segmentType: true,
        timeLog: {
          select: { id: true, timeIn: true, userId: true, user: { select: { companyId: true } } },
        },
      },
      skip:    0,
      take:    BATCH_SIZE,
      orderBy: { createdAt: "asc" },
    });

    if (batch.length === 0) break;

    // Group approval rows by (companyId, timeLogId) so we call resolveDriverAideSegments
    // once per unique timeLog rather than once per approval row.
    const byCompany = {}; // { companyId: { timeLogId: [approval, ...] } }
    for (const approval of batch) {
      const cid = approval.timeLog.user?.companyId;
      const lid = approval.timeLog.id;
      if (!cid) { skipped++; continue; }
      if (!byCompany[cid]) byCompany[cid] = {};
      if (!byCompany[cid][lid]) byCompany[cid][lid] = [];
      byCompany[cid][lid].push(approval);
    }

    for (const [cid, logMap] of Object.entries(byCompany)) {
      // Build driverLogs input for the resolver
      const driverLogs = Object.entries(logMap).map(([lid, rows]) => ({
        id:     lid,
        timeIn: rows[0].timeLog.timeIn,
        userId: rows[0].timeLog.userId,
      }));

      let segBoundaries;
      try {
        segBoundaries = await resolveDriverAideSegments(driverLogs, cid);
      } catch (err) {
        console.error(`  ✗ resolveDriverAideSegments failed for companyId=${cid}: ${err.message}`);
        failed += Object.values(logMap).flat().length;
        continue;
      }

      for (const [lid, approvals] of Object.entries(logMap)) {
        const segs = segBoundaries[lid] ?? {};
        for (const approval of approvals) {
          const seg = segs[approval.segmentType] ?? null;
          if (!seg) {
            // Shift not configured — leave null, count as skipped
            skipped++;
            processed++;
            continue;
          }
          try {
            await prisma.timeLogApproval.update({
              where: { id: approval.id },
              data:  { segmentStart: seg.start, segmentEnd: seg.end },
            });
            updated++;
          } catch (err) {
            console.error(`  ✗ approval ${approval.id}: ${err.message}`);
            failed++;
          }
          processed++;
        }
      }
    }

    if (processed % (BATCH_SIZE * 5) === 0) {
      console.log(`  … ${processed}/${total} processed (${elapsed()})`);
    }
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(` Done in ${elapsed()}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}  (null shift config)`);
  console.log(`  Failed  : ${failed}`);
  console.log("──────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
