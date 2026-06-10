// Pilot: run early clock-out snap on 5 affected logs (BB-024)
// Company : cmnegwuxm0004rf7fzo6wjrw2
// Period  : 2026-05-13 → 2026-05-26
// Run     : node scripts/pilot-early-clockout-snap.js

require("module-alias/register");
require("dotenv").config();

const { prisma }              = require("@config/connection");
const { computeTimeLogSummary } = require("@services/timeLogComputeService");

const COMPANY_ID  = "cmnegwuxm0004rf7fzo6wjrw2";
const DATE_FROM   = new Date("2026-05-13T00:00:00.000Z");
const DATE_TO     = new Date("2026-05-26T23:59:59.999Z");
const GRACE_MIN   = 20;
const PILOT_LIMIT = 5;

async function main() {
  // ── 1. Resolve PM shift end time ────────────────────────────────────────────
  const pmShift = await prisma.shift.findFirst({
    where: { companyId: COMPANY_ID, shiftName: "Driver/Aide PM Shift" },
    select: { endTime: true },
  });

  if (!pmShift) {
    console.error("Driver/Aide PM Shift not found for this company.");
    process.exit(1);
  }

  const company = await prisma.company.findUnique({
    where:  { id: COMPANY_ID },
    select: { timeZone: true },
  });

  const tz = company?.timeZone ?? "UTC";
  console.log(`Company timezone : ${tz}`);
  console.log(`PM shift endTime : ${pmShift.endTime}`);
  console.log(`Grace window     : ${GRACE_MIN} minutes\n`);

  // ── 2. Fetch candidate logs (same criteria as estimate script) ───────────────
  const logs = await prisma.timeLog.findMany({
    where: {
      user: { companyId: COMPANY_ID },
      punchType: { in: ["DRIVER_AIDE", "DRIVER_AIDE_PM"] },
      timeIn:  { gte: DATE_FROM, lte: DATE_TO },
      timeOut: { not: null },
    },
    select: {
      id:                  true,
      timeIn:              true,
      timeOut:             true,
      grossHours:          true,
      driverPmSegmentHours: true,
      undertimeHours:      true,
      netWorkedHours:      true,
      punchType:           true,
      user: { select: { employeeId: true, profile: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { timeIn: "asc" },
  });

  // ── 3. Filter to only snappable logs (mirrors service logic) ─────────────────
  const moment = require("moment-timezone");
  const graceMs = GRACE_MIN * 60 * 1000;

  // pmShift.endTime is a Time — extract HH:mm
  const pmEndHHmm = pmShift.endTime instanceof Date
    ? `${String(pmShift.endTime.getUTCHours()).padStart(2, "0")}:${String(pmShift.endTime.getUTCMinutes()).padStart(2, "0")}`
    : String(pmShift.endTime).slice(0, 5);

  const snappable = logs.filter((log) => {
    const localDate = moment(log.timeIn).tz(tz).format("YYYY-MM-DD");
    const pmEndUtc  = moment.tz(`${localDate} ${pmEndHHmm}`, "YYYY-MM-DD HH:mm", tz).toDate();
    const earlyMs   = pmEndUtc.getTime() - log.timeOut.getTime();
    return earlyMs > 0 && earlyMs <= graceMs;
  });

  if (snappable.length === 0) {
    console.log("No snappable logs found in the given range.");
    process.exit(0);
  }

  const pilot = snappable.slice(0, PILOT_LIMIT);

  console.log(`Snappable logs found : ${snappable.length}`);
  console.log(`Running pilot on     : ${pilot.length}\n`);
  console.log("─".repeat(90));

  // ── 4. Snapshot before state, run compute, print comparison ─────────────────
  for (const log of pilot) {
    const localDate = moment(log.timeIn).tz(tz).format("YYYY-MM-DD");
    const pmEndUtc  = moment.tz(`${localDate} ${pmEndHHmm}`, "YYYY-MM-DD HH:mm", tz).toDate();
    const earlyMin  = Math.round((pmEndUtc.getTime() - log.timeOut.getTime()) / 60000);

    console.log(`Log ID   : ${log.id}`);
    const name = log.user.profile
      ? `${log.user.profile.firstName ?? ""} ${log.user.profile.lastName ?? ""}`.trim()
      : log.user.employeeId ?? "—";
    console.log(`Employee : ${name} (${log.user.employeeId ?? "—"})`);
    console.log(`Punch    : ${log.punchType}  |  Date: ${localDate}`);
    console.log(`Early by : ${earlyMin} min`);
    console.log(`BEFORE   : timeOut=${moment(log.timeOut).tz(tz).format("HH:mm")}  gross=${log.grossHours}h  pmSeg=${log.driverPmSegmentHours ?? "—"}h  undertime=${log.undertimeHours}h  net=${log.netWorkedHours}h`);

    try {
      await computeTimeLogSummary(log.id);

      const updated = await prisma.timeLog.findUnique({
        where:  { id: log.id },
        select: { timeOut: true, grossHours: true, driverPmSegmentHours: true, undertimeHours: true, netWorkedHours: true },
      });

      console.log(`AFTER    : timeOut=${moment(updated.timeOut).tz(tz).format("HH:mm")}  gross=${updated.grossHours}h  pmSeg=${updated.driverPmSegmentHours ?? "—"}h  undertime=${updated.undertimeHours}h  net=${updated.netWorkedHours}h`);
    } catch (err) {
      console.error(`ERROR on ${log.id}: ${err.message}`);
    }

    console.log("─".repeat(90));
  }

  console.log("\nPilot complete. Review the BEFORE/AFTER rows above.");
  console.log("If correct, run the full backfill script for all 52 logs.");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
