-- ============================================================
-- OT AUDIT — Arlene Falces (falcesarlene2003@yahoo.com)
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
WHERE u.email = 'falcesarlene2003@yahoo.com';


-- ── 1. Approved punches with hours (all time, LA timezone) ───
--
-- Shows every approved TimeLogApproval for Arlene, with:
--   punch_date  — calendar date in LA timezone (what day the punch belongs to)
--   actual_hrs  — actualHours from the approval record (authoritative for OT)
--   fallback_hrs — computed from approvedClockIn/Out if actualHours is null
--   net_worked  — raw netWorkedHours from TimeLog (may be stale)
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
    THEN EXTRACT(EPOCH FROM (tla."approvedClockOut" - tla."approvedClockIn")) / 3600
  END                                                             AS approved_ts_hrs,
  tl."netWorkedHours"                                             AS net_worked_stale,
  tl."grossHours"                                                 AS gross_hrs,
  tl."scheduledHours"                                             AS scheduled_hrs,
  tla."approvedClockIn"  AT TIME ZONE 'America/Los_Angeles'       AS approved_in_la,
  tla."approvedClockOut" AT TIME ZONE 'America/Los_Angeles'       AS approved_out_la
FROM "TimeLogApproval" tla
JOIN "TimeLog" tl ON tl.id = tla."timeLogId"
JOIN "User"    u  ON u.id  = tl."userId"
WHERE u.email  = 'falcesarlene2003@yahoo.com'
  AND tla.status = 'approved'
ORDER BY tl."timeIn";


-- ── 2. Daily OT estimate (approved punches only) ─────────────
--
-- Groups approved punches by calendar date in LA timezone.
-- Shows two OT estimates:
--   ot_from_actual_hrs — uses actualHours (correct — what OT service NOW uses)
--   ot_from_net_worked — uses netWorkedHours from TimeLog (what old code used — may be wrong)
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
  WHERE u.email  = 'falcesarlene2003@yahoo.com'
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


-- ── 3. UserShift assignments (her scheduled shifts by date) ──
--
-- Shows every shift assigned to Arlene via UserShift records.
-- assignedDate is a DATE so no timezone needed.
--
SELECT
  us."assignedDate"                                               AS shift_date,
  s."shiftName",
  s."startTime"::text                                             AS shift_start,
  s."endTime"::text                                               AS shift_end,
  s."crossesMidnight",
  EXTRACT(EPOCH FROM (
    CASE WHEN s."crossesMidnight"
         THEN s."endTime" + INTERVAL '24 hours'
         ELSE s."endTime"
    END - s."startTime"
  )) / 3600                                                       AS shift_duration_hrs,
  us.status                                                       AS shift_status,
  us."createdFrom"
FROM "UserShift" us
JOIN "Shift" s ON s.id = us."shiftId"
JOIN "User"  u ON u.id = us."userId"
WHERE u.email = 'falcesarlene2003@yahoo.com'
ORDER BY us."assignedDate", s."startTime";


-- ── 4. Scheduled hours per day vs actual approved hours ───────
--
-- Side-by-side: what she was supposed to work vs what was approved.
-- Flags any day where actual hours significantly differ from scheduled,
-- and shows the correct OT entitlement.
--
WITH scheduled AS (
  SELECT
    us."assignedDate"                                             AS shift_date,
    SUM(
      EXTRACT(EPOCH FROM (
        CASE WHEN s."crossesMidnight"
             THEN s."endTime" + INTERVAL '24 hours'
             ELSE s."endTime"
        END - s."startTime"
      )) / 3600
    )                                                             AS total_scheduled_hrs,
    STRING_AGG(s."shiftName", ', ' ORDER BY s."startTime")       AS shifts
  FROM "UserShift" us
  JOIN "Shift" s ON s.id = us."shiftId"
  JOIN "User"  u ON u.id = us."userId"
  WHERE u.email = 'falcesarlene2003@yahoo.com'
    AND us.status != 'cancelled'
  GROUP BY us."assignedDate"
),
actual AS (
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
    )                                                             AS total_actual_hrs
  FROM "TimeLogApproval" tla
  JOIN "TimeLog" tl ON tl.id = tla."timeLogId"
  JOIN "User"    u  ON u.id  = tl."userId"
  WHERE u.email  = 'falcesarlene2003@yahoo.com'
    AND tla.status = 'approved'
  GROUP BY (tl."timeIn" AT TIME ZONE 'America/Los_Angeles')::date
)
SELECT
  COALESCE(s.shift_date, a.punch_date)                           AS date,
  s.shifts                                                        AS scheduled_shifts,
  ROUND(s.total_scheduled_hrs::numeric, 2)                       AS scheduled_hrs,
  ROUND(a.total_actual_hrs::numeric, 2)                          AS actual_hrs,
  ROUND(GREATEST(0, a.total_actual_hrs - 8)::numeric, 2)         AS ot_entitled_hrs,
  CASE
    WHEN a.punch_date IS NULL                                     THEN '📋 No punch'
    WHEN s.shift_date IS NULL                                     THEN '⚠ No shift assigned'
    WHEN ABS(a.total_actual_hrs - s.total_scheduled_hrs) > 1     THEN '⚠ Hours differ >1h'
    ELSE '✓'
  END                                                             AS flag
FROM scheduled s
FULL OUTER JOIN actual a ON a.punch_date = s.shift_date
ORDER BY COALESCE(s.shift_date, a.punch_date);


-- ── 5. ShiftSchedule recurring rules for Arlene ──────────────
--
-- Shows any recurring ShiftSchedule rules assigned specifically
-- to Arlene (assignmentType = 'individual') or her department.
--
SELECT
  ss."assignmentType",
  ss."targetId",
  s."shiftName",
  s."startTime"::text                                             AS start_time,
  s."endTime"::text                                               AS end_time,
  ss."daysOfWeek",
  ss."startDate"::date                                            AS rule_start,
  ss."endDate"::date                                              AS rule_end,
  ss."isActive"
FROM "ShiftSchedule" ss
JOIN "Shift" s ON s.id = ss."shiftId"
JOIN "User"  u ON u."companyId" = ss."companyId"
WHERE u.email = 'falcesarlene2003@yahoo.com'
  AND (
    (ss."assignmentType" = 'individual' AND ss."targetId" = u.id)
    OR (ss."assignmentType" = 'department' AND ss."targetId" = u."departmentId")
    OR ss."assignmentType" = 'all'
  )
ORDER BY ss."assignmentType", ss."startDate";
