// src/controllers/Features/userShiftController.js

const { prisma } = require("@config/connection");

const getUserShifts = async (req, res) => {
  try {
    const userId = req.user.id;
    // Query the UserShift table for shifts assigned to the user
    const userShifts = await prisma.userShift.findMany({
      where: { userId },
      include: {
        shift: true, // include shift template details (shiftName, startTime, etc.)
      },
      orderBy: { assignedDate: "desc" },
    });
    // Format date fields to ISO strings (optional)
    const formattedShifts = userShifts.map((shift) => ({
      ...shift,
      assignedDate: shift.assignedDate.toISOString(),
      shift: {
        ...shift.shift,
        startTime: shift.shift.startTime.toISOString(),
        endTime: shift.shift.endTime.toISOString(),
      },
    }));
    return res.status(200).json({ message: "User shifts retrieved successfully.", data: formattedShifts });
  } catch (error) {
    console.error("Error fetching user shifts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { getUserShifts };
