// scripts/backfill-grace-period-fix.js
//
// Recomputes TimeLogs affected by the grace period +59s fix.
// Only targets completed logs where lateHours > 0, undertimeHours > 0,
// or rawOtMinutes > 0 — all-zero records are skipped entirely.
//
// SAFE TO RE-RUN — recompute is idempotent.
//
// Usage:
//   node scripts/backfill-grace-period-fix.js                         # all companies
//   node scripts/backfill-grace-period-fix.js --companyId=<id>        # one company
//   node scripts/backfill-grace-period-fix.js --from=2026-01-01       # date range
//   node scripts/backfill-grace-period-fix.js --to=2026-04-30

require("module-alias/register");

const { prisma }               = require("@config/connection");
const { computeTimeLogSummary } = require("@services/timeLogComputeService");

const BATCH_SIZE = 100;

const args      = process.argv.slice(2);
const companyId = (args.find((a) => a.startsWith("--companyId=")) ?? "").split("=")[1] || null;
const fromDate  = (args.find((a) => a.startsWith("--from="))      ?? "").split("=")[1] || null;
const toDate    = (args.find((a) => a.startsWith("--to="))        ?? "").split("=")[1] || null;

async function run() {
  console.log("────────────────────────────────────────────────────────");
  console.log(" Grace Period +59s Fix — Backfill");
  console.log(`  Company : ${companyId ?? "all"}`);
  console.log(`  From    : ${fromDate  ?? "—"}`);
  console.log(`  To      : ${toDate    ?? "—"}`);
  console.log(`  Batch   : ${BATCH_SIZE} records at a time`);
  console.log("────────────────────────────────────────────────────────\n");

  const where = {
    timeOut: { not: null },
    status:  false,
    OR: [
      { lateHours:      { gt: 0 } },
      { undertimeHours: { gt: 0 } },
      { rawOtMinutes:   { gt: 0 } },
    ],
    user: companyId ? { companyId } : { companyId: { not: null } },
    ...(fromDate || toDate ? {
      timeIn: {
        ...(fromDate ? { gte: new Date(`${fromDate}T00:00:00.000Z`) } : {}),
        ...(toDate   ? { lte: new Date(`${toDate}T23:59:59.999Z`)   } : {}),
      },
    } : {}),
  };

  const total = await prisma.timeLog.count({ where });

  if (total === 0) {
    console.log("✅ Nothing to process — no affected records found.");
    await prisma.$disconnect();
    return;
  }

  console.log(`📋 Found ${total} record(s) to recompute.\n`);

  const startedAt = Date.now();
  const elapsed   = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  // Collect all IDs upfront so pagination is stable regardless of whether
  // recompute changes the fields used in the where clause.
  const allIds = (await prisma.timeLog.findMany({
    where,
    select:  { id: true },
    orderBy: { timeIn: "asc" },
  })).map((r) => r.id);

  console.log(`📋 Collected ${allIds.length} IDs — processing in batches of ${BATCH_SIZE}.\n`);

  let processed = 0;
  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    const batch = allIds.slice(i, i + BATCH_SIZE);

    for (const id of batch) {
      try {
        await computeTimeLogSummary(id);
        succeeded++;
      } catch (err) {
        console.error(`  ✗ ${id}: ${err.message}`);
        failed++;
      }
      processed++;
    }

    if (processed % (BATCH_SIZE * 5) === 0 || processed === allIds.length) {
      console.log(`  … ${processed}/${allIds.length} processed (${elapsed()})`);
    }
  }

  console.log("\n────────────────────────────────────────────────────────");
  console.log(` Done in ${elapsed()} — ${allIds.length} records`);
  console.log(`  Recomputed : ${succeeded}`);
  console.log(`  Failed     : ${failed}`);
  console.log("────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
