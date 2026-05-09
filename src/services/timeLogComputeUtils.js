// src/services/timeLogComputeUtils.js
// Pure, sync helpers shared by all timeLog compute strategies.
// No DB calls. No side effects. Safe to require from any strategy.

const moment = require("moment-timezone");

function timeStrFromDbTime(timeLikeDate) {
  const t = new Date(timeLikeDate);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function resolveTimezone(companyTz) {
  if (companyTz && moment.tz.zone(companyTz)) return companyTz;
  return "America/Los_Angeles";
}

function combineDateWithTimeTz(referenceDate, timeLikeDate, tz) {
  const dateOnly = moment(referenceDate).tz(tz).format("YYYY-MM-DD");
  const timeStr  = timeStrFromDbTime(timeLikeDate);
  return moment.tz(`${dateOnly} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz).toDate();
}

function sumCoffeeBreakMinutes(coffeeBreaks) {
  if (!Array.isArray(coffeeBreaks) || coffeeBreaks.length === 0) return 0;
  return coffeeBreaks.reduce((total, b) => {
    if (!b.start || !b.end) return total;
    if (b.auto && b.deductible === false) return total;
    const diffMs = new Date(b.end) - new Date(b.start);
    if (diffMs <= 0) return total;
    return total + diffMs / 60000;
  }, 0);
}

function lunchBreakMinutes(lunchBreak) {
  if (!lunchBreak?.start || !lunchBreak?.end) return 0;
  const diffMs = new Date(lunchBreak.end) - new Date(lunchBreak.start);
  return diffMs > 0 ? diffMs / 60000 : 0;
}

function computeSegmentHours(timeIn, timeOut, segStart, segEnd) {
  if (!segStart || !segEnd) return null;
  const start = Math.max(timeIn.getTime(),  segStart.getTime());
  const end   = Math.min(timeOut.getTime(), segEnd.getTime());
  return +(Math.max(0, end - start) / 3600000).toFixed(2);
}

function matchShiftToWindow(userShifts, timeIn, timeOut, tz) {
  if (userShifts.length === 0) return null;
  if (userShifts.length === 1) return userShifts[0];

  const timeInMs  = timeIn.getTime();
  const timeOutMs = timeOut.getTime();

  const prevDay = moment(timeIn).tz(tz).subtract(1, "day").toDate();
  const anchors = [timeIn, prevDay];

  const windows = userShifts.map((us) => {
    if (!us.shift?.startTime || !us.shift?.endTime) {
      return { us, overlap: -1, closestDist: Infinity };
    }

    let bestOverlap = -1;
    let closestDist = Infinity;

    for (const anchor of anchors) {
      const segStart = combineDateWithTimeTz(anchor, us.shift.startTime, tz);
      let   segEnd   = combineDateWithTimeTz(anchor, us.shift.endTime, tz);
      if (segEnd <= segStart) segEnd = moment(segEnd).add(1, "day").toDate();

      const overlap = Math.max(
        0,
        Math.min(timeOutMs, segEnd.getTime()) - Math.max(timeInMs, segStart.getTime())
      );

      if (overlap > bestOverlap) bestOverlap = overlap;

      const dist = Math.abs(timeInMs - segStart.getTime());
      if (dist < closestDist) closestDist = dist;
    }

    return { us, overlap: bestOverlap, closestDist };
  });

  const best = windows.reduce((a, b) => b.overlap > a.overlap ? b : a);
  if (best.overlap > 0) return best.us;

  return windows.reduce((a, b) => b.closestDist < a.closestDist ? b : a).us;
}

module.exports = {
  timeStrFromDbTime,
  resolveTimezone,
  combineDateWithTimeTz,
  sumCoffeeBreakMinutes,
  lunchBreakMinutes,
  computeSegmentHours,
  matchShiftToWindow,
};
