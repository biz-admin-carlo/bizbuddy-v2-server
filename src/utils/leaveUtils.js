// src/utils/leaveUtils.js
const { prisma } = require("@config/connection");

async function calcRequestedHours(userId, startISO, endISO) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: true },
  });
  if (!user?.company) throw new Error("Company not found for user");

  const shiftHours = Number(user.company.defaultShiftHours || 8);
  const start = new Date(startISO);
  const end = new Date(endISO);
  const dayCount = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;

  return +(dayCount * shiftHours).toFixed(2);
}

function monthlyIncrement(policy, defaultShiftHours = 8) {
  const alloc = Number(policy.annualAllocation);
  const perYear =
    policy.accrualUnit === "days" ? alloc * defaultShiftHours : alloc;
  return +(perYear / 12).toFixed(2);
}

module.exports = { calcRequestedHours, monthlyIncrement };
