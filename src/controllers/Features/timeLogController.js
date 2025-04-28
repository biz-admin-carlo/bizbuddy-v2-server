// src/controllers/Features/timeLogController.js

const { prisma } = require("@config/connection");
const { getIO } = require("@config/socket");

/**
 * Returns the distance in kilometers between two lat/lng points (Haversine formula).
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a user is within at least one assigned location's radius.
 * - If user has no active restrictions => allowed
 * - If user is restricted but we have no lat/lng => fail with reason
 * - If user is out of radius => fail with reason
 */
async function verifyLocationRestriction(userId, userLat, userLng) {
  // Find all restrictions with restrictionStatus = true for this user
  const restrictions = await prisma.locationRestriction.findMany({
    where: {
      userId,
      restrictionStatus: true,
    },
    include: {
      location: true,
    },
  });

  // If the user isn't restricted, allow
  if (!restrictions || restrictions.length === 0) {
    return { allowed: true };
  }

  // If restricted but location is missing => fail
  if (userLat == null || userLng == null) {
    return {
      allowed: false,
      reason: "Location services disabled or location data missing. You must enable location to Time In/Out.",
    };
  }

  // Check each assigned location. If within radius of at least one => pass
  for (const r of restrictions) {
    const loc = r.location;
    if (!loc) continue;
    const distKm = calculateDistanceKm(Number(loc.latitude), Number(loc.longitude), Number(userLat), Number(userLng));
    const distMeters = distKm * 1000;
    if (distMeters <= loc.radius) {
      return { allowed: true };
    }
  }

  // If we never returned => user is outside all assigned location radii
  return {
    allowed: false,
    reason: "You are not within any assigned location radius.",
  };
}

const timeIn = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = req.user.id;

    // If user already has an active log, block
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (activeLog) {
      return res.status(400).json({ message: "User already timed in." });
    }

    const { localTimestamp, deviceInfo, location } = req.body;
    const actualTimeIn = localTimestamp ? new Date(localTimestamp) : new Date();

    // Verify location if restricted
    const userLat = location?.latitude;
    const userLng = location?.longitude;
    const check = await verifyLocationRestriction(userId, userLat, userLng);
    if (!check.allowed) {
      // Return 400 with the reason
      return res.status(400).json({
        message: check.reason || "Failed location-based restriction check.",
      });
    }

    // If allowed => create time log
    const newTimeLog = await prisma.timeLog.create({
      data: {
        userId,
        timeIn: actualTimeIn,
        deviceInfo: { start: deviceInfo || null, end: null },
        location: { start: location || null, end: null },
        coffeeBreaks: [],
        lunchBreak: null,
      },
    });

    // Emit socket event so front-end can update in real time
    getIO().to(userId).emit("timeLogUpdated", { type: "timeIn", data: newTimeLog });

    return res.status(201).json({
      message: "Time in recorded successfully.",
      data: newTimeLog,
    });
  } catch (error) {
    console.error("Error in timeIn:", error);
    return res.status(500).json({ message: "Internal server error. Please try again later." });
  }
};

const timeOut = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = req.user.id;

    // Find active timelog
    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) {
      return res.status(400).json({ message: "No active time log found." });
    }

    const { localTimestamp, deviceInfo, location } = req.body;
    const actualTimeOut = localTimestamp ? new Date(localTimestamp) : new Date();

    // Optional: also verify location for timeOut
    const userLat = location?.latitude;
    const userLng = location?.longitude;
    const check = await verifyLocationRestriction(userId, userLat, userLng);
    if (!check.allowed) {
      return res.status(400).json({
        message: check.reason || "Failed location-based restriction check.",
      });
    }

    // Update record
    const updatedTimeLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: {
        timeOut: actualTimeOut,
        status: false,
        deviceInfo: {
          start: activeLog.deviceInfo.start || null,
          end: deviceInfo || null,
        },
        location: {
          start: activeLog.location.start || null,
          end: location || null,
        },
      },
    });

    // Emit socket event
    getIO().to(userId).emit("timeLogUpdated", { type: "timeOut", data: updatedTimeLog });

    return res.status(200).json({
      message: "Time out recorded successfully.",
      data: updatedTimeLog,
    });
  } catch (error) {
    console.error("Error in timeOut:", error);
    return res.status(500).json({ message: "Internal server error. Please try again later." });
  }
};

const getUserTimeLogs = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    const logs = await prisma.timeLog.findMany({
      where: { userId },
      orderBy: { timeIn: "desc" },
    });

    // Convert Date objects to ISO strings for JSON
    const formattedLogs = logs.map((log) => ({
      ...log,
      timeIn: log.timeIn ? log.timeIn.toISOString() : null,
      timeOut: log.timeOut ? log.timeOut.toISOString() : null,
    }));

    return res.status(200).json({
      message: "Time logs retrieved successfully.",
      data: formattedLogs,
    });
  } catch (error) {
    console.error("Error fetching user time logs:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteTimeLog = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;
    const timeLogId = req.params.id;

    const log = await prisma.timeLog.findUnique({ where: { id: timeLogId } });
    if (!log) return res.status(404).json({ message: "Time log not found." });
    if (log.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to delete this time log." });
    }

    await prisma.timeLog.delete({ where: { id: timeLogId } });
    getIO()
      .to(userId)
      .emit("timeLogUpdated", {
        type: "delete",
        data: { id: timeLogId },
      });

    return res.status(200).json({ message: "Time log deleted successfully." });
  } catch (error) {
    console.error("Error deleting time log:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// --- Coffee Break Endpoints ---
const coffeeBreakStart = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    // Optionally do location check if you want to enforce it
    // const { location } = req.body;
    // verifyLocationRestriction(...) => if not allowed => return res.status(400).json({...})

    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) {
      return res.status(400).json({ message: "No active time log found." });
    }

    let breaks = Array.isArray(activeLog.coffeeBreaks) ? activeLog.coffeeBreaks : [];
    // Prevent starting a new coffee break if one is already active
    if (breaks.find((b) => b.end === null)) {
      return res.status(400).json({ message: "A coffee break is already active." });
    }
    if (breaks.length >= 2) {
      return res.status(400).json({ message: "Maximum coffee breaks reached." });
    }

    const newBreak = {
      start: new Date().toISOString(),
      end: null,
    };
    breaks.push(newBreak);

    const updatedLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { coffeeBreaks: breaks },
    });

    getIO().to(userId).emit("timeLogUpdated", {
      type: "coffeeBreakStart",
      data: updatedLog,
    });

    return res.status(200).json({ message: "Coffee break started.", data: updatedLog });
  } catch (error) {
    console.error("Coffee break start error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const coffeeBreakEnd = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    // Optionally do location check

    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) {
      return res.status(400).json({ message: "No active time log found." });
    }

    let breaks = Array.isArray(activeLog.coffeeBreaks) ? activeLog.coffeeBreaks : [];
    const activeBreakIndex = breaks.findIndex((b) => b.end === null);
    if (activeBreakIndex === -1) {
      return res.status(400).json({ message: "No active coffee break to end." });
    }
    breaks[activeBreakIndex].end = new Date().toISOString();

    const updatedLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { coffeeBreaks: breaks },
    });

    getIO().to(userId).emit("timeLogUpdated", {
      type: "coffeeBreakEnd",
      data: updatedLog,
    });

    return res.status(200).json({ message: "Coffee break ended.", data: updatedLog });
  } catch (error) {
    console.error("Coffee break end error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// --- Lunch Break Endpoints ---
const lunchBreakStart = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    // Optionally do location check

    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) {
      return res.status(400).json({ message: "No active time log found." });
    }

    if (activeLog.lunchBreak && activeLog.lunchBreak.start && !activeLog.lunchBreak.end) {
      return res.status(400).json({ message: "Lunch break already started." });
    }

    const lunchData = {
      start: new Date().toISOString(),
      end: null,
    };
    const updatedLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { lunchBreak: lunchData },
    });

    getIO().to(userId).emit("timeLogUpdated", {
      type: "lunchBreakStart",
      data: updatedLog,
    });

    return res.status(200).json({ message: "Lunch break started.", data: updatedLog });
  } catch (error) {
    console.error("Lunch break start error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const lunchBreakEnd = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.user.id;

    // Optionally do location check

    const activeLog = await prisma.timeLog.findFirst({
      where: { userId, status: true },
    });
    if (!activeLog) {
      return res.status(400).json({ message: "No active time log found." });
    }
    if (!activeLog.lunchBreak || !activeLog.lunchBreak.start || activeLog.lunchBreak.end) {
      return res.status(400).json({ message: "No active lunch break to end." });
    }

    const updatedLunchBreak = {
      ...activeLog.lunchBreak,
      end: new Date().toISOString(),
    };

    const updatedLog = await prisma.timeLog.update({
      where: { id: activeLog.id },
      data: { lunchBreak: updatedLunchBreak },
    });

    getIO().to(userId).emit("timeLogUpdated", {
      type: "lunchBreakEnd",
      data: updatedLog,
    });

    return res.status(200).json({ message: "Lunch break ended.", data: updatedLog });
  } catch (error) {
    console.error("Lunch break end error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * GET  /api/timelogs
 * Admin/Super-admin – list every timelog in the company
 * Query‐params:
 *   employeeId   (string)
 *   departmentId (string)
 *   from, to     (YYYY-MM-DD)
 *   status       ("active" | "completed")
 */
const getCompanyTimeLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    /* ---------- build Prisma filter ---------- */
    const where = {
      user: { companyId }, // same tenant
    };

    if (req.query.employeeId) {
      where.userId = req.query.employeeId;
    }

    if (req.query.departmentId) {
      where.user = { ...where.user, departmentId: req.query.departmentId };
    }

    if (req.query.status === "active") where.status = true;
    if (req.query.status === "completed") where.status = false;

    if (req.query.from || req.query.to) {
      where.timeIn = {};
      if (req.query.from) where.timeIn.gte = new Date(`${req.query.from}T00:00:00Z`);
      if (req.query.to) where.timeIn.lte = new Date(`${req.query.to}T23:59:59Z`);
    }

    /* ---------- query DB ---------- */
    const logs = await prisma.timeLog.findMany({
      where,
      orderBy: { timeIn: "desc" },
      include: {
        user: {
          include: {
            profile: true,
            department: true,
            presence: true, // ← last known presence
          },
        },
      },
    });

    /* ---------- flatten / format ---------- */
    const data = logs.map((l) => ({
      id: l.id,
      userId: l.user.id,
      employeeName: `${l.user.profile?.firstName || ""} ${l.user.profile?.lastName || ""}`.trim(),
      email: l.user.email,
      department: l.user.department?.name || "—",
      timeIn: l.timeIn,
      timeOut: l.timeOut,
      status: l.status ? "active" : "completed",
      coffeeBreaks: l.coffeeBreaks || [],
      lunchBreak: l.lunchBreak || null,
      coffeeCount: (l.coffeeBreaks || []).length,
      lunchTaken: !!(l.lunchBreak && l.lunchBreak.end),
      presence: l.user.presence?.presenceStatus || "unknown",
      shiftToday: null,
    }));

    /* ---------- attach today’s shift (optional) ---------- */
    if (logs.length) {
      const uniqueUserIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))];

      const today = new Date(); // current local date-time
      const dayStart = new Date(today);
      dayStart.setHours(0, 0, 0, 0); // 00:00:00.000
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999); // 23:59:59.999

      const shiftRows = await prisma.userShift.findMany({
        where: {
          userId: { in: uniqueUserIds },
          assignedDate: { gte: dayStart, lte: dayEnd }, // proper Date objects
        },
        include: { shift: true },
      });

      const shiftMap = {};
      shiftRows.forEach((s) => {
        shiftMap[s.userId] = s.shift.shiftName;
      });

      data.forEach((d) => {
        d.shiftToday = shiftMap[d.userId] || "—";
      });
    }

    /* ---------- return ---------- */
    return res.status(200).json({ data });
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
