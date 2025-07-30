// src/controllers/Features/leaveController.js

const { prisma } = require("@config/connection");
const { calcRequestedHours } = require("@utils/leaveUtils");

const _format = (l) => ({
  ...l,
  startDate: l.startDate.toISOString(),
  endDate: l.endDate.toISOString(),
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

const submitLeaveRequest = async (req, res) => {
  const { type, fromDate, toDate, approverId, leaveReason } = req.body;
  if (!type || !fromDate || !toDate || !approverId)
    return res.status(400).json({ message: "All fields are required." });
  if (new Date(fromDate) > new Date(toDate))
    return res
      .status(400)
      .json({ message: "From Date cannot be after To Date." });
  const approver = await prisma.user.findFirst({
    where: {
      id: approverId,
      companyId: req.user.companyId,
      role: { in: ["admin", "supervisor", "superadmin"] },
    },
  });
  if (!approver)
    return res.status(400).json({ message: "Invalid approver selected." });
  if (approverId === req.user.id)
    return res
      .status(400)
      .json({ message: "Cannot set yourself as approver." });
  const data = await prisma.leave.create({
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
  res.status(201).json({ data });
};

const getUserLeaves = async (req, res) => {
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
  const data = leaves.map((l) => ({
    ..._format(l),
    approver: l.approver
      ? {
          ...l.approver,
          name: l.approver.profile
            ? `${l.approver.profile.firstName || ""} ${
                l.approver.profile.lastName || ""
              }`.trim()
            : l.approver.username,
        }
      : null,
  }));
  res.json({ data });
};

const getPendingLeavesForApprover = async (req, res) => {
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
  const data = leaves.map((l) => ({
    ..._format(l),
    requester: l.User
      ? {
          ...l.User,
          name: l.User.profile
            ? `${l.User.profile.firstName || ""} ${
                l.User.profile.lastName || ""
              }`.trim()
            : l.User.username,
        }
      : null,
  }));
  res.json({ data });
};

const approveLeave = async (req, res) => {
  const leaveId = req.params.id;
  const { approverComments } = req.body;
  const leave = await prisma.leave.findFirst({
    where: { id: leaveId, approverId: req.user.id, status: "pending" },
  });
  if (!leave)
    return res
      .status(404)
      .json({ message: "Leave request not found or already processed." });
  const policy = await prisma.leavePolicy.findFirst({
    where: { companyId: req.user.companyId, leaveType: leave.leaveType },
  });
  if (!policy)
    return res.status(400).json({ message: "Leave policy not configured." });
  const requestedHours = await calcRequestedHours(
    leave.userId,
    leave.startDate,
    leave.endDate
  );
  const bal = await prisma.leaveBalance.upsert({
    where: { userId_policyId: { userId: leave.userId, policyId: policy.id } },
    update: {},
    create: { userId: leave.userId, policyId: policy.id, balanceHours: 0 },
  });
  if (!policy.negativeAllowed && Number(bal.balanceHours) < requestedHours)
    return res
      .status(400)
      .json({
        message: `Insufficient leave balance (${bal.balanceHours} h left, need ${requestedHours} h).`,
      });
  await prisma.leaveBalance.update({
    where: { id: bal.id },
    data: { balanceHours: { decrement: requestedHours } },
  });
  const data = await prisma.leave.update({
    where: { id: leaveId },
    data: { status: "approved", approverComments },
  });
  res.json({ data: _format(data) });
};

const rejectLeave = async (req, res) => {
  const leaveId = req.params.id;
  const { approverComments } = req.body;
  const leave = await prisma.leave.findFirst({
    where: { id: leaveId, approverId: req.user.id, status: "pending" },
  });
  if (!leave)
    return res
      .status(404)
      .json({ message: "Leave request not found or already processed." });
  const data = await prisma.leave.update({
    where: { id: leaveId },
    data: { status: "rejected", approverComments },
  });
  res.json({ data: _format(data) });
};

const getApprovers = async (req, res) => {
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
  const data = approvers.map((a) => ({
    ...a,
    name: a.profile
      ? `${a.profile.firstName || ""} ${a.profile.lastName || ""}`.trim()
      : a.username,
  }));
  res.json({ data });
};

const deleteLeave = async (req, res) => {
  const leaveId = req.params.id;
  const leave = await prisma.leave.findFirst({
    where: { id: leaveId, approverId: req.user.id },
  });
  if (!leave)
    return res.status(404).json({ message: "Leave request not found." });
  await prisma.leave.delete({ where: { id: leaveId } });
  res.json({ message: "deleted" });
};

const getLeavesForApprover = async (req, res) => {
  const { status } = req.query;
  if (
    status &&
    !["pending", "approved", "rejected"].includes(status.toLowerCase())
  )
    return res.status(400).json({ message: "Invalid status filter." });
  const where = { approverId: req.user.id };
  if (status) where.status = status.toLowerCase();
  const leaves = await prisma.leave.findMany({
    where,
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
  const data = leaves.map((l) => ({
    ..._format(l),
    requester: l.User
      ? {
          ...l.User,
          name: l.User.profile
            ? `${l.User.profile.firstName || ""} ${
                l.User.profile.lastName || ""
              }`.trim()
            : l.User.username,
        }
      : null,
  }));
  res.json({ data });
};

const getBalance = async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ message: "type is required" });
  const policies = await prisma.leavePolicy.findMany({
    where: { companyId: req.user.companyId, leaveType: type },
    include: { company: true },
  });
  if (!policies.length)
    return res.status(404).json({ message: "Leave policy not found" });
  let total = 0;
  for (const p of policies) {
    const bal = await prisma.leaveBalance.findFirst({
      where: { userId: req.user.id, policyId: p.id },
    });
    total += bal ? Number(bal.balanceHours) : 0;
  }
  res.json({
    data: {
      leaveType: type,
      balanceHours: total,
      shiftHours: Number(policies[0].company.defaultShiftHours || 8),
    },
  });
};

const listBalances = async (req, res) => {
  const policies = await prisma.leavePolicy.findMany({
    where: { companyId: req.user.companyId },
    include: { company: true, balances: { where: { userId: req.user.id } } },
  });
  const map = {};
  policies.forEach((p) => {
    const sum = p.balances.reduce((s, b) => s + Number(b.balanceHours), 0);
    map[p.leaveType] = {
      leaveType: p.leaveType,
      balanceHours: sum,
      shiftHours: Number(p.company.defaultShiftHours || 8),
    };
  });
  res.json({ data: Object.values(map) });
};

module.exports = {
  submitLeaveRequest,
  getUserLeaves,
  getPendingLeavesForApprover,
  approveLeave,
  rejectLeave,
  getApprovers,
  deleteLeave,
  getLeavesForApprover,
  getBalance,
  listBalances,
};
