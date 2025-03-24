// src/controllers/Account/accountDeleteController.js

const { prisma } = require("@config/connection");

async function deleteAccountController(req, res, next) {
  try {
    // Get authenticated user info from the auth middleware.
    const { id: userId, companyId } = req.user;
    if (!companyId) {
      return res.status(400).json({ message: "No associated company found for this user." });
    }

    // Verify that the company exists and that the owner is deleting the account.
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    if (company.userId !== userId) {
      return res.status(403).json({ message: "Only the company owner can delete the account." });
    }

    // Get all user IDs associated with the company.
    const users = await prisma.user.findMany({ where: { companyId } });
    const userIds = users.map((u) => u.id);

    // Run all deletions in a transaction.
    await prisma.$transaction([
      // Delete payments linked to the company (using companyName).
      prisma.payment.deleteMany({ where: { companyName: company.name } }),
      // Delete subscriptions for the company.
      prisma.subscription.deleteMany({ where: { companyId } }),
      // Delete user-related data.
      prisma.userRate.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.deduction.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.payroll.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.timeLog.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.locationRestriction.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.userActivity.deleteMany({ where: { userId: { in: userIds } } }),
      // Delete leaves where the user is the requester.
      prisma.leave.deleteMany({ where: { userId: { in: userIds } } }),
      // Also delete leaves where the user acted as approver.
      prisma.leave.deleteMany({ where: { approverId: { in: userIds } } }),
      // Delete user shifts.
      prisma.userShift.deleteMany({ where: { userId: { in: userIds } } }),
      // Delete shift recurrences for shifts associated with these users.
      prisma.shiftRecurrence.deleteMany({ where: { userShift: { userId: { in: userIds } } } }),
      // Delete user profiles.
      prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } }),
      // Delete departments belonging to the company.
      prisma.department.deleteMany({ where: { companyId } }),
      // Delete all users in the company.
      prisma.user.deleteMany({ where: { companyId } }),
      // Finally, delete the company record.
      prisma.company.delete({ where: { id: companyId } }),
    ]);

    return res.status(200).json({ message: "Account and all related data deleted successfully." });
  } catch (error) {
    next(error);
  }
}

module.exports = deleteAccountController;
