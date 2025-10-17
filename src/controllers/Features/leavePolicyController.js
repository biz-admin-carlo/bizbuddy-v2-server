// src/controllers/Features/leavePolicyController.js
const { prisma } = require("@config/connection");

const getPolicies = async (req, res) => {
  const data = await prisma.leavePolicy.findMany({
    where: { companyId: req.user.companyId },
  });
  res.json({ data });
};

const createPolicy = async (req, res) => {
  const { leaveType } = req.body;
  const exists = await prisma.leavePolicy.findFirst({
    where: { companyId: req.user.companyId, leaveType },
  });
  if (exists)
    return res.status(409).json({ message: "Leave type already exists" });

  const data = await prisma.leavePolicy.create({
    data: {
      companyId: req.user.companyId,
      leaveType,
      annualAllocation: 0,
      accrualFrequency: "none",
      accrualUnit: "hours",
    },
  });
  res.status(201).json({ data });
};

const updatePolicy = async (req, res) => {
  const { id } = req.params;
  const data = await prisma.leavePolicy.update({
    where: { id, companyId: req.user.companyId },
    data: { leaveType: req.body.leaveType },
  });
  res.json({ data });
};

const deletePolicy = async (req, res) => {
  const { id } = req.params;
  await prisma.leavePolicy.delete({
    where: { id, companyId: req.user.companyId },
  });
  res.json({ message: "deleted" });
};

const getAvailablePolicies = async (req, res) => {
  try {
    console.log('Fetching policies for user:', req.user.id, 'company:', req.user.companyId);
    
    const policies = await prisma.leavePolicy.findMany({
      where: { 
        companyId: req.user.companyId 
      },
      select: {
        id: true,
        leaveType: true,
        annualAllocation: true,
        accrualUnit: true,
        accrualFrequency: true,
        carryOverAllowed: true,
        carryOverLimit: true,
        negativeAllowed: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        leaveType: 'asc' 
      }
    });
        
    res.json({
      success: true,
      data: policies
    });
  } catch (error) {
    console.error('Error fetching available policies:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available leave policies",
      error: error.message
    });
  }
};

module.exports = { getPolicies, createPolicy, updatePolicy, deletePolicy, getAvailablePolicies };
