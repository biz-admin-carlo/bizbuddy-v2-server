// src/controllers/Features/leaveController.js
// Alternative approach without schema changes - manually fetch leave policies

const { prisma } = require("@config/connection");
const { calcRequestedHours } = require("@utils/leaveUtils");
const { createNotification } = require("@services/notificationService");

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

  // FIX: Find the policy by leave type name to get its ID
  const policy = await prisma.leavePolicy.findFirst({
    where: {
      companyId: req.user.companyId,
      leaveType: type, // type is the name like "Personal Leave"
    },
  });
  if (!policy)
    return res.status(400).json({ message: "Leave policy not found for this type." });

  // Store the policy ID, not the type name
  const data = await prisma.leave.create({
    data: {
      userId: req.user.id,
      approverId: approver.id,
      leaveType: policy.id, // ✅ Store the policy ID
      startDate: new Date(fromDate).toISOString(),
      endDate: new Date(toDate).toISOString(),
      status: "pending",
      leaveReason,
    },
  });

  // Notify all management users in the company
  try {
    const employee = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { profile: { select: { firstName: true, lastName: true } } },
    });
    const employeeName = employee?.profile
      ? `${employee.profile.firstName || ''} ${employee.profile.lastName || ''}`.trim()
      : req.user.email;
    const startDateStr = new Date(fromDate).toLocaleDateString();
    const endDateStr = new Date(toDate).toLocaleDateString();

    const managementUsers = await prisma.user.findMany({
      where: { companyId: req.user.companyId, role: { in: ['admin', 'superadmin', 'supervisor'] }, status: 'active' },
      select: { id: true, departmentId: true },
    });
    await Promise.all(managementUsers.map(manager =>
      createNotification({
        userId: manager.id,
        companyId: req.user.companyId,
        departmentId: manager.departmentId,
        notificationCode: 'LEAVE_REQUEST_SUBMITTED',
        title: 'Leave Request Submitted',
        message: `${employeeName} submitted a leave request (${type}) from ${startDateStr} to ${endDateStr}.`,
        payload: { leaveId: data.id, leaveType: type, startDate: fromDate, endDate: toDate, requesterId: req.user.id },
      })
    ));
  } catch (notifError) {
    console.error('❌ Failed to send leave submission notification:', notifError);
  }

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

  // Fetch all unique leave policy IDs
  const policyIds = [...new Set(leaves.map(l => l.leaveType).filter(Boolean))];
  const policies = await prisma.leavePolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, leaveType: true },
  });

  // Create a map for quick lookup
  const policyMap = {};
  policies.forEach(p => {
    policyMap[p.id] = p.leaveType;
  });

  const data = leaves.map((l) => ({
    ..._format(l),
    leaveType: policyMap[l.leaveType] || l.leaveType, // Replace ID with actual name
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

// FIXED: Manually fetch leave policy names
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

  // Fetch all unique leave policy IDs
  const policyIds = [...new Set(leaves.map(l => l.leaveType).filter(Boolean))];
  const policies = await prisma.leavePolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, leaveType: true },
  });

  // Create a map for quick lookup
  const policyMap = {};
  policies.forEach(p => {
    policyMap[p.id] = p.leaveType;
  });

  const data = leaves.map((l) => ({
    ..._format(l),
    leaveType: policyMap[l.leaveType] || l.leaveType, // Replace ID with actual name
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
  
  // Step 1: Find the leave request
  const leave = await prisma.leave.findFirst({
    where: { id: leaveId, approverId: req.user.id, status: "pending" },
  });
  
  if (!leave) {
    console.error(`Leave not found: ${leaveId}, approver: ${req.user.id}`);
    return res
      .status(404)
      .json({ message: "Leave request not found or already processed." });
  }

  console.log(`Processing leave approval:`, {
    leaveId: leave.id,
    leaveType: leave.leaveType,
    userId: leave.userId,
  });

  // Step 2: Find the policy - handle both ID and name
  let policy = await prisma.leavePolicy.findFirst({
    where: { id: leave.leaveType },
  });

  // If not found by ID, try finding by name (for legacy data)
  if (!policy) {
    console.warn(`Policy not found by ID "${leave.leaveType}", trying by name...`);
    policy = await prisma.leavePolicy.findFirst({
      where: {
        companyId: req.user.companyId,
        leaveType: leave.leaveType,
      },
    });
  }

  if (!policy) {
    console.error(`Policy not found for leaveType: "${leave.leaveType}"`);
    return res.status(400).json({ 
      message: "Leave policy not configured.",
      debug: {
        leaveType: leave.leaveType,
        companyId: req.user.companyId,
      }
    });
  }

  console.log(`Found policy:`, {
    policyId: policy.id,
    policyType: policy.leaveType,
  });

  // Step 3: Calculate requested hours
  const requestedHours = await calcRequestedHours(
    leave.userId,
    leave.startDate,
    leave.endDate
  );

  console.log(`Requested hours: ${requestedHours}`);

  // Step 4: Check/create balance
  const bal = await prisma.leaveBalance.upsert({
    where: { userId_policyId: { userId: leave.userId, policyId: policy.id } },
    update: {},
    create: { userId: leave.userId, policyId: policy.id, balanceHours: 0 },
  });

  console.log(`Current balance:`, {
    balanceHours: bal.balanceHours,
    requestedHours: requestedHours,
    negativeAllowed: policy.negativeAllowed,
  });

  // Step 5: Check if sufficient balance
  if (!policy.negativeAllowed && Number(bal.balanceHours) < requestedHours) {
    console.error(`Insufficient balance: ${bal.balanceHours}h available, ${requestedHours}h needed`);
    return res.status(400).json({
      message: `Insufficient leave balance (${bal.balanceHours} h left, need ${requestedHours} h).`,
      debug: {
        available: bal.balanceHours,
        requested: requestedHours,
        leaveType: policy.leaveType,
      }
    });
  }

  // Step 6: Deduct balance
  await prisma.leaveBalance.update({
    where: { id: bal.id },
    data: { balanceHours: { decrement: requestedHours } },
  });

  console.log(`Balance updated: ${Number(bal.balanceHours) - requestedHours}h remaining`);

  // Step 7: Approve the leave
  const data = await prisma.leave.update({
    where: { id: leaveId },
    data: { status: "approved", approverComments },
  });

  console.log(`Leave approved: ${leaveId}`);

  // Notify the requesting employee
  try {
    const leaveUser = await prisma.user.findUnique({
      where: { id: leave.userId },
      select: { departmentId: true },
    });
    const startDateStr = new Date(leave.startDate).toLocaleDateString();
    const endDateStr = new Date(leave.endDate).toLocaleDateString();
    await createNotification({
      userId: leave.userId,
      companyId: req.user.companyId,
      departmentId: leaveUser?.departmentId || null,
      notificationCode: 'LEAVE_REQUEST_APPROVED',
      title: 'Leave Request Approved',
      message: `Your leave request from ${startDateStr} to ${endDateStr} has been approved.`,
      payload: { leaveId, startDate: leave.startDate, endDate: leave.endDate },
    });
  } catch (notifError) {
    console.error('❌ Failed to send leave approval notification:', notifError);
  }

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

  // Notify the requesting employee
  try {
    const leaveUser = await prisma.user.findUnique({
      where: { id: leave.userId },
      select: { departmentId: true },
    });
    const startDateStr = new Date(leave.startDate).toLocaleDateString();
    const endDateStr = new Date(leave.endDate).toLocaleDateString();
    await createNotification({
      userId: leave.userId,
      companyId: req.user.companyId,
      departmentId: leaveUser?.departmentId || null,
      notificationCode: 'LEAVE_REQUEST_REJECTED',
      title: 'Leave Request Rejected',
      message: `Your leave request from ${startDateStr} to ${endDateStr} has been rejected.`,
      payload: { leaveId, startDate: leave.startDate, endDate: leave.endDate },
    });
  } catch (notifError) {
    console.error('❌ Failed to send leave rejection notification:', notifError);
  }

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

// FIXED: Manually fetch leave policy names
const getLeavesForApprover = async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  if (
    status &&
    !["pending", "approved", "rejected"].includes(status.toLowerCase())
  )
    return res.status(400).json({ message: "Invalid status filter." });
  const where = { approverId: req.user.id };
  if (status) where.status = status.toLowerCase();

  const [leaves, total] = await Promise.all([
    prisma.leave.findMany({
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
      take: limit,
      skip: offset,
    }),
    prisma.leave.count({ where }),
  ]);

  // Fetch all unique leave policy IDs
  const policyIds = [...new Set(leaves.map(l => l.leaveType).filter(Boolean))];
  const policies = await prisma.leavePolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, leaveType: true },
  });

  // Create a map for quick lookup
  const policyMap = {};
  policies.forEach(p => {
    policyMap[p.id] = p.leaveType;
  });

  const data = leaves.map((l) => ({
    ..._format(l),
    leaveType: policyMap[l.leaveType] || l.leaveType, // Replace ID with actual name
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
  res.json({ data, pagination: { total, limit, offset, hasMore: offset + limit < total } });
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