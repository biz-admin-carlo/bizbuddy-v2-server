// src/controllers/Features/requestPunchLogController.js

const { prisma } = require("@config/connection");

const submitRequestPunchLog = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      requestedDate,
      requestedClockIn,
      requestedClockOut,
      approverId,
      reason,
      description,
      estimatedDuration,
      estimatedNetHours,
    } = req.body;

    // Validation
    if (!requestedDate || !requestedClockIn || !requestedClockOut || !approverId) {
      return res.status(400).json({ 
        message: "Missing required fields: requestedDate, requestedClockIn, requestedClockOut, approverId" 
      });
    }

    // Check if a time log already exists for this date
    const existingLog = await prisma.timeLog.findFirst({
      where: {
        userId,
        timeIn: {
          gte: new Date(requestedDate + "T00:00:00"),
          lt: new Date(new Date(requestedDate).setDate(new Date(requestedDate).getDate() + 1)),
        },
      },
    });

    if (existingLog) {
      return res.status(409).json({ 
        message: "A punch log already exists for this date. Use 'Contest Times' to modify it instead." 
      });
    }

    // Check for duplicate pending request
    const existingRequest = await prisma.requestedTimeLog.findFirst({
      where: {
        userId,
        requestedDate: new Date(requestedDate),
        status: "PENDING",
      },
    });

    if (existingRequest) {
      return res.status(409).json({ 
        message: "You already have a pending request for this date." 
      });
    }

    // Validate times
    const clockIn = new Date(requestedClockIn);
    const clockOut = new Date(requestedClockOut);

    if (clockIn >= clockOut) {
      return res.status(400).json({ 
        message: "Clock-in time must be before clock-out time." 
      });
    }

    // Create the request
    const newRequest = await prisma.requestedTimeLog.create({
      data: {
        userId,
        approverId,
        requestedDate: new Date(requestedDate),
        requestedClockIn: clockIn,
        requestedClockOut: clockOut,
        reason,
        description,
        estimatedDuration: estimatedDuration ? parseInt(estimatedDuration) : null,
        estimatedNetHours: estimatedNetHours ? parseFloat(estimatedNetHours) : null,
        status: "PENDING",
        submittedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    console.log("[✅ Punch log request created]", newRequest);

    return res.status(201).json({
      message: "Punch log request submitted successfully.",
      data: newRequest,
    });
  } catch (error) {
    console.error("❌ Error submitting punch log request:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

const viewMyRequestedPunchLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    let where = { userId };

    if (status && status !== "ALL") {
      where.status = status;
    }

    const requests = await prisma.requestedTimeLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const totalCount = await prisma.requestedTimeLog.count({ where });

    return res.status(200).json({
      message: "Requested punch logs fetched successfully.",
      data: {
        requests,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + parseInt(limit) < totalCount,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching requested punch logs:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

const viewAllRequestedPunchLogs = async (req, res) => {
  try {
    const user = req.user;

    let whereClause = {};

    // 🔹 Supervisor: show only their department/team
    if (user.role === "supervisor") {
      whereClause = {
        user: {
          departmentId: user.departmentId,
          companyId: user.companyId,
        },
      };
    }
    // 🔹 Admin/Manager/Owner/Superadmin: show entire company
    else if (
      user.role === "admin" ||
      user.role === "manager" ||
      user.role === "owner" ||
      user.role === "superadmin"
    ) {
      whereClause = {
        user: {
          companyId: user.companyId,
        },
      };
    }

    const requests = await prisma.requestedTimeLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            departmentId: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { submittedAt: "desc" },
    });

    const formattedData = requests.map((req) => ({
      id: req.id,
      status: req.status,
      reason: req.reason,
      description: req.description,
      requestedDate: req.requestedDate,
      requestedClockIn: req.requestedClockIn,
      requestedClockOut: req.requestedClockOut,
      estimatedDuration: req.estimatedDuration,
      estimatedNetHours: req.estimatedNetHours,
      submittedAt: req.submittedAt,
      approvedAt: req.approvedAt,
      userDisplayName: req.user?.profile
        ? `${req.user.profile.firstName} ${req.user.profile.lastName}`
        : req.user?.email,
      approverDisplayName: req.approver?.profile
        ? `${req.approver.profile.firstName} ${req.approver.profile.lastName}`
        : req.approver?.email,
    }));

    return res.status(200).json({
      message: "Requested punch logs retrieved successfully.",
      total: formattedData.length,
      data: formattedData,
    });
  } catch (error) {
    console.error("❌ Error fetching all requested punch logs:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

const approveRequestedPunchLog = async (req, res) => {
  try {
    const { id } = req.params;
    const approverId = req.user.id;

    const request = await prisma.requestedTimeLog.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found." });
    }

    // Security check
    if (
      req.user.role !== "superadmin" &&
      request.user.companyId !== req.user.companyId
    ) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    // Check if punch log already exists (race condition check)
    const existingLog = await prisma.timeLog.findFirst({
      where: {
        userId: request.userId,
        timeIn: {
          gte: new Date(request.requestedDate.toISOString().split('T')[0] + "T00:00:00"),
          lt: new Date(new Date(request.requestedDate).setDate(request.requestedDate.getDate() + 1)),
        },
      },
    });

    if (existingLog) {
      return res.status(409).json({ 
        message: "A punch log already exists for this date." 
      });
    }

    // Create the actual time log
    const newTimeLog = await prisma.timeLog.create({
      data: {
        userId: request.userId,
        timeIn: request.requestedClockIn,
        timeOut: request.requestedClockOut,
        status: false, // Completed
        coffeeBreaks: [],
        lunchBreak: {},
        // Add any other default fields your timeLog requires
      },
    });

    // Update request status
    const updatedRequest = await prisma.requestedTimeLog.update({
      where: { id },
      data: {
        status: "APPROVED",
        approverId,
        approvedAt: new Date(),
        createdTimeLogId: newTimeLog.id, // Link to created log
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return res.status(200).json({
      message: "Punch log request approved and time log created successfully.",
      data: {
        request: updatedRequest,
        timeLog: newTimeLog,
      },
    });
  } catch (error) {
    console.error("❌ Error approving request:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

const rejectRequestedPunchLog = async (req, res) => {
  try {
    const { id } = req.params;
    const approverId = req.user.id;
    const { rejectionReason } = req.body;

    const request = await prisma.requestedTimeLog.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found." });
    }

    if (
      req.user.role !== "superadmin" &&
      request.user.companyId !== req.user.companyId
    ) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    const updated = await prisma.requestedTimeLog.update({
      where: { id },
      data: {
        status: "REJECTED",
        approverId,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || "Rejected by approver",
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return res.status(200).json({
      message: "Punch log request rejected successfully.",
      data: updated,
    });
  } catch (error) {
    console.error("❌ Error rejecting request:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

const deleteRequestedPunchLog = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const request = await prisma.requestedTimeLog.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found." });
    }

    // Only allow deletion if: own request, or admin/superadmin
    if (
      request.userId !== user.id &&
      user.role !== "admin" &&
      user.role !== "superadmin"
    ) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    await prisma.requestedTimeLog.delete({ where: { id } });

    return res.status(200).json({ 
      message: "Punch log request deleted successfully." 
    });
  } catch (error) {
    console.error("❌ Error deleting request:", error);
    return res.status(500).json({ 
      message: "Internal server error.", 
      error: error.message 
    });
  }
};

module.exports = {
  submitRequestPunchLog,
  viewMyRequestedPunchLogs,
  viewAllRequestedPunchLogs,
  approveRequestedPunchLog,
  rejectRequestedPunchLog,
  deleteRequestedPunchLog,
};