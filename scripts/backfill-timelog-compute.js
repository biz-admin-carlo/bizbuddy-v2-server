// scripts/backfill-timelog-compute.js
//
// Computes all derived fields for completed TimeLog records.
//
// SAFE TO RE-RUN — incremental mode skips records where calculatedAt IS NOT NULL
// unless --force is passed.
//
// Usage:
//   node scripts/backfill-timelog-compute.js                          # incremental, all records
//   node scripts/backfill-timelog-compute.js --force                  # recompute everything
//   node scripts/backfill-timelog-compute.js --companyId=<id>         # scope to one company
//   node scripts/backfill-timelog-compute.js --from=2026-04-07        # scope by date (timeIn >=)
//   node scripts/backfill-timelog-compute.js --to=2026-04-12          # scope by date (timeIn <=)
//   node scripts/backfill-timelog-compute.js --companyId=<id> --from=2026-04-07 --force
//
// Errors per-record are logged and skipped — the script never aborts mid-run.

require("module-alias/register");

const { prisma } = require("@config/connection");
const { computeTimeLogSummary } = require("@services/timeLogComputeService");

const BATCH_SIZE = 100;

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const FORCE     = args.includes("--force");
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;
const fromDate  = (args.find((a) => a.startsWith("--from="))      ?? "").split("=")[1] || null;
const toDate    = (args.find((a) => a.startsWith("--to="))        ?? "").split("=")[1] || null;

async function run() {
  console.log("──────────────────────────────────────────────────");
  console.log(" TimeLog Backfill — computeTimeLogSummary");
  console.log(`  Mode      : ${FORCE ? "FORCE (recompute all)" : "INCREMENTAL (skip already-computed)"}`);
  console.log(`  Company   : ${companyId ?? "all"}`);
  console.log(`  From      : ${fromDate  ?? "—"}`);
  console.log(`  To        : ${toDate    ?? "—"}`);
  console.log(`  Batch     : ${BATCH_SIZE} records at a time`);
  console.log("──────────────────────────────────────────────────\n");

  // ── Build where clause ────────────────────────────────────────────────────
  const where = {
    status:  false,
    timeOut: { not: null },
    ...(FORCE ? {} : { calculatedAt: null }),
  };

  // Always exclude orphaned users (null companyId) — they'd loop forever in incremental mode
  where.user = companyId ? { companyId } : { companyId: { not: null } };

  if (fromDate || toDate) {
    where.timeIn = {};
    if (fromDate) where.timeIn.gte = new Date(`${fromDate}T00:00:00.000Z`);
    if (toDate)   where.timeIn.lte = new Date(`${toDate}T23:59:59.999Z`);
  }

  // ── Count total ───────────────────────────────────────────────────────────
  const total = await prisma.timeLog.count({ where });

  if (total === 0) {
    console.log("✅ Nothing to process — no matching records found.");
    await prisma.$disconnect();
    return;
  }

  console.log(`📋 Found ${total} record(s) to process.\n`);

  const startedAt = Date.now();
  const elapsed   = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  let processed = 0;
  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;
  let offset    = 0;

  while (true) {
    const batch = await prisma.timeLog.findMany({
      where,
      select:  { id: true },
      orderBy: { timeIn: "asc" },
      take:    BATCH_SIZE,
      skip:    FORCE ? offset : 0,
    });

    if (batch.length === 0) break;

    for (const { id } of batch) {
      try {
        const result = await computeTimeLogSummary(id);
        if (result) {
          succeeded++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ Failed: ${id} — ${err.message}`);
        failed++;
      }
      processed++;
    }

    if (FORCE) offset += batch.length;

    const pct = Math.round((processed / total) * 100);
    console.log(`  [${elapsed()}] Progress: ${processed}/${total} (${pct}%) — ✓ ${succeeded}  ✗ ${failed}  ~ ${skipped}`);
  }

  console.log("\n──────────────────────────────────────────────────");
  console.log(` Backfill complete. (${elapsed()} total)`);
  console.log(`   Total processed : ${processed}`);
  console.log(`   Succeeded       : ${succeeded}`);
  console.log(`   Failed          : ${failed}`);
  console.log(`   Skipped         : ${skipped}`);
  console.log("──────────────────────────────────────────────────");

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
