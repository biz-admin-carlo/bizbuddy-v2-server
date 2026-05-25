"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const moment = require("moment-timezone");
const {
  dateKeyFromDbDate,
  dateKeyInTz,
  combineAssignedDateWithTimeTz,
  evaluateClockInReminder,
} = require("../src/services/timeLogComputeUtils");

const TZ = "America/Los_Angeles";

/** @db.Date for 2025-05-12 (Monday) as Prisma returns it */
const MONDAY_ASSIGNED = new Date("2025-05-12T00:00:00.000Z");

/** @db.Time for 08:00:00 stored as UTC time component */
const EIGHT_AM_START = new Date("1970-01-01T08:00:00.000Z");

describe("clockInReminder timezone", () => {
  it("keeps Monday assignedDate as Monday (not Sunday) in US Pacific", () => {
    assert.equal(dateKeyFromDbDate(MONDAY_ASSIGNED), "2025-05-12");
    // Old bug: timezone-shifting assignedDate moved it to the prior day
    assert.equal(dateKeyInTz(MONDAY_ASSIGNED, TZ), "2025-05-11");
  });

  it("does not remind on Sunday 7:30 AM for a Monday 8:00 AM shift", () => {
    const now = moment
      .tz("2025-05-11 07:30:00", "YYYY-MM-DD HH:mm:ss", TZ)
      .toDate();
    const result = evaluateClockInReminder({
      assignedDate: MONDAY_ASSIGNED,
      startTime: EIGHT_AM_START,
      tz: TZ,
      now,
    });
    assert.equal(result.shouldRemind, false);
  });

  it("reminds on Monday 7:30 AM for a Monday 8:00 AM shift", () => {
    const now = moment
      .tz("2025-05-12 07:30:00", "YYYY-MM-DD HH:mm:ss", TZ)
      .toDate();
    const result = evaluateClockInReminder({
      assignedDate: MONDAY_ASSIGNED,
      startTime: EIGHT_AM_START,
      tz: TZ,
      now,
    });
    assert.equal(result.shouldRemind, true);
    assert.equal(result.minutesRemaining, 30);
    const expectedStart = combineAssignedDateWithTimeTz(
      MONDAY_ASSIGNED,
      EIGHT_AM_START,
      TZ,
    );
    assert.equal(
      result.shiftStart.toISOString(),
      expectedStart.toISOString(),
    );
  });

  it("combineAssignedDateWithTimeTz builds Monday 8:00 AM Pacific", () => {
    const shiftStart = combineAssignedDateWithTimeTz(
      MONDAY_ASSIGNED,
      EIGHT_AM_START,
      TZ,
    );
    assert.equal(
      moment(shiftStart).tz(TZ).format("YYYY-MM-DD HH:mm"),
      "2025-05-12 08:00",
    );
  });
});
