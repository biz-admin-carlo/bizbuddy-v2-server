-- Estimate: early clock-out snap backfill impact (BB-024)
-- Company : cmnegwuxm0004rf7fzo6wjrw2
-- Period  : 2026-05-13 → 2026-05-26 (company-local dates)
-- Scope   : DRIVER_AIDE + DRIVER_AIDE_PM punch types only
-- Grace   : 20 minutes (default — column not yet migrated)
-- Read-only — no changes made.

-- ─── 1. Company info + PM shift boundary ─────────────────────────────────────
SELECT
  c.id                           AS "companyId",
  c.name                         AS "companyName",
  c."timeZone",
  s."endTime"                    AS "pmShiftEndTime",
  20                             AS "graceMinutes (hardcoded default)"
FROM "Company" c
JOIN "Shift"   s ON s."companyId" = c.id
               AND s."shiftName"  = 'Driver/Aide PM Shift'
WHERE c.id = 'cmnegwuxm0004rf7fzo6wjrw2';


-- ─── 2. Affected log detail ───────────────────────────────────────────────────
-- Shows each log that would be snapped, with current vs projected clock-out.
WITH pm_shift AS (
  SELECT s."endTime" AS end_time
  FROM "Shift" s
  WHERE s."companyId" = 'cmnegwuxm0004rf7fzo6wjrw2'
    AND s."shiftName" = 'Driver/Aide PM Shift'
  LIMIT 1
),
logs AS (
  SELECT
    tl.id                                                                        AS "timeLogId",
    u.id                                                                         AS "userId",
    u."firstName" || ' ' || u."lastName"                                         AS "employeeName",
    u."employeeId",
    tl."punchType",
    (tl."timeIn" AT TIME ZONE c."timeZone")::date                                AS "localDate",
    tl."timeIn"  AT TIME ZONE c."timeZone"                                       AS "clockIn_local",
    tl."timeOut" AT TIME ZONE c."timeZone"                                       AS "clockOut_local",
    -- Reconstruct PM shift end as a timestamptz on the punch's local date
    (
      (tl."timeIn" AT TIME ZONE c."timeZone")::date + pm_shift.end_time
    ) AT TIME ZONE c."timeZone"                                                  AS "pmEnd_utc",
    tl."timeOut"                                                                 AS "timeOut_utc",
    tl."grossHours",
    tl."driverPmSegmentHours",
    tl."undertimeHours",
    tl."netWorkedHours",
    tl."isApproved"
  FROM "Company"  c
  JOIN "User"     u  ON u."companyId" = c.id
  JOIN "TimeLog"  tl ON tl."userId"   = u.id
  CROSS JOIN pm_shift
  WHERE c.id = 'cmnegwuxm0004rf7fzo6wjrw2'
    AND tl."punchType" IN ('DRIVER_AIDE', 'DRIVER_AIDE_PM')
    AND (tl."timeIn" AT TIME ZONE c."timeZone")::date
          BETWEEN '2026-05-13' AND '2026-05-26'
    AND tl."timeOut" IS NOT NULL
)
SELECT
  "timeLogId",
  "userId",
  "employeeName",
  "employeeId",
  "punchType",
  "localDate",
  "clockIn_local",
  "clockOut_local",
  "pmEnd_utc" AT TIME ZONE
    (SELECT "timeZone" FROM "Company" WHERE id = 'cmnegwuxm0004rf7fzo6wjrw2')   AS "pmEnd_local",
  ROUND(
    EXTRACT(EPOCH FROM ("pmEnd_utc" - "timeOut_utc")) / 60
  )                                                                              AS "earlyByMinutes",
  "grossHours"                                                                   AS "grossHours_current",
  ROUND(
    EXTRACT(EPOCH FROM ("pmEnd_utc" - (SELECT MIN(tl2."timeIn") FROM "TimeLog" tl2 WHERE tl2.id = "timeLogId"))) / 3600
  , 2)                                                                           AS "grossHours_projected",
  "driverPmSegmentHours",
  "undertimeHours",
  "netWorkedHours",
  "isApproved"
FROM logs
WHERE
  -- clocked out early (before PM shift end)
  "timeOut_utc" < "pmEnd_utc"
  -- within grace window (20 min)
  AND ("pmEnd_utc" - "timeOut_utc") <= INTERVAL '20 minutes'
ORDER BY "localDate", "employeeName";


-- ─── 3. Summary ───────────────────────────────────────────────────────────────
WITH pm_shift AS (
  SELECT s."endTime" AS end_time
  FROM "Shift" s
  WHERE s."companyId" = 'cmnegwuxm0004rf7fzo6wjrw2'
    AND s."shiftName" = 'Driver/Aide PM Shift'
  LIMIT 1
)
SELECT
  COUNT(*)                                                                       AS "totalLogsInRange",
  COUNT(*) FILTER (
    WHERE tl."timeOut" < (
      (tl."timeIn" AT TIME ZONE c."timeZone")::date + pm_shift.end_time
    ) AT TIME ZONE c."timeZone"
    AND (
      (
        (tl."timeIn" AT TIME ZONE c."timeZone")::date + pm_shift.end_time
      ) AT TIME ZONE c."timeZone" - tl."timeOut"
    ) <= INTERVAL '20 minutes'
  )                                                                              AS "logsToBeSnapped",
  COUNT(*) FILTER (
    WHERE tl."isApproved" = true
    AND tl."timeOut" < (
      (tl."timeIn" AT TIME ZONE c."timeZone")::date + pm_shift.end_time
    ) AT TIME ZONE c."timeZone"
    AND (
      (
        (tl."timeIn" AT TIME ZONE c."timeZone")::date + pm_shift.end_time
      ) AT TIME ZONE c."timeZone" - tl."timeOut"
    ) <= INTERVAL '20 minutes'
  )                                                                              AS "alreadyApproved"
FROM "Company"  c
JOIN "User"     u  ON u."companyId" = c.id
JOIN "TimeLog"  tl ON tl."userId"   = u.id
CROSS JOIN pm_shift
WHERE c.id = 'cmnegwuxm0004rf7fzo6wjrw2'
  AND tl."punchType" IN ('DRIVER_AIDE', 'DRIVER_AIDE_PM')
  AND (tl."timeIn" AT TIME ZONE c."timeZone")::date
        BETWEEN '2026-05-13' AND '2026-05-26'
  AND tl."timeOut" IS NOT NULL;
