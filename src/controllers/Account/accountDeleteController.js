// src/controllers/Account/accountDeleteController.js

const { prisma } = require("@config/connection");

async function deleteAccountController(req, res, next) {
  try {
    const { id: userId, companyId } = req.user;
    if (!companyId) {
      return res.status(400).json({ message: "No associated company found for this user." });
    }
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    if (company.userId !== userId) {
      return res.status(403).json({ message: "Only the company owner can delete the account." });
    }
    const users = await prisma.user.findMany({ where: { companyId } });
    const userIds = users.map((u) => u.id);

    await prisma.$transaction([
      prisma.payment.deleteMany({ where: { companyName: company.name } }),
      prisma.subscription.deleteMany({ where: { companyId } }),
      prisma.userRate.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.deduction.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.payroll.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.timeLog.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.locationRestriction.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.userActivity.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.leave.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.leave.deleteMany({ where: { approverId: { in: userIds } } }),
      prisma.userShift.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.shiftRecurrence.deleteMany({ where: { userShift: { userId: { in: userIds } } } }),
      prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.department.deleteMany({ where: { companyId } }),
      prisma.user.deleteMany({ where: { companyId } }),
      prisma.company.delete({ where: { id: companyId } }),
    ]);

    return res.status(200).json({ message: "Account and all related data deleted successfully." });
  } catch (error) {
    next(error);
  }
}

module.exports = deleteAccountController;
