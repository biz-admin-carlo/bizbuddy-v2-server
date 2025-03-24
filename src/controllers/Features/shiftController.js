// src/controllers/Features/shiftController.js

const { prisma } = require("@config/connection");

const createShift = async (req, res) => {
  try {
    const { shiftName, startTime, endTime, crossesMidnight, differentialMultiplier } = req.body;
    if (!shiftName || !startTime || !endTime) {
      return res.status(400).json({ message: "Required fields are missing." });
    }
    const shift = await prisma.shift.create({
      data: {
        shiftName,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        crossesMidnight,
        differentialMultiplier,
        companyId: req.user.companyId,
      },
    });
    return res.status(201).json({ message: "Shift created successfully.", data: shift });
  } catch (error) {
    console.error("Error creating shift:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getShifts = async (req, res) => {
  try {
    const shifts = await prisma.shift.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" },
    });
    const formattedShifts = shifts.map((shift) => ({
      ...shift,
      startTime: shift.startTime.toISOString(),
      endTime: shift.endTime.toISOString(),
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString(),
    }));
    return res.status(200).json({ message: "Shifts retrieved successfully.", data: formattedShifts });
  } catch (error) {
    console.error("Error fetching shifts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateShift = async (req, res) => {
  try {
    const shiftId = req.params.id;
    const { shiftName, startTime, endTime, crossesMidnight, differentialMultiplier } = req.body;
    const updatedShift = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        shiftName,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        crossesMidnight,
        differentialMultiplier,
      },
    });
    return res.status(200).json({ message: "Shift updated successfully.", data: updatedShift });
  } catch (error) {
    console.error("Error updating shift:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteShift = async (req, res) => {
  try {
    const shiftId = req.params.id;
    await prisma.$transaction([
      prisma.shiftSchedule.deleteMany({ where: { shiftId } }),
      prisma.userShift.deleteMany({ where: { shiftId } }),
      prisma.shift.delete({ where: { id: shiftId } }),
    ]);
    return res.status(200).json({ message: "Shift and its related schedules and user shifts deleted successfully." });
  } catch (error) {
    console.error("Error deleting shift:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { createShift, getShifts, updateShift, deleteShift };
