// src/controllers/Features/overtimeController.js

const { prisma } = require("@config/connection");
const { createNotification } = require("@services/notificationService");

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
      totalProjectedHours,
    } = req.body;

    if (!timeLogId || !approverId) {
      return res
        .status(400)
        .json({ message: "timeLogId and approverId are required." });
    }

    if (!requestedHours || parseFloat(requestedHours) <= 0) {
      return res
        .status(400)
        .json({ message: "requestedHours must be greater than 0." });
    }

    // Validate timeLog exists and belongs to user
    const timeLog = await prisma.timeLog.findUnique({
      where: { id: timeLogId },
      include: {
        user: {
          include: {
            department: true,
            employmentDetail: true,
          },
        },
      },
    });

    if (!timeLog || timeLog.userId !== req.user.id) {
      return res.status(404).json({ message: "TimeLog not found." });
    }

    // Validate approver
    const approver = await prisma.user.findFirst({
      where: {
        id: approverId,
        companyId: req.user.companyId,
        role: { in: ["admin", "supervisor", "superadmin"] },
        status: "active",
      },
    });

    if (!approver) {
      return res.status(400).json({ message: "Invalid or inactive approver." });
    }

    if (approverId === req.user.id) {
      return res
        .status(400)
        .json({ message: "You cannot approve your own overtime request." });
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
    const userDepartmentId =
      timeLog.user.departmentId || timeLog.user.employmentDetail?.departmentId;

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
            timeOut: true,
          },
        },
        requester: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Log the activity for audit trail
    await prisma.userActivity.create({
      data: {
        userId: req.user.id,
        activityDescription: `Submitted overtime request for ${requestedHours}h on ${new Date(
          timeLog.timeIn
        ).toLocaleDateString()}`,
      },
    });

    // Notify management
    try {
      const employeeName = newOT.requester?.profile
        ? `${newOT.requester.profile.firstName || ''} ${newOT.requester.profile.lastName || ''}`.trim()
        : newOT.requester?.email || 'An employee';
      const otDate = new Date(newOT.timeLog.timeIn).toLocaleDateString();
      const managementUsers = await prisma.user.findMany({
        where: { companyId: req.user.companyId, role: { in: ['admin', 'superadmin', 'supervisor'] }, status: 'active' },
        select: { id: true, departmentId: true },
      });
      await Promise.all(managementUsers.map(manager =>
        createNotification({
          userId: manager.id,
          companyId: req.user.companyId,
          departmentId: manager.departmentId,
          notificationCode: 'OVERTIME_REQUEST_SUBMITTED',
          title: 'Overtime Request Submitted',
          message: `${employeeName} submitted an overtime request for ${otDate} (${requestedHours} hrs).`,
          payload: { overtimeId: newOT.id, requesterId: req.user.id },
        })
      ));
    } catch (notifError) {
      console.error('❌ Failed to send OT submission notification:', notifError);
    }

    return res.status(201).json({
      message: "Overtime request submitted successfully.",
      data: {
        ...format(newOT),
        projectedClockOut,
        totalProjectedHours,
        originalClockOut: timeLog.timeOut,
      },
    });
  } catch (err) {
    console.error("submitOvertime error:", err);
    return res.status(500).json({
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

const getMyOT = async (req, res) => {
  try {
    const ots = await prisma.overtime.findMany({
      where: { requesterId: req.user.id },
      include: {
        timeLog: true,
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
        },
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
      include: { timeLog: { select: { timeIn: true } } },
    });
    if (!ot) {
      return res
        .status(404)
        .json({ message: "OT request not found or already processed." });
    }

    const updated = await prisma.overtime.update({
      where: { id },
      data: { status: newStatus, approverComments },
    });

    // Notify the requesting employee
    try {
      const otDate = ot.timeLog?.timeIn
        ? new Date(ot.timeLog.timeIn).toLocaleDateString()
        : 'your recent date';
      await createNotification({
        userId: ot.requesterId,
        companyId: ot.companyId,
        departmentId: ot.departmentId || null,
        notificationCode: newStatus === 'approved' ? 'OVERTIME_REQUEST_APPROVED' : 'OVERTIME_REQUEST_REJECTED',
        title: newStatus === 'approved' ? 'Overtime Request Approved' : 'Overtime Request Rejected',
        message: `Your overtime request for ${otDate} has been ${newStatus}.`,
        payload: { overtimeId: ot.id },
      });
    } catch (notifError) {
      console.error('❌ Failed to send OT decision notification:', notifError);
    }

    return res
      .status(200)
      .json({ message: `Overtime ${newStatus}.`, data: format(updated) });
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
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status; // optional filter

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
            companyId: req.user.companyId,
          },
        };
        break;

      case "supervisor":
        // Supervisor/Department Head sees all OT requests from their department
        whereClause = {
          requester: {
            departmentId: req.user.departmentId,
          },
        };
        break;

      default:
        // Fallback: only show where user is the direct approver
        whereClause = {
          approverId: req.user.id,
        };
    }

    if (status) whereClause.status = status;

    const [ots, total] = await Promise.all([
      prisma.overtime.findMany({
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
              company: { select: { id: true, name: true } },
            },
          },
          approver: {
            select: { id: true, email: true, username: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.overtime.count({ where: whereClause }),
    ]);

    return res.status(200).json({
      data: ots.map(format),
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err) {
    console.error("getAllOT:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const detectSmartOvertime = async (req, res) => {
  try {
    const { id: userId, role, companyId } = req.user;
    const isAdmin = ["admin", "superadmin", "hr"].includes(role.toLowerCase());

    // Default date window: last 30 days
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - 30);

    // 1️⃣ Build TimeLog query (token-based)
    const whereClause = isAdmin ? { user: { companyId } } : { userId };

    whereClause.timeIn = { gte: fromDate, lte: toDate };

    const timeLogs = await prisma.timeLog.findMany({
      where: whereClause,
      include: {
        user: {
          include: {
            profile: true,
            department: true,
          },
        },
      },
      orderBy: { timeIn: "desc" },
    });

    if (!timeLogs.length) {
      return res
        .status(200)
        .json({ data: [], message: "No timelogs found for analysis." });
    }

    // 2️⃣ Fetch all userShifts for date range
    const userIds = [...new Set(timeLogs.map((t) => t.userId))];
    const userShifts = await prisma.userShift.findMany({
      where: {
        userId: { in: userIds },
        assignedDate: { gte: fromDate, lte: toDate },
      },
      include: { shift: true },
    });

    // Create lookup map
    const shiftMap = new Map();
    for (const s of userShifts) {
      const key = `${s.userId}-${s.assignedDate.toISOString().slice(0, 10)}`;
      shiftMap.set(key, s);
    }

    // 3️⃣ (Optional) Fetch company settings for minimum OT threshold
    const companyRecord = await prisma.company.findFirst({
      where: { id: companyId },
    });
    const minOvertimeMinutes = companyRecord?.minimumOvertimeMinutes ?? 15;

    const results = [];

    // 4️⃣ Loop through logs and compare scheduled vs actual
    for (const log of timeLogs) {
      if (!log.timeOut) continue; // skip active sessions

      const logDate = log.timeIn.toISOString().slice(0, 10);
      const shift = shiftMap.get(`${log.userId}-${logDate}`);

      const scheduledStart =
        shift?.customStartTime || shift?.shift?.startTime || null;
      const scheduledEnd =
        shift?.customEndTime || shift?.shift?.endTime || null;

      const actualStart = new Date(log.timeIn);
      const actualEnd = new Date(log.timeOut);
      const elapsedMins = (actualEnd - actualStart) / 60000;

      let overtimeMins = 0;
      let type = "Scheduled";

      if (scheduledEnd && scheduledStart) {
        const schedStartRef = new Date(actualStart);
        const schedEndRef = new Date(actualStart);

        // Align scheduled times to actual date (since shift times are usually "time only")
        const [startHours, startMins] = [
          new Date(scheduledStart).getHours(),
          new Date(scheduledStart).getMinutes(),
        ];
        const [endHours, endMins] = [
          new Date(scheduledEnd).getHours(),
          new Date(scheduledEnd).getMinutes(),
        ];

        schedStartRef.setHours(startHours, startMins, 0, 0);
        schedEndRef.setHours(endHours, endMins, 0, 0);

        // Calculate duration difference
        const schedDurationMins = (schedEndRef - schedStartRef) / 60000;
        overtimeMins = Math.max(0, elapsedMins - schedDurationMins);
      } else {
        // No scheduled shift - treat full duration as potential OT
        console.log("HELOO");
        type = "Unscheduled";
        overtimeMins = elapsedMins;
      }

      // Skip trivial OTs (below threshold)
      if (overtimeMins < minOvertimeMinutes) continue;

      results.push({
        timeLogId: log.id,
        userId: log.userId,
        employeeName: `${log.user.profile?.firstName || ""} ${
          log.user.profile?.lastName || ""
        }`.trim(),
        department: log.user.department?.name || "—",
        date: logDate,
        scheduledStart: scheduledStart
          ? new Date(scheduledStart).toISOString()
          : null,
        scheduledEnd: scheduledEnd
          ? new Date(scheduledEnd).toISOString()
          : null,
        actualStart: log.timeIn,
        actualEnd: log.timeOut,
        elapsedMins,
        overtimeMins,
        overtimeHours: +(overtimeMins / 60).toFixed(2),
        type, // "Scheduled" or "Unscheduled"
        detectedAt: new Date().toISOString(),
      });
    }
    console.log(results);
    // 5️⃣ Return detections
    return res.status(200).json({
      message: "Smart overtime detection complete.",
      meta: { count: results.length },
      data: results,
    });
  } catch (err) {
    console.error("detectSmartOvertime:", err);
    return res.status(500).json({
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
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
  detectSmartOvertime,
};
