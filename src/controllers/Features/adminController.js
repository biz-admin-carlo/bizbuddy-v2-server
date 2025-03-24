// src/controllers/Features/adminController.js

const { prisma } = require("@config/connection");

const getCompanyUsers = async (req, res) => {
  try {
    const admin = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { companyId: true },
    });
    if (!admin) {
      return res.status(404).json({ message: "Admin not found." });
    }
    const users = await prisma.users.findMany({
      where: { companyId: admin.companyId },
      select: {
        id: true,
        email: true,
        firstName: true,
        middleName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ message: "Users fetched successfully.", data: users });
  } catch (error) {
    console.error("Error in getCompanyUsers:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { getCompanyUsers };
