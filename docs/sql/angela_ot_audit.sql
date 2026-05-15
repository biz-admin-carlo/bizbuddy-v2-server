-- ============================================================
-- OT AUDIT — Angela Roque (angie.trgllc@gmail.com)
-- Company timezone: America/Los_Angeles (PDT = UTC-7)
-- Daily OT threshold: 8h
-- Run each block independently or all at once.
-- ============================================================

-- ── 0. User lookup ───────────────────────────────────────────
SELECT
  u.id            AS user_id,
  u.username,
  u.email,
  u."departmentId",
  u."companyId"
FROM "User" u
WHERE u.email = 'angie.trgllc@gmail.com';


-- ── 1. Approved punches with hours (all time, LA timezone) ───
--
-- Shows every approved TimeLogApproval for Angela, with:
--   punch_date      — calendar date in LA timezone
--   actual_hrs      — actualHours from the approval record (authoritative for OT)
--   approved_ts_hrs — computed from approvedClockIn/Out (cross-check)
--   net_worked_stale — netWorkedHours from TimeLog (may be stale)
--   flag            — ⚠ if actualHours vs approved timestamp gap > 0.1h (corruption check)
--
SELECT
  tla.id                                                          AS approval_id,
  tla."cutoffPeriodId",
  tla.status,
  -- Calendar date in LA timezone
  (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date         AS punch_date,
  -- In/out display
  (tl."timeIn"  AT TIME ZONE 'America/Los_Angeles')              AS clock_in_la,
  (tl."timeOut" AT TIME ZONE 'America/Los_Angeles')              AS clock_out_la,
  -- Hours sources
  tla."actualHours"                                               AS actual_hrs,
  CASE
    WHEN tla."approvedClockIn" IS NOT NULL AND tla."approvedClockOut" IS NOT NULL
    THEN ROUND(
      (EXTRACT(EPOCH FROM (tla."approvedClockOut" - tla."approvedClockIn")) / 3600)::numeric,
      2
    )
  END                                                             AS approved_ts_hrs,
  tl."netWorkedHours"                                             AS net_worked_stale,
  tla."approvedClockIn"  AT TIME ZONE 'America/Los_Angeles'       AS approved_in_la,
  tla."approvedClockOut" AT TIME ZONE 'America/Los_Angeles'       AS approved_out_la,
  -- Corruption flag: actualHours disagrees with timestamp diff by more than 6 minutes
  CASE
    WHEN tla."actualHours" IS NOT NULL
     AND tla."approvedClockIn" IS NOT NULL
     AND tla."approvedClockOut" IS NOT NULL
     AND ABS(
       tla."actualHours"::numeric -
       (EXTRACT(EPOCH FROM (tla."approvedClockOut" - tla."approvedClockIn")) / 3600)::numeric
     ) > 0.1
    THEN '⚠ CORRUPTED'
    ELSE ''
  END                                                             AS corruption_flag
FROM "TimeLogApproval" tla
JOIN "TimeLog" tl ON tl.id = tla."timeLogId"
JOIN "User"    u  ON u.id  = tl."userId"
WHERE u.email  = 'angie.trgllc@gmail.com'
  AND tla.status = 'approved'
ORDER BY tl."timeIn";


-- ── 2. Daily OT estimate (approved punches only) ─────────────
--
-- Groups approved punches by calendar date in LA timezone.
-- Shows two OT estimates:
--   ot_from_actual_hrs — uses actualHours (what OT service now uses)
--   ot_from_net_worked — uses netWorkedHours from TimeLog (what old code used)
--
WITH daily AS (
  SELECT
    (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date        AS punch_date,
    COUNT(*)                                                       AS punch_count,
    SUM(
      COALESCE(
        tla."actualHours",
        CASE
          WHEN tla."approvedClockIn" IS NOT NULL AND tla."approvedClockOut" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (tla."approvedClockOut" - tla."approvedClockIn")) / 3600
        END,
        tl."netWorkedHours"
      )
    )                                                              AS total_actual_hrs,
    SUM(tl."netWorkedHours")                                       AS total_net_worked
  FROM "TimeLogApproval" tla
  JOIN "TimeLog" tl ON tl.id = tla."timeLogId"
  JOIN "User"    u  ON u.id  = tl."userId"
  WHERE u.email  = 'angie.trgllc@gmail.com'
    AND tla.status = 'approved'
  GROUP BY (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date
)
SELECT
  punch_date,
  punch_count,
  ROUND(total_actual_hrs::numeric, 2)                             AS total_hrs_actual,
  ROUND(GREATEST(0, total_actual_hrs - 8)::numeric, 2)           AS ot_from_actual_hrs,
  ROUND(total_net_worked::numeric, 2)                             AS total_hrs_net_worked,
  ROUND(GREATEST(0, total_net_worked - 8)::numeric, 2)           AS ot_from_net_worked,
  CASE
    WHEN ROUND(GREATEST(0, total_actual_hrs - 8)::numeric, 2)
      != ROUND(GREATEST(0, total_net_worked - 8)::numeric, 2)
    THEN '⚠ MISMATCH'
    ELSE ''
  END                                                             AS flag
FROM daily
ORDER BY punch_date;


-- ── 3. CutoffOtBlock records for Angela ──────────────────────
--
-- Shows every OT block the system has created for her.
-- Cross-reference with Query 2 — if a block exists for a day
-- where total_actual_hrs <= 8, that is a false positive.
--
SELECT
  cob.id                                                          AS ot_block_id,
  cob."cutoffPeriodId",
  cob.date                                                        AS ot_date,
  cob."otHours",
  cob.status,
  cob."approvedBy",
  cob."approvedAt",
  cob.notes,
  cob."createdAt",
  cob."updatedAt"
FROM "CutoffOtBlock" cob
JOIN "User" u ON u.id = cob."userId"
WHERE u.email = 'angie.trgllc@gmail.com'
ORDER BY cob.date;


-- ── 4. UserShift assignments (her scheduled shifts by date) ──
--
-- Shows every shift assigned to Angela via UserShift records.
--
SELECT
  us."assignedDate"                                               AS shift_date,
  s."shiftName",
  s."startTime"::text                                             AS shift_start,
  s."endTime"::text                                               AS shift_end,
  s."crossesMidnight",
  ROUND(
    EXTRACT(EPOCH FROM (
      CASE WHEN s."crossesMidnight"
           THEN s."endTime" + INTERVAL '24 hours'
           ELSE s."endTime"
      END - s."startTime"
    )) / 3600,
    2
  )                                                               AS shift_duration_hrs,
  us.status                                                       AS shift_status,
  us."createdFrom"
FROM "UserShift" us
JOIN "Shift" s ON s.id = us."shiftId"
JOIN "User"  u ON u.id = us."userId"
WHERE u.email = 'angie.trgllc@gmail.com'
ORDER BY us."assignedDate", s."startTime";


-- ── 5. Approved hours vs OT blocks — sanity check ────────────
--
-- Joins Query 2 (daily totals) with Query 3 (OT blocks).
-- Flags: false positives (block exists but ≤ 8h) or
--        missing blocks (>8h but no block).
--
WITH daily AS (
  SELECT
    (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date        AS punch_date,
    SUM(
      COALESCE(
        tla."actualHours",
        CASE
          WHEN tla."approvedClockIn" IS NOT NULL AND tla."approvedClockOut" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (tla."approvedClockOut" - tla."approvedClockIn")) / 3600
        END,
        tl."netWorkedHours"
      )
    )                                                             AS total_hrs
  FROM "TimeLogApproval" tla
  JOIN "TimeLog" tl ON tl.id = tla."timeLogId"
  JOIN "User"    u  ON u.id  = tl."userId"
  WHERE u.email  = 'angie.trgllc@gmail.com'
    AND tla.status = 'approved'
  GROUP BY (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date
),
blocks AS (
  SELECT
    cob.date::date                                                AS ot_date,
    cob."otHours",
    cob.status
  FROM "CutoffOtBlock" cob
  JOIN "User" u ON u.id = cob."userId"
  WHERE u.email = 'angie.trgllc@gmail.com'
)
SELECT
  COALESCE(d.punch_date, b.ot_date)                              AS date,
  ROUND(d.total_hrs::numeric, 2)                                 AS total_approved_hrs,
  ROUND(GREATEST(0, d.total_hrs - 8)::numeric, 2)               AS expected_ot_hrs,
  b."otHours"                                                    AS block_ot_hrs,
  b.status                                                       AS block_status,
  CASE
    WHEN b.ot_date IS NOT NULL AND d.total_hrs <= 8
      THEN '🚨 FALSE POSITIVE — block exists but ≤ 8h'
    WHEN d.total_hrs > 8 AND b.ot_date IS NULL
      THEN '⚠ MISSING BLOCK — over threshold but no block'
    WHEN b.ot_date IS NOT NULL
     AND ABS(b."otHours"::numeric - GREATEST(0, d.total_hrs - 8)::numeric) > 0.05
      THEN '⚠ WRONG AMOUNT — block hours differ from expected'
    ELSE '✓'
  END                                                            AS verdict
FROM daily d
FULL OUTER JOIN blocks b ON b.ot_date = d.punch_date
ORDER BY COALESCE(d.punch_date, b.ot_date);
