const { prisma } = require("@config/connection");

const submitContestPolicy = async (req, res) => {
  try {
    const {
      timeLogId,
      approverId,
      reason,
      description,
      currentClockIn,
      currentClockOut,
      requestedClockIn,
      requestedClockOut,
      submittedAt,
    } = req.body;

    if (!timeLogId || !requestedClockIn || !requestedClockOut) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const newContest = await prisma.contestTimeLog.create({
      data: {
        timeLogId,
        approverId,
        reason,
        description,
        currentClockIn: currentClockIn ? new Date(currentClockIn) : null,
        currentClockOut: currentClockOut ? new Date(currentClockOut) : null,
        requestedClockIn: new Date(requestedClockIn),
        requestedClockOut: new Date(requestedClockOut),
        submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
        requestDate: new Date(),
        status: "PENDING",
      },
    });

    console.log("[✅ Contest created]", newContest);

    return res.status(201).json({
      message: "Contest submitted successfully.",
      data: newContest,
    });
  } catch (error) {
    console.error("❌ Error submitting contest:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

const viewContestTimeLogs = async (req, res) => {
    try {
      const user = req.user;
      const { status, limit = 50, offset = 0 } = req.query;
  
      // Always restrict to current user's own records
      let where = {
        timeLog: { userId: user.id },
      };
  
      // Optional status filtering
      if (status && status !== "ALL") {
        where.status = status;
      }
  
      const contestLogs = await prisma.contestTimeLog.findMany({
        where,
        include: {
          timeLog: {
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
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      });
  
      const totalCount = await prisma.contestTimeLog.count({ where });
  
      return res.status(200).json({
        message: "Contest logs fetched successfully.",
        data: {
          contestLogs,
          pagination: {
            total: totalCount,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: parseInt(offset) + parseInt(limit) < totalCount,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching contest logs:", error);
      return res.status(500).json({ message: "Internal server error." });
    }
  };

  const viewAllContestTimeLogs = async (req, res) => {
    try {
      const user = req.user;
  
      let whereClause = {};
  
      // 🔹 Supervisor: show only their department/team
      if (user.role === "supervisor") {
        whereClause = {
          timeLog: {
            user: {
              departmentId: user.departmentId,
              companyId: user.companyId,
            },
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
          timeLog: {
            user: {
              companyId: user.companyId,
            },
          },
        };
      }
  
      const contestRequests = await prisma.contestTimeLog.findMany({
        where: whereClause,
        include: {
          timeLog: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  role: true,
                  departmentId: true,
                  profile: {
                    select: {
                      firstName: true,
                      lastName: true,
                    },
                  },
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
        orderBy: {
          submittedAt: "desc",
        },
      });
  
      const formattedData = contestRequests.map((contest) => ({
        id: contest.id,
        status: contest.status,
        reason: contest.reason,
        description: contest.description,
        currentClockIn: contest.currentClockIn,
        currentClockOut: contest.currentClockOut,
        requestedClockIn: contest.requestedClockIn,
        requestedClockOut: contest.requestedClockOut,
        submittedAt: contest.submittedAt,
        userDisplayName:
          contest.timeLog?.user?.profile
            ? `${contest.timeLog.user.profile.firstName} ${contest.timeLog.user.profile.lastName}`
            : contest.timeLog?.user?.email,
        approverDisplayName:
          contest.approver?.profile
            ? `${contest.approver.profile.firstName} ${contest.approver.profile.lastName}`
            : contest.approver?.email,
      }));
  
      return res.status(200).json({
        message: "Contest time logs retrieved successfully.",
        total: formattedData.length,
        data: formattedData,
      });
    } catch (error) {
      console.error("❌ Error fetching contest time logs:", error);
      return res
        .status(500)
        .json({ message: "Internal server error.", error: error.message });
    }
  };

  const deleteContestRequest = async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user;
  
      // Confirm the record exists and belongs to same company
      const contest = await prisma.contestTimeLog.findUnique({
        where: { id },
        include: {
          timeLog: {
            include: {
              user: true,
            },
          },
        },
      });
  
      if (!contest) {
        return res.status(404).json({ message: "Contest request not found." });
      }
  
      // Ensure same company (unless superadmin)
      if (
        user.role !== "superadmin" &&
        contest.timeLog?.user?.companyId !== user.companyId
      ) {
        return res.status(403).json({
          message: "You are not authorized to delete this contest request.",
        });
      }
  
      // Perform deletion
      await prisma.contestTimeLog.delete({
        where: { id },
      });
  
      return res.status(200).json({ message: "Contest request deleted successfully." });
    } catch (error) {
      console.error("❌ Error deleting contest request:", error);
      return res
        .status(500)
        .json({ message: "Internal server error.", error: error.message });
    }
  };

  const rejectContestRequest = async (req, res) => {
    try {
      const { id } = req.params;
      const approverId = req.user.id;
  
      // Check if the record exists
      const contest = await prisma.contestTimeLog.findUnique({
        where: { id },
        include: {
          timeLog: {
            include: {
              user: true,
            },
          },
        },
      });
  
      if (!contest) {
        return res.status(404).json({ message: "Contest request not found." });
      }
  
      // Verify access: same company or superadmin
      if (
        req.user.role !== "superadmin" &&
        contest.timeLog?.user?.companyId !== req.user.companyId
      ) {
        return res.status(403).json({ message: "Unauthorized to reject this contest request." });
      }
  
      // Update record to mark as rejected
      const updated = await prisma.contestTimeLog.update({
        where: { id },
        data: {
          status: "REJECTED",
          approverId,
          approvedAt: new Date(),
          approvedReason: "Rejected by admin/supervisor",
        },
        include: {
          timeLog: {
            include: {
              user: true,
            },
          },
          approver: true,
        },
      });
  
      return res.status(200).json({
        message: "Contest request rejected successfully.",
        data: updated,
      });
    } catch (error) {
      console.error("❌ Error rejecting contest request:", error);
      return res.status(500).json({
        message: "Internal server error.",
        error: error.message,
      });
    }
  };

  const approveContestRequest = async (req, res) => {
    try {
      const { id } = req.params;
      const approverId = req.user.id;
  
      // Find the contest request
      const contest = await prisma.contestTimeLog.findUnique({
        where: { id },
        include: {
          timeLog: {
            include: {
              user: true,
            },
          },
        },
      });
  
      if (!contest) {
        return res.status(404).json({ message: "Contest request not found." });
      }
  
      // Security: Verify same company or superadmin
      if (
        req.user.role !== "superadmin" &&
        contest.timeLog?.user?.companyId !== req.user.companyId
      ) {
        return res
          .status(403)
          .json({ message: "Unauthorized to approve this contest request." });
      }
  
      // Update status to APPROVED
      const updated = await prisma.contestTimeLog.update({
        where: { id },
        data: {
          status: "APPROVED",
          approverId,
          approvedAt: new Date(),
          approvedReason: "Approved by admin/supervisor",
        },
        include: {
          timeLog: {
            include: {
              user: true,
            },
          },
          approver: true,
        },
      });
  
      return res.status(200).json({
        message: "Contest request approved successfully.",
        data: updated,
      });
    } catch (error) {
      console.error("❌ Error approving contest request:", error);
      return res.status(500).json({
        message: "Internal server error.",
        error: error.message,
      });
    }
  };
  
  
module.exports = { 
    submitContestPolicy,
    viewContestTimeLogs,
    viewAllContestTimeLogs,
    deleteContestRequest,
    rejectContestRequest,
    approveContestRequest
};
