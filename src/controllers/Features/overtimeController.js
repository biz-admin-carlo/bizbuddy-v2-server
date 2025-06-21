// src/controllers/Features/overtimeController.js

const { prisma } = require("@config/connection");

function format(ot) {
  return {
    ...ot,
    createdAt: ot.createdAt.toISOString(),
    updatedAt: ot.updatedAt.toISOString(),
  };
}

function calculateLateHours(timeLog, userShift) {
  if (!timeLog?.timeIn || !userShift?.shift?.startTime) return null;

  const punchIn = new Date(timeLog.timeIn);
  const shiftRef = new Date(userShift.shift.startTime);
  const shiftStart = new Date(punchIn);
  shiftStart.setHours(shiftRef.getHours(), shiftRef.getMinutes(), 0, 0);

  if (punchIn <= shiftStart) return 0;

  const minsLate = (punchIn - shiftStart) / 60000;
  return +(minsLate / 60).toFixed(2); // two-decimal hours
}

const submitOvertime = async (req, res) => {
  try {
    const { timeLogId, approverId, requesterReason, requestedHours, lateHours: lateHoursFromBody } = req.body;

    if (!timeLogId || !approverId) {
      return res.status(400).json({ message: "timeLogId and approverId are required." });
    }

    const timeLog = await prisma.timeLog.findUnique({ where: { id: timeLogId } });
    if (!timeLog || timeLog.userId !== req.user.id) {
      return res.status(404).json({ message: "TimeLog not found." });
    }

    const dup = await prisma.overtime.findFirst({
      where: { timeLogId, requesterId: req.user.id },
    });
    if (dup) {
      return res.status(400).json({ message: "OT request already exists for this TimeLog." });
    }

    const approver = await prisma.user.findFirst({
      where: {
        id: approverId,
        companyId: req.user.companyId,
        role: { in: ["admin", "supervisor", "superadmin"] },
      },
    });
    if (!approver || approverId === req.user.id) {
      return res.status(400).json({ message: "Invalid approver." });
    }

    const dayStart = new Date(timeLog.timeIn);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const userShift = await prisma.userShift.findFirst({
      where: {
        userId: req.user.id,
        assignedDate: { gte: dayStart, lte: dayEnd },
      },
      include: { shift: true },
    });

    const calcLate = calculateLateHours(timeLog, userShift);
    const lateHours = lateHoursFromBody != null ? Number(lateHoursFromBody) : calcLate != null ? calcLate : null;
    const newOT = await prisma.overtime.create({
      data: {
        timeLogId,
        requesterId: req.user.id,
        approverId,
        requesterReason: requesterReason ?? null,
        requestedHours: requestedHours ?? null,
        lateHours,
      },
    });

    return res.status(201).json({ message: "Overtime request submitted.", data: format(newOT) });
  } catch (err) {
    console.error("submitOvertime:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getMyOT = async (req, res) => {
  try {
    const ots = await prisma.overtime.findMany({
      where: { requesterId: req.user.id },
      include: {
        timeLog: true,
        approver: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ data: ots.map(format) });
  } catch (err) {
    console.error("getMyOT:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getPendingOT = async (req, res) => {
  try {
    const ots = await prisma.overtime.findMany({
      where: { approverId: req.user.id, status: "pending" },
      include: {
        timeLog: true,
        requester: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ data: ots.map(format) });
  } catch (err) {
    console.error("getPendingOT:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const decideOT = (newStatus) => async (req, res) => {
  try {
    const { id } = req.params;
    const { approverComments } = req.body;

    const ot = await prisma.overtime.findFirst({
      where: { id, approverId: req.user.id, status: "pending" },
    });
    if (!ot) {
      return res.status(404).json({ message: "OT request not found or already processed." });
    }

    const updated = await prisma.overtime.update({
      where: { id },
      data: { status: newStatus, approverComments },
    });

    return res.status(200).json({ message: `Overtime ${newStatus}.`, data: format(updated) });
  } catch (err) {
    console.error(`${newStatus}OT:`, err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const approveOT = decideOT("approved");
const rejectOT = decideOT("rejected");

const deleteOT = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.overtime.delete({ where: { id } });
    return res.status(200).json({ message: "OT request deleted." });
  } catch (err) {
    console.error("deleteOT:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllOT = async (req, res) => {
  try {
    const ots = await prisma.overtime.findMany({
      where: { approverId: req.user.id },
      include: {
        timeLog: true,
        requester: { select: { id: true, email: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ data: ots.map(format) });
  } catch (err) {
    console.error("getAllOT:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  submitOvertime,
  getMyOT,
  getPendingOT,
  approveOT,
  rejectOT,
  deleteOT,
  getAllOT,
};
