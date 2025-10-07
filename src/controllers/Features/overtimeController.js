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
    const { 
      timeLogId, 
      approverId, 
      requesterReason, 
      requestedHours, 
      lateHours: lateHoursFromBody,
      originalClockOut,
      projectedClockOut,
      totalProjectedHours
    } = req.body;

    if (!timeLogId || !approverId) {
      return res.status(400).json({ message: "timeLogId and approverId are required." });
    }

    if (!requestedHours || parseFloat(requestedHours) <= 0) {
      return res.status(400).json({ message: "requestedHours must be greater than 0." });
    }

    // Validate timeLog exists and belongs to user
    const timeLog = await prisma.timeLog.findUnique({ 
      where: { id: timeLogId },
      include: {
        user: {
          include: {
            department: true,
            employmentDetail: true
          }
        }
      }
    });
    
    if (!timeLog || timeLog.userId !== req.user.id) {
      return res.status(404).json({ message: "TimeLog not found." });
    }

    // Check for duplicate requests
    const existingRequest = await prisma.overtime.findFirst({
      where: { timeLogId, requesterId: req.user.id },
    });
    
    if (existingRequest) {
      return res.status(400).json({ message: "Overtime request already exists for this TimeLog." });
    }

    // Validate approver
    const approver = await prisma.user.findFirst({
      where: {
        id: approverId,
        companyId: req.user.companyId,
        role: { in: ["admin", "supervisor", "superadmin"] },
        status: 'active'
      },
    });
    
    if (!approver) {
      return res.status(400).json({ message: "Invalid or inactive approver." });
    }

    if (approverId === req.user.id) {
      return res.status(400).json({ message: "You cannot approve your own overtime request." });
    }

    // Calculate late hours if not provided
    let lateHours = null;
    if (lateHoursFromBody != null) {
      lateHours = Number(lateHoursFromBody);
    } else {
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
      lateHours = calcLate != null ? calcLate : 0;
    }

    // Determine user's department
    const userDepartmentId = timeLog.user.departmentId || timeLog.user.employmentDetail?.departmentId;

    // Create overtime request
    const newOT = await prisma.overtime.create({
      data: {
        timeLogId,
        requesterId: req.user.id,
        approverId,
        requesterReason: requesterReason?.trim() || null,
        requestedHours: parseFloat(requestedHours),
        lateHours,
        companyId: req.user.companyId,
        departmentId: userDepartmentId || null,
      },
      include: {
        timeLog: {
          select: {
            timeIn: true,
            timeOut: true
          }
        },
        requester: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    // Log the activity for audit trail
    await prisma.userActivity.create({
      data: {
        userId: req.user.id,
        activityDescription: `Submitted overtime request for ${requestedHours}h on ${new Date(timeLog.timeIn).toLocaleDateString()}`
      }
    });

    return res.status(201).json({ 
      message: "Overtime request submitted successfully.",
      data: {
        ...format(newOT),
        projectedClockOut,
        totalProjectedHours,
        originalClockOut: timeLog.timeOut
      }
    });

  } catch (err) {
    console.error("submitOvertime error:", err);
    return res.status(500).json({ 
      message: "Internal server error.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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
    let whereClause = {};

    // Build filter based on user role
    switch (req.user.role) {
      case "superadmin":
        // Superadmin sees ALL overtime requests across all companies
        whereClause = {};
        break;

      case "admin":
        // Admin sees all OT requests from their assigned company
        whereClause = {
          requester: {
            companyId: req.user.companyId
          }
        };
        break;

      case "supervisor":
        // Supervisor/Department Head sees all OT requests from their department
        whereClause = {
          requester: {
            departmentId: req.user.departmentId
          }
        };
        break;

      default:
        // Fallback: only show where user is the direct approver
        whereClause = {
          approverId: req.user.id
        };
    }

    const ots = await prisma.overtime.findMany({
      where: whereClause,
      include: {
        timeLog: true,
        requester: { 
          select: { 
            id: true, 
            email: true, 
            username: true,
            departmentId: true,
            companyId: true,
            department: { select: { id: true, name: true } },
            company: { select: { id: true, name: true } }
          } 
        },
        approver: {
          select: { id: true, email: true, username: true }
        }
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
