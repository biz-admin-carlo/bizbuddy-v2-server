// src/controllers/Features/employeeLocationRestrictionController.js

const { prisma } = require("@config/connection");

const assignLocationToEmployee = async (req, res) => {
  try {
    const { employeeId, locationId, restrictionEnabled } = req.body;
    const employee = await prisma.users.findUnique({ where: { id: Number(employeeId) } });
    if (!employee) {
      return res.status(404).json({ message: "Employee not found." });
    }
    if (restrictionEnabled && !locationId) {
      return res.status(400).json({ message: "Location ID is required when enabling restriction." });
    }
    let location = null;
    if (restrictionEnabled && locationId) {
      location = await prisma.locations.findUnique({ where: { id: Number(locationId) } });
      if (!location) {
        return res.status(404).json({ message: "Location not found." });
      }
    }
    let setting = await prisma.employeeLocationRestriction.findFirst({
      where: { employeeId: Number(employeeId) },
    });
    if (setting) {
      setting = await prisma.employeeLocationRestriction.update({
        where: { id: setting.id },
        data: {
          restrictionEnabled: restrictionEnabled,
          locationId: restrictionEnabled ? Number(locationId) : null,
        },
      });
      return res.status(200).json({ message: "Employee location restriction updated successfully.", data: setting });
    } else {
      if (!restrictionEnabled) {
        return res.status(400).json({ message: "Cannot disable restriction without an existing setting." });
      }
      setting = await prisma.employeeLocationRestriction.create({
        data: {
          employeeId: Number(employeeId),
          restrictionEnabled: restrictionEnabled,
          locationId: Number(locationId),
        },
      });
      return res.status(201).json({ message: "Employee location restriction created successfully.", data: setting });
    }
  } catch (error) {
    console.error("Error in assignLocationToEmployee:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const toggleLocationRestriction = async (req, res) => {
  try {
    const { employeeId } = req.body;
    const setting = await prisma.employeeLocationRestriction.findFirst({
      where: { employeeId: Number(employeeId) },
    });
    if (!setting) {
      return res.status(404).json({ message: "Employee location restriction not found. Cannot toggle restriction." });
    }
    const updatedSetting = await prisma.employeeLocationRestriction.update({
      where: { id: setting.id },
      data: { restrictionEnabled: !setting.restrictionEnabled },
    });
    return res.status(200).json({ message: "Employee location restriction toggled successfully.", data: updatedSetting });
  } catch (error) {
    console.error("Error in toggleLocationRestriction:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getEmployeeLocationRestriction = async (req, res) => {
  try {
    const { employeeId } = req.query;
    const settings = await prisma.employeeLocationRestriction.findMany({
      where: { employeeId: Number(employeeId) },
      include: { location: true },
    });
    return res.status(200).json({ message: "Employee location restriction retrieved successfully.", data: settings });
  } catch (error) {
    console.error("Error in getEmployeeLocationRestriction:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  assignLocationToEmployee,
  toggleLocationRestriction,
  getEmployeeLocationRestriction,
};
