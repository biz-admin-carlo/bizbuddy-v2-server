// src/controllers/Features/shiftController.js

const { prisma } = require("@config/connection");

/**
 * Create a new shift template
 */
const createShift = async (req, res) => {
  try {
    const { shiftName, startTime, endTime, differentialMultiplier, timeZone } = req.body;
    const { companyId } = req.user;

    // Validation
    if (!shiftName || !startTime || !endTime) {
      return res.status(400).json({ 
        message: "Missing required fields: shiftName, startTime, endTime" 
      });
    }

    // Get company timezone if not provided
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { timeZone: true }
    });

    const shiftTimeZone = timeZone || company?.timeZone || "UTC";

    // Handle HH:MM format
    let start, end;
    
    // Check if it's HH:MM format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    
    if (timeRegex.test(startTime) && timeRegex.test(endTime)) {
      // HH:MM format
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      
      // Create naive datetime directly in UTC
      start = new Date(Date.UTC(1970, 0, 1, startHour, startMin, 0));
      end = new Date(Date.UTC(1970, 0, 1, endHour, endMin, 0));
    } else if (startTime.includes('T') && endTime.includes('T')) {
      // ISO string format (legacy support)
      start = new Date(startTime);
      end = new Date(endTime);
    } else {
      return res.status(400).json({
        message: "Invalid time format. Use HH:MM format (e.g., 08:00, 17:00)"
      });
    }

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        message: "Invalid time values"
      });
    }

    // Check if crosses midnight
    const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
    const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();
    const crossesMidnight = startMinutes > endMinutes;

    const shift = await prisma.shift.create({
      data: {
        companyId,
        shiftName,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        crossesMidnight,
        differentialMultiplier: differentialMultiplier || 1.0,
        timeZone: shiftTimeZone,
      },
    });

    return res.status(201).json({
      message: "Shift created successfully",
      data: shift,
    });
  } catch (error) {
    console.error("Error creating shift:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Get all shift templates for company
 */
const getShifts = async (req, res) => {
  try {
    const { companyId } = req.user;

    const shifts = await prisma.shift.findMany({
      where: { companyId },
      orderBy: { shiftName: 'asc' },
    });

    return res.status(200).json({
      message: "Shifts retrieved successfully",
      data: shifts,
    });
  } catch (error) {
    console.error("Error getting shifts:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Update a shift template
 */
const updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { shiftName, startTime, endTime, differentialMultiplier, timeZone } = req.body;
    const { companyId } = req.user;

    // Verify shift belongs to company
    const existingShift = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existingShift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    // Build update data
    let updateData = { 
      shiftName, 
      differentialMultiplier 
    };
    
    // Add timezone if provided
    if (timeZone) {
      updateData.timeZone = timeZone;
    }
    
    // Handle time updates if provided
    if (startTime && endTime) {
      let start, end;
      
      // Check if it's HH:MM format
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
      
      if (timeRegex.test(startTime) && timeRegex.test(endTime)) {
        // HH:MM format
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        
        // Create naive datetime directly in UTC
        start = new Date(Date.UTC(1970, 0, 1, startHour, startMin, 0));
        end = new Date(Date.UTC(1970, 0, 1, endHour, endMin, 0));
      } else if (startTime.includes('T') && endTime.includes('T')) {
        // ISO string format (legacy support)
        start = new Date(startTime);
        end = new Date(endTime);
      } else {
        return res.status(400).json({
          message: "Invalid time format. Use HH:MM format (e.g., 08:00, 17:00)"
        });
      }
      
      // Validate dates
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          message: "Invalid time values"
        });
      }
      
      // Check if crosses midnight
      const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
      const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();
      
      updateData.startTime = start.toISOString();
      updateData.endTime = end.toISOString();
      updateData.crossesMidnight = startMinutes > endMinutes;
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: updateData,
    });

    return res.status(200).json({
      message: "Shift updated successfully",
      data: shift,
    });
  } catch (error) {
    console.error("Error updating shift:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Delete a shift template
 */
const deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId } = req.user;

    // Verify shift belongs to company
    const existingShift = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existingShift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    // Check if shift is being used
    const usageCount = await prisma.userShift.count({
      where: { shiftId: id },
    });

    if (usageCount > 0) {
      return res.status(400).json({
        message: `Cannot delete shift. It is assigned to ${usageCount} employee(s).`,
        usageCount,
      });
    }

    // Delete shift
    await prisma.shift.delete({
      where: { id },
    });

    return res.status(200).json({
      message: "Shift deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting shift:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Bulk delete shifts
 */
const deleteManyShifts = async (req, res) => {
  try {
    const { shiftIds } = req.body;
    const { companyId } = req.user;

    if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
      return res.status(400).json({ message: "shiftIds array required" });
    }

    // Verify all shifts belong to company
    const shifts = await prisma.shift.findMany({
      where: {
        id: { in: shiftIds },
        companyId,
      },
    });

    if (shifts.length !== shiftIds.length) {
      return res.status(404).json({ message: "Some shifts not found" });
    }

    // Check usage
    const usageCount = await prisma.userShift.count({
      where: { shiftId: { in: shiftIds } },
    });

    if (usageCount > 0) {
      return res.status(400).json({
        message: `Cannot delete shifts. They are assigned to ${usageCount} employee(s).`,
        usageCount,
      });
    }

    // Delete shifts
    const deleted = await prisma.shift.deleteMany({
      where: { id: { in: shiftIds } },
    });

    return res.status(200).json({
      message: "Shifts deleted successfully",
      deletedCount: deleted.count,
    });
  } catch (error) {
    console.error("Error deleting shifts:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  createShift,
  getShifts,
  updateShift,
  deleteShift,
  deleteManyShifts,
};