// src/controllers/Features/leaveController.js

const { prisma } = require("@config/connection");

const submitLeaveRequest = async (req, res) => {
  try {
    // Destructure 'leaveReason' as well
    const { type, fromDate, toDate, approverId, leaveReason } = req.body;

    if (!type || !fromDate || !toDate || !approverId) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const approver = await prisma.user.findFirst({
      where: {
        id: approverId,
        companyId: req.user.companyId,
        role: { in: ["admin", "supervisor", "superadmin"] },
      },
    });
    if (!approver) {
      return res.status(400).json({ message: "Invalid approver selected." });
    }
    if (approverId === req.user.id) {
      return res.status(400).json({ message: "Cannot set yourself as approver." });
    }
    if (new Date(fromDate) > new Date(toDate)) {
      return res.status(400).json({ message: "From Date cannot be after To Date." });
    }

    const leave = await prisma.leave.create({
      data: {
        userId: req.user.id,
        approverId: approver.id,
        leaveType: type,
        startDate: new Date(fromDate).toISOString(),
        endDate: new Date(toDate).toISOString(),
        status: "pending",
        leaveReason,
      },
    });

    return res.status(201).json({ message: "Leave request submitted successfully.", data: leave });
  } catch (error) {
    console.error("Error in submitLeaveRequest:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getUserLeaves = async (req, res) => {
  try {
    const leaves = await prisma.leave.findMany({
      where: { userId: req.user.id },
      include: {
        approver: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    // <-- ADDED for ISO fix
    const formattedLeaves = leaves.map((leave) => ({
      ...leave,
      startDate: leave.startDate.toISOString(),
      endDate: leave.endDate.toISOString(),
      createdAt: leave.createdAt.toISOString(),
      updatedAt: leave.updatedAt.toISOString(),
      approver: leave.approver
        ? {
            ...leave.approver,
            name: leave.approver.profile
              ? `${leave.approver.profile.firstName || ""} ${leave.approver.profile.lastName || ""}`.trim()
              : leave.approver.username,
          }
        : null,
    }));

    return res.status(200).json({
      message: "User leaves retrieved successfully.",
      data: formattedLeaves,
    });
  } catch (error) {
    console.error("Error in getUserLeaves:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getPendingLeavesForApprover = async (req, res) => {
  try {
    const leaves = await prisma.leave.findMany({
      where: { approverId: req.user.id, status: "pending" },
      include: {
        User: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // <-- ADDED for ISO fix
    const formattedLeaves = leaves.map((leave) => ({
      ...leave,
      startDate: leave.startDate.toISOString(),
      endDate: leave.endDate.toISOString(),
      createdAt: leave.createdAt.toISOString(),
      updatedAt: leave.updatedAt.toISOString(),
      requester: leave.User
        ? {
            ...leave.User,
            name: leave.User.profile ? `${leave.User.profile.firstName || ""} ${leave.User.profile.lastName || ""}`.trim() : leave.User.username,
          }
        : null,
    }));

    return res.status(200).json({ message: "Pending leaves retrieved successfully.", data: formattedLeaves });
  } catch (error) {
    console.error("Error in getPendingLeavesForApprover:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const approveLeave = async (req, res) => {
  try {
    const leaveId = req.params.id;
    // Pull approverComments from req.body (optional)
    const { approverComments } = req.body;

    const leave = await prisma.leave.findFirst({
      where: { id: leaveId, approverId: req.user.id, status: "pending" },
    });
    if (!leave) {
      return res.status(404).json({ message: "Leave request not found or already processed." });
    }

    // Update with optional approverComments
    const updatedLeave = await prisma.leave.update({
      where: { id: leaveId },
      data: {
        status: "approved",
        approverComments, // <--- include comments if provided
      },
    });

    const finalLeave = {
      ...updatedLeave,
      startDate: updatedLeave.startDate.toISOString(),
      endDate: updatedLeave.endDate.toISOString(),
      createdAt: updatedLeave.createdAt.toISOString(),
      updatedAt: updatedLeave.updatedAt.toISOString(),
    };

    return res.status(200).json({ message: "Leave approved successfully.", data: finalLeave });
  } catch (error) {
    console.error("Error in approveLeave:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const rejectLeave = async (req, res) => {
  try {
    const leaveId = req.params.id;
    // Pull approverComments from req.body (optional)
    const { approverComments } = req.body;

    const leave = await prisma.leave.findFirst({
      where: { id: leaveId, approverId: req.user.id, status: "pending" },
    });
    if (!leave) {
      return res.status(404).json({ message: "Leave request not found or already processed." });
    }

    // Update with optional approverComments
    const updatedLeave = await prisma.leave.update({
      where: { id: leaveId },
      data: {
        status: "rejected",
        approverComments, // <--- include comments if provided
      },
    });

    const finalLeave = {
      ...updatedLeave,
      startDate: updatedLeave.startDate.toISOString(),
      endDate: updatedLeave.endDate.toISOString(),
      createdAt: updatedLeave.createdAt.toISOString(),
      updatedAt: updatedLeave.updatedAt.toISOString(),
    };

    return res.status(200).json({ message: "Leave rejected successfully.", data: finalLeave });
  } catch (error) {
    console.error("Error in rejectLeave:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getApprovers = async (req, res) => {
  try {
    const approvers = await prisma.user.findMany({
      where: {
        companyId: req.user.companyId,
        role: { in: ["admin", "supervisor", "superadmin"] },
        NOT: { id: req.user.id },
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const formattedApprovers = approvers.map((approver) => ({
      ...approver,
      name: approver.profile ? `${approver.profile.firstName || ""} ${approver.profile.lastName || ""}`.trim() : approver.username,
    }));
    return res.status(200).json({ message: "Approvers retrieved successfully.", data: formattedApprovers });
  } catch (error) {
    console.error("Error in getApprovers:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteLeave = async (req, res) => {
  try {
    const leaveId = req.params.id;
    // Verify that the leave exists and that it belongs to the current approver.
    const leave = await prisma.leave.findFirst({
      where: { id: leaveId, approverId: req.user.id },
    });
    if (!leave) {
      return res.status(404).json({ message: "Leave request not found." });
    }
    await prisma.leave.delete({
      where: { id: leaveId },
    });
    return res.status(200).json({ message: "Leave deleted successfully." });
  } catch (error) {
    console.error("Error in deleteLeave:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getLeavesForApprover = async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !["pending", "approved", "rejected"].includes(status.toLowerCase())) {
      return res.status(400).json({ message: "Invalid status filter." });
    }
    const query = { approverId: req.user.id };
    if (status) query.status = status.toLowerCase();
    const leaves = await prisma.leave.findMany({
      where: query,
      include: {
        User: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    // <-- ADDED for ISO fix
    const formattedLeaves = leaves.map((leave) => ({
      ...leave,
      startDate: leave.startDate.toISOString(),
      endDate: leave.endDate.toISOString(),
      createdAt: leave.createdAt.toISOString(),
      updatedAt: leave.updatedAt.toISOString(),
      requester: leave.User
        ? {
            ...leave.User,
            email: leave.User.email,
            username: leave.User.username,
            name: leave.User.profile ? `${leave.User.profile.firstName || ""} ${leave.User.profile.lastName || ""}`.trim() : leave.User.username,
          }
        : null,
    }));

    return res.status(200).json({ message: "Leaves retrieved successfully.", data: formattedLeaves });
  } catch (error) {
    console.error("Error in getLeavesForApprover:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  submitLeaveRequest,
  getUserLeaves,
  getPendingLeavesForApprover,
  approveLeave,
  rejectLeave,
  getApprovers,
  getLeavesForApprover,
  deleteLeave,
};
