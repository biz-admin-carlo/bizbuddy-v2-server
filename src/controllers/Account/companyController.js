// src/controllers/Account/companyController.js

const { prisma } = require("@config/connection");

const getAllCompanies = async (req, res) => {
  try {
    const companies = await prisma.companies.findMany({
      select: {
        id: true,
        name: true,
        domain: true,
        country: true,
        currency: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ message: "Companies retrieved successfully.", data: companies });
  } catch (error) {
    console.error("Error in getAllCompanies:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    if (!companyId || isNaN(companyId)) {
      return res.status(400).json({ message: "Invalid company ID." });
    }
    const company = await prisma.companies.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        domain: true,
        country: true,
        currency: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    return res.status(200).json({ message: "Company retrieved successfully.", data: company });
  } catch (error) {
    console.error("Error in getCompanyById:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const createCompany = async (req, res) => {
  try {
    const { name, domain, country, currency, language } = req.body;
    if (!name || !domain || !country || !currency || !language) {
      return res.status(400).json({ message: "Name, domain, country, currency, and language are required." });
    }
    const existingCompany = await prisma.companies.findUnique({
      where: { domain },
    });
    if (existingCompany) {
      return res.status(400).json({ message: "Company with this domain already exists." });
    }
    const newCompany = await prisma.companies.create({
      data: { name, domain, country, currency, language },
    });
    return res.status(201).json({ message: "Company created successfully.", data: newCompany });
  } catch (error) {
    console.error("Error in createCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateCompany = async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const { name, domain, country, currency, language } = req.body;
    if (!name && !domain && !country && !currency && !language) {
      return res.status(400).json({ message: "At least one field must be provided for update." });
    }
    const company = await prisma.companies.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    if (domain && domain !== company.domain) {
      const existingCompany = await prisma.companies.findUnique({ where: { domain } });
      if (existingCompany) {
        return res.status(400).json({ message: "Company with this domain already exists." });
      }
    }
    const updatedCompany = await prisma.companies.update({
      where: { id: companyId },
      data: {
        name: name || company.name,
        domain: domain || company.domain,
        country: country || company.country,
        currency: currency || company.currency,
        language: language || company.language,
      },
    });
    return res.status(200).json({ message: "Company updated successfully.", data: updatedCompany });
  } catch (error) {
    console.error("Error in updateCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const company = await prisma.companies.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    await prisma.companies.delete({ where: { id: companyId } });
    return res.status(200).json({ message: "Company deleted successfully." });
  } catch (error) {
    console.error("Error in deleteCompany:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getCompanyUserCount = async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    if (!companyId || isNaN(companyId)) {
      return res.status(400).json({ message: "Invalid company ID." });
    }
    const userCount = await prisma.users.count({ where: { companyId } });
    return res.status(200).json({ message: "Company user count retrieved successfully.", data: { companyId, userCount } });
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
