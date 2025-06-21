// src/controllers/Account/companyController.js
const { prisma } = require("@config/connection");

const currentSubSelect = {
  take: 1,
  orderBy: { startDate: "desc" },
  where: {
    OR: [{ active: true }, { endDate: { gt: new Date() } }],
  },
  select: { startDate: true, endDate: true },
};

const baseSelect = {
  id: true,
  name: true,
  country: true,
  currency: true,
  language: true,
  createdAt: true,
  updatedAt: true,
  Subscription: currentSubSelect,
};

const getAllCompanies = async (_req, res) => {
  try {
    const companies = await prisma.company.findMany({
      select: baseSelect,
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ data: companies });
  } catch (error) {
    console.error("Error in getAllCompanies:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: {
        ...baseSelect,
        Subscription: { orderBy: { startDate: "desc" }, include: { plan: true } },
      },
    });
    if (!company) return res.status(404).json({ message: "Company not found." });
    return res.status(200).json({ data: company });
  } catch (error) {
    console.error("Error in getCompanyById:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const createCompany = async (req, res) => {
  try {
    const { name, country, currency, language } = req.body;

    if (!name || !country || !currency || !language) {
      return res.status(400).json({ message: "Name, country, currency and language are required." });
    }

    const newCompany = await prisma.company.create({
      data: { name, country, currency, language },
    });

    return res.status(201).json({ message: "Company created successfully.", data: newCompany });
  } catch (error) {
    console.error("Error in createCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateCompany = async (req, res) => {
  try {
    const companyId = req.params.id;
    const { name, country, currency, language } = req.body;

    if (!name && !country && !currency && !language) {
      return res.status(400).json({ message: "At least one field must be provided for update." });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ message: "Company not found." });

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { name, country, currency, language },
      select: baseSelect,
    });

    return res.status(200).json({ message: "Company updated successfully.", data: updated });
  } catch (error) {
    console.error("Error in updateCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const companyId = req.params.id;
    await prisma.company.delete({ where: { id: companyId } });
    return res.status(200).json({ message: "Company deleted successfully." });
  } catch (error) {
    console.error("Error in deleteCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getCompanyUserCount = async (req, res) => {
  try {
    const companyId = req.params.id;
    const count = await prisma.user.count({ where: { companyId } });
    return res.status(200).json({ data: { companyId, userCount: count } });
  } catch (error) {
    console.error("Error in getCompanyUserCount:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyUserCount,
};
