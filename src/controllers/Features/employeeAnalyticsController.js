// src/controllers/Features/employeeAnalyticsController.js

const { prisma } = require("@config/connection");

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const diffH = (a, b) => (a && b ? (toDate(b) - toDate(a)) / 36e5 : 0);
const day = (v) => toDate(v).toISOString().slice(0, 10);

const getEmployeeAnalytics = async (req, res) => {
  try {
    const uid = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: uid },
      include: { profile: true, department: true },
    });

    const timelogs = await prisma.timeLog.findMany({ where: { userId: uid } });
    const shifts = await prisma.userShift.findMany({
      where: { userId: uid },
      include: { shift: true },
    });

    const logsByDate = {};
    timelogs.forEach((l) => {
      if (!l.timeIn) return;
      const k = day(l.timeIn);
      logsByDate[k] ??= { hours: 0, firstIn: toDate(l.timeIn) };
      logsByDate[k].hours += diffH(l.timeIn, l.timeOut ?? l.timeIn);
      if (toDate(l.timeIn) < logsByDate[k].firstIn) logsByDate[k].firstIn = toDate(l.timeIn);
    });

    const shiftByDate = {};
    shifts.forEach((s) => {
      const k = day(s.assignedDate);
      shiftByDate[k] ??= [];
      shiftByDate[k].push(s.shift);
    });

    let totalHours = 0,
      overtime = 0,
      late = 0,
      absences = 0;

    Object.entries(shiftByDate).forEach(([k, arr]) => {
      const schedH = arr.reduce((n, sh) => n + diffH(sh.startTime, sh.endTime), 0);
      const actualH = logsByDate[k]?.hours ?? 0;
      totalHours += actualH;
      overtime += Math.max(0, actualH - schedH);

      const firstStart = toDate(Math.min(...arr.map((sh) => toDate(sh.startTime))));
      const grace = addMin(firstStart, 15);

      if (!actualH) absences++;
      else if (logsByDate[k].firstIn > grace) late++;
    });

    Object.entries(logsByDate).forEach(([k, v]) => {
      if (!shiftByDate[k]) totalHours += v.hours;
    });

    const dailyHours = Object.entries(logsByDate)
      .sort()
      .map(([d, v]) => ({ date: d, hours: +v.hours.toFixed(2) }));

    return res.status(200).json({
      data: {
        profile: {
          username: user.username,
          firstName: user.profile?.firstName || "",
          lastName: user.profile?.lastName || "",
          email: user.email,
          department: user.department?.name || "—",
        },
        totals: {
          totalHours: +totalHours.toFixed(2),
          overtime: +overtime.toFixed(2),
          lateIns: late,
          absences,
          activeSessions: timelogs.filter((l) => l.status).length,
        },
        charts: { dailyHours },
      },
    });
  } catch (e) {
    console.error("getEmployeeAnalytics", e);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = { getEmployeeAnalytics };
