// src/controllers/Features/timeLogController.js

const { prisma } = require("@config/connection");
const { getIO } = require("@config/socket");

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function verifyLocationRestriction(userId, userLat, userLng) {
  const restrictions = await prisma.locationRestriction.findMany({
    where: { userId, restrictionStatus: true },
    include: { location: true },
  });

  if (!restrictions.length) return { allowed: true }; // unrestricted

  if (userLat == null || userLng == null) {
    return {
      allowed: false,
      reason: "Location services disabled or location data missing. You must enable location to Time In/Out.",
    };
  }

  for (const r of restrictions) {
    const loc = r.location;
    if (!loc) continue;
    const distKm = calculateDistanceKm(Number(loc.latitude), Number(loc.longitude), Number(userLat), Number(userLng));
    if (distKm * 1000 <= loc.radius) return { allowed: true };
  }

  return { allowed: false, reason: "You are not within any assigned location radius." };
}

async function calculateLateHoursForUser(userId, punchInDate) {
  const dayStart = new Date(punchInDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const userShift = await prisma.userShift.findFirst({
    where: { userId, assignedDate: { gte: dayStart, lte: dayEnd } },
    include: { shift: true },
  });
  if (!userShift?.shift?.startTime) return null;

  const shiftRef = new Date(userShift.shift.startTime);
  const shiftStart = new Date(punchInDate);
  shiftStart.setHours(shiftRef.getUTCHours(), shiftRef.getUTCMinutes(), 0, 0);

  if (punchInDate <= shiftStart) return 0;

  const minutesLate = (punchInDate - shiftStart) / 60000;
  return +(minutesLate / 60).toFixed(2);
}

const timeIn = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (activeLog) return res.status(400).json({ message: "User already timed in." });
    const { localTimestamp, deviceInfo, location } = req.body;
    const actualTimeIn = localTimestamp ? new Date(localTimestamp) : new Date();
    const locCheck = await verifyLocationRestriction(userId, location?.latitude, location?.longitude);
    if (!locCheck.allowed) return res.status(400).json({ message: locCheck.reason });
    const lateHours = await calculateLateHoursForUser(userId, actualTimeIn);
    const newTimeLog = await prisma.timeLog.create({
      data: {
        userId,
        timeIn: actualTimeIn,
        lateHours,
        deviceInfo: { start: deviceInfo ?? null, end: null },
        location: { start: location ?? null, end: null },
        coffeeBreaks: [],
        lunchBreak: null,
      },
    });

    getIO().to(userId).emit("timeLogUpdated", { type: "timeIn", data: newTimeLog });
    return res.status(201).json({ message: "Time in recorded successfully.", data: newTimeLog });
  } catch (err) {
    console.error("Error in timeIn:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const timeOut = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) return res.status(400).json({ message: "No active time log found." });
    const { localTimestamp, deviceInfo, location } = req.body;
    const actualTimeOut = localTimestamp ? new Date(localTimestamp) : new Date();
    const locCheck = await verifyLocationRestriction(userId, location?.latitude, location?.longitude);
    if (!locCheck.allowed) return res.status(400).json({ message: locCheck.reason });
    const updatedTimeLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: {
        timeOut: actualTimeOut,
        status: false,
        deviceInfo: {
          start: activeLog.deviceInfo.start ?? null,
          end: deviceInfo ?? null,
        },
        location: {
          start: activeLog.location.start ?? null,
          end: location ?? null,
        },
      },
    });

    getIO().to(userId).emit("timeLogUpdated", { type: "timeOut", data: updatedTimeLog });
    return res.status(200).json({ message: "Time out recorded successfully.", data: updatedTimeLog });
  } catch (err) {
    console.error("Error in timeOut:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getUserTimeLogs = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const logs = await prisma.timeLog.findMany({
      where: { userId: req.user.id },
      orderBy: { timeIn: "desc" },
      include: {
        overtime: { orderBy: { createdAt: "desc" } },
      },
    });
    const out = logs.map((l) => ({
      ...l,
      timeIn: l.timeIn ? l.timeIn.toISOString() : null,
      timeOut: l.timeOut ? l.timeOut.toISOString() : null,
    }));
    return res.status(200).json({ message: "Time logs retrieved.", data: out });
  } catch (err) {
    console.error("Error fetching user logs:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteTimeLog = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const { id } = req.params;
    const log = await prisma.timeLog.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ message: "Time log not found." });
    if (log.userId !== req.user.id) return res.status(403).json({ message: "Not your time log." });
    await prisma.timeLog.delete({ where: { id } });
    getIO().to(req.user.id).emit("timeLogUpdated", { type: "delete", data: { id } });
    return res.status(200).json({ message: "Time log deleted." });
  } catch (err) {
    console.error("Error deleting log:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const coffeeBreakStart = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) return res.status(400).json({ message: "No active time log found." });
    let breaks = Array.isArray(activeLog.coffeeBreaks) ? activeLog.coffeeBreaks : [];
    if (breaks.find((b) => b.end === null)) return res.status(400).json({ message: "A coffee break is already active." });
    if (breaks.length >= 2) return res.status(400).json({ message: "Maximum coffee breaks reached." });
    breaks.push({ start: new Date().toISOString(), end: null });
    const updated = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { coffeeBreaks: breaks },
    });
    getIO().to(userId).emit("timeLogUpdated", { type: "coffeeBreakStart", data: updated });
    return res.status(200).json({ message: "Coffee break started.", data: updated });
  } catch (err) {
    console.error("Coffee break start error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const coffeeBreakEnd = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) return res.status(400).json({ message: "No active time log found." });
    let breaks = Array.isArray(activeLog.coffeeBreaks) ? activeLog.coffeeBreaks : [];
    const i = breaks.findIndex((b) => b.end === null);
    if (i === -1) return res.status(400).json({ message: "No active coffee break to end." });
    breaks[i].end = new Date().toISOString();
    const updated = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { coffeeBreaks: breaks },
    });
    getIO().to(userId).emit("timeLogUpdated", { type: "coffeeBreakEnd", data: updated });
    return res.status(200).json({ message: "Coffee break ended.", data: updated });
  } catch (err) {
    console.error("Coffee break end error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const lunchBreakStart = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) return res.status(400).json({ message: "No active time log found." });
    if (activeLog.lunchBreak?.start && !activeLog.lunchBreak.end) return res.status(400).json({ message: "Lunch break already started." });
    const updated = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { lunchBreak: { start: new Date().toISOString(), end: null } },
    });
    getIO().to(userId).emit("timeLogUpdated", { type: "lunchBreakStart", data: updated });
    return res.status(200).json({ message: "Lunch break started.", data: updated });
  } catch (err) {
    console.error("Lunch break start error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const lunchBreakEnd = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) return res.status(400).json({ message: "No active time log found." });
    if (!activeLog.lunchBreak?.start || activeLog.lunchBreak?.end) return res.status(400).json({ message: "No active lunch break to end." });
    const updated = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: {
        lunchBreak: {
          ...activeLog.lunchBreak,
          end: new Date().toISOString(),
        },
      },
    });
    getIO().to(userId).emit("timeLogUpdated", { type: "lunchBreakEnd", data: updated });
    return res.status(200).json({ message: "Lunch break ended.", data: updated });
  } catch (err) {
    console.error("Lunch break end error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getCompanyTimeLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const where = { user: { companyId } };
    if (req.query.employeeId) where.userId = req.query.employeeId;
    if (req.query.departmentId) where.user = { ...where.user, departmentId: req.query.departmentId };
    if (req.query.status === "active") where.status = true;
    if (req.query.status === "completed") where.status = false;
    if (req.query.from || req.query.to) {
      where.timeIn = {};
      if (req.query.from) where.timeIn.gte = new Date(`${req.query.from}T00:00:00Z`);
      if (req.query.to) where.timeIn.lte = new Date(`${req.query.to}T23:59:59Z`);
    }
    const logs = await prisma.timeLog.findMany({
      where,
      orderBy: { timeIn: "desc" },
      include: {
        user: {
          include: {
            profile: true,
            department: true,
            presence: true,
          },
        },
      },
    });

    const rows = logs.map((l) => ({
      id: l.id,
      userId: l.user.id,
      employeeName: `${l.user.profile?.firstName || ""} ${l.user.profile?.lastName || ""}`.trim(),
      email: l.user.email,
      department: l.user.department?.name || "—",
      timeIn: l.timeIn,
      timeOut: l.timeOut,
      lateHours: l.lateHours,
      deviceIn: l.deviceInfo?.start ?? null,
      deviceOut: l.deviceInfo?.end ?? null,
      locIn: l.location?.start ?? null,
      locOut: l.location?.end ?? null,
      status: l.status ? "active" : "completed",
      coffeeBreaks: l.coffeeBreaks ?? [],
      lunchBreak: l.lunchBreak ?? null,
      coffeeCount: (l.coffeeBreaks ?? []).length,
      lunchTaken: !!l.lunchBreak?.end,
      presence: l.user.presence?.presenceStatus || "unknown",
      shiftToday: null,
    }));
    if (rows.length) {
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const today = new Date();
      const dayStart = new Date(today);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const shiftRows = await prisma.userShift.findMany({
        where: { userId: { in: userIds }, assignedDate: { gte: dayStart, lte: dayEnd } },
        include: { shift: true },
      });
      const map = {};
      shiftRows.forEach((s) => {
        map[s.userId] = s.shift.shiftName;
      });
      rows.forEach((r) => {
        r.shiftToday = map[r.userId] || "—";
      });
    }

    return res.status(200).json({ data: rows });
  } catch (err) {
    console.error("getCompanyTimeLogs error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  timeIn,
  timeOut,
  getUserTimeLogs,
  deleteTimeLog,
  coffeeBreakStart,
  coffeeBreakEnd,
  lunchBreakStart,
  lunchBreakEnd,
  getCompanyTimeLogs,
};
