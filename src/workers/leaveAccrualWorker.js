// src/workers/leaveAccrualWorker.js
const cron = require("node-cron");
const { prisma } = require("@config/connection");
const { monthlyIncrement } = require("@utils/leaveUtils");
const dayjs = require("dayjs");

function scheduleLeaveAccrual() {
  cron.schedule("0 2 * * *", async () => {
    const today = dayjs().startOf("day");
    const firstOfMonth = today.date() === 1;

    if (!firstOfMonth) return;

    try {
      const policies = await prisma.leavePolicy.findMany({
        where: { accrualFrequency: "monthly" },
        include: { company: true },
      });

      for (const p of policies) {
        const incr = monthlyIncrement(
          p,
          Number(p.company.defaultShiftHours || 8)
        );
        const employees = await prisma.user.findMany({
          where: { companyId: p.companyId, status: "active" },
          select: { id: true },
        });

        for (const emp of employees) {
          await prisma.leaveBalance.upsert({
            where: {
              userId_policyId: { userId: emp.id, policyId: p.id },
            },
            update: {
              balanceHours: { increment: incr },
              lastAccrualAt: today.toDate(),
            },
            create: {
              userId: emp.id,
              policyId: p.id,
              balanceHours: incr,
              lastAccrualAt: today.toDate(),
            },
          });
        }
      }
      console.log("[LeaveAccrual] Success");
    } catch (err) {
      console.error("[LeaveAccrual] Error:", err);
    }
  });
}

module.exports = { scheduleLeaveAccrual };
