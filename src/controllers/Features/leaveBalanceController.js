// src/controllers/Features/leaveBalanceController.js
const { prisma } = require("@config/connection");

const adjustBalance = async (req, res) => {
  const { targetUserId, leaveTypes, hours } = req.body;
  if (
    !targetUserId ||
    !Array.isArray(leaveTypes) ||
    !leaveTypes.length ||
    typeof hours !== "number" ||
    hours === 0
  )
    return res
      .status(400)
      .json({
        message: "targetUserId, leaveTypes[] and non-zero hours are required",
      });

  const employee = await prisma.user.findFirst({
    where: { id: targetUserId, companyId: req.user.companyId },
  });
  if (!employee)
    return res.status(404).json({ message: "User not found in this company" });

  const policies = await prisma.leavePolicy.findMany({
    where: { companyId: req.user.companyId, leaveType: { in: leaveTypes } },
    select: { id: true, leaveType: true },
  });
  if (policies.length !== leaveTypes.length)
    return res
      .status(404)
      .json({ message: "One or more leave types not found" });

  const out = [];
  for (const pol of policies) {
    const bal = await prisma.leaveBalance.upsert({
      where: { userId_policyId: { userId: targetUserId, policyId: pol.id } },
      update: { balanceHours: { increment: hours } },
      create: {
        userId: targetUserId,
        policyId: pol.id,
        balanceHours: hours > 0 ? hours : 0,
      },
    });
    out.push({
      leaveType: pol.leaveType,
      balanceHours: bal.balanceHours.toNumber(),
    });
  }
  res.json({ data: out });
};

const listMatrix = async (req, res) => {
  const companyId = req.user.companyId;

  const users = await prisma.user.findMany({
    where: { companyId, status: "active" },
    select: {
      id: true,
      email: true,
      profile: { select: { firstName: true, lastName: true } },
    },
    orderBy: { email: "asc" },
  });

  const policies = await prisma.leavePolicy.findMany({
    where: { companyId },
    select: { id: true, leaveType: true },
    orderBy: { leaveType: "asc" },
  });

  const balances = await prisma.leaveBalance.findMany({
    where: { policy: { companyId } },
    select: { userId: true, policyId: true, balanceHours: true },
  });

  const map = {};
  balances.forEach((b) => {
    if (!map[b.userId]) map[b.userId] = {};
    map[b.userId][b.policyId] = b.balanceHours.toNumber();
  });

  const rows = users.map((u) => {
    const fullName =
      `${u.profile?.firstName || ""} ${u.profile?.lastName || ""}`.trim() ||
      u.email;
    const balObj = {};
    policies.forEach((p) => {
      const hrs = map[u.id]?.[p.id] ?? 0;
      balObj[p.leaveType] = (balObj[p.leaveType] || 0) + hrs;
    });
    return { userId: u.id, fullName, email: u.email, balances: balObj };
  });

  res.json({ data: rows, leaveTypes: policies.map((p) => p.leaveType) });
};

module.exports = { adjustBalance, listMatrix };
