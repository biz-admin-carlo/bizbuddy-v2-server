// src/controllers/Features/shiftScheduleController.js

const { prisma } = require("@config/connection");

function normalizeDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function updateUserShiftsForSchedule(schedule) {
  try {
    const now = new Date();
    const normalizedNow = normalizeDate(now);
    const windowLengthDays = 30;
    const windowStart = normalizedNow;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + windowLengthDays);
    const scheduleStart = normalizeDate(schedule.startDate);
    let scheduleEnd = schedule.endDate ? normalizeDate(schedule.endDate) : null;
    if (scheduleEnd && scheduleEnd <= scheduleStart) {
      scheduleEnd = null;
    }
    if (scheduleEnd && scheduleEnd < normalizedNow) {
      return;
    }
    const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
    let effectiveWindowEnd = windowEnd;
    if (scheduleEnd) {
      effectiveWindowEnd = scheduleEnd < windowEnd ? scheduleEnd : windowEnd;
    }
    if (windowEffectiveStart > effectiveWindowEnd) {
      return;
    }
    const byDayPart = schedule.recurrencePattern.split(";").find((part) => part.startsWith("BYDAY="));
    let daysArray = [];
    if (byDayPart) {
      daysArray = byDayPart.replace("BYDAY=", "").split(",");
    }
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const validDays = daysArray.map((day) => dayMap[day]).filter((d) => d !== undefined);
    const occurrenceDates = [];
    let currentDate = new Date(windowEffectiveStart);
    while (currentDate <= effectiveWindowEnd) {
      if (validDays.includes(currentDate.getDay())) {
        occurrenceDates.push(new Date(currentDate));
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    let users = [];
    if (schedule.assignedToAll) {
      users = await prisma.user.findMany({
        where: { companyId: schedule.companyId },
      });
    } else if (schedule.assignedUserId) {
      const user = await prisma.user.findUnique({
        where: { id: schedule.assignedUserId },
      });
      if (user) users.push(user);
    }
    await prisma.userShift.deleteMany({
      where: {
        shiftId: schedule.shiftId,
        assignedDate: {
          gte: windowEffectiveStart,
          lte: effectiveWindowEnd,
        },
      },
    });
    const userShiftData = [];
    occurrenceDates.forEach((date) => {
      users.forEach((user) => {
        userShiftData.push({
          userId: user.id,
          shiftId: schedule.shiftId,
          assignedDate: date,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    });

    if (userShiftData.length > 0) {
      await prisma.userShift.createMany({ data: userShiftData });
    }
  } catch (error) {
    console.error("Error updating user shifts for schedule:", error);
  }
}

const createShiftSchedule = async (req, res) => {
  try {
    const { shiftId, recurrencePattern, startDate, endDate, assignedToAll, assignedUserId } = req.body;

    if (!shiftId || !recurrencePattern || !startDate) {
      return res.status(400).json({ message: "Required fields are missing." });
    }
    const schedule = await prisma.shiftSchedule.create({
      data: {
        companyId: req.user.companyId,
        shiftId,
        recurrencePattern,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        assignedToAll: assignedToAll || false,
        assignedUserId: assignedToAll ? null : assignedUserId,
      },
    });
    const now = new Date();
    const scheduleStart = new Date(startDate);
    const windowStart = now > scheduleStart ? now : scheduleStart;
    const windowLengthDays = 30;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + windowLengthDays);

    let effectiveWindowEnd = windowEnd;
    if (endDate) {
      const scheduleEnd = new Date(endDate);
      if (scheduleEnd < windowEnd) {
        effectiveWindowEnd = scheduleEnd;
      }
    }

    console.log("windowStart:", windowStart);
    console.log("effectiveWindowEnd:", effectiveWindowEnd);

    if (windowStart > effectiveWindowEnd) {
      console.warn("No valid assignment window: windowStart is after effectiveWindowEnd.");
    } else {
      const byDayPart = recurrencePattern.split(";").find((part) => part.startsWith("BYDAY="));
      let daysArray = [];
      if (byDayPart) {
        daysArray = byDayPart.replace("BYDAY=", "").split(",");
      }
      const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const validDays = daysArray.map((day) => dayMap[day]).filter((d) => d !== undefined);
      const occurrenceDates = [];
      let currentDate = new Date(windowStart);
      while (currentDate <= effectiveWindowEnd) {
        if (validDays.includes(currentDate.getDay())) {
          occurrenceDates.push(new Date(currentDate));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      let users = [];
      if (assignedToAll) {
        users = await prisma.user.findMany({
          where: { companyId: req.user.companyId },
        });
      } else if (assignedUserId) {
        const user = await prisma.user.findUnique({ where: { id: assignedUserId } });
        if (user) {
          users.push(user);
        }
      }
      console.log(
        "Users to assign:",
        users.map((u) => u.id)
      );
      const userShiftData = [];
      occurrenceDates.forEach((date) => {
        users.forEach((user) => {
          userShiftData.push({
            userId: user.id,
            shiftId,
            assignedDate: date,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });
      });
      console.log("UserShift records to be created:", userShiftData.length);

      if (userShiftData.length > 0) {
        await prisma.userShift.createMany({ data: userShiftData });
      }
    }

    return res.status(201).json({
      message: "Shift schedule and upcoming assignments created successfully.",
      data: schedule,
    });
  } catch (error) {
    console.error("Error creating shift schedule and assignments:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getShiftSchedules = async (req, res) => {
  try {
    const schedules = await prisma.shiftSchedule.findMany({
      where: { companyId: req.user.companyId },
      include: { shift: true },
      orderBy: { createdAt: "desc" },
    });
    const formattedSchedules = schedules.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate ? s.endDate.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
    return res.status(200).json({
      message: "Shift schedules retrieved successfully.",
      data: formattedSchedules,
    });
  } catch (error) {
    console.error("Error fetching shift schedules:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateShiftSchedule = async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const { recurrencePattern, startDate, endDate, assignedToAll, assignedUserId } = req.body;
    const updatedSchedule = await prisma.shiftSchedule.update({
      where: { id: scheduleId },
      data: {
        recurrencePattern,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        assignedToAll: assignedToAll || false,
        assignedUserId: assignedToAll ? null : assignedUserId,
      },
    });

    await updateUserShiftsForSchedule(updatedSchedule);

    return res.status(200).json({
      message: "Shift schedule updated successfully.",
      data: updatedSchedule,
    });
  } catch (error) {
    console.error("Error updating shift schedule:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteShiftSchedule = async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const schedule = await prisma.shiftSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (schedule) {
      const now = new Date();
      const normalizedNow = normalizeDate(now);
      const scheduleStart = normalizeDate(schedule.startDate);
      let scheduleEnd = schedule.endDate ? normalizeDate(schedule.endDate) : null;
      if (scheduleEnd && scheduleEnd <= scheduleStart) {
        scheduleEnd = null;
      }
      const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
      const windowLengthDays = 30;
      const windowEnd = new Date(windowEffectiveStart);
      windowEnd.setDate(windowEnd.getDate() + windowLengthDays);
      let effectiveWindowEnd = windowEnd;
      if (scheduleEnd) {
        effectiveWindowEnd = scheduleEnd < windowEnd ? scheduleEnd : windowEnd;
      }

      await prisma.userShift.deleteMany({
        where: {
          shiftId: schedule.shiftId,
          assignedDate: {
            gte: windowEffectiveStart,
            lte: effectiveWindowEnd,
          },
        },
      });
    }

    await prisma.shiftSchedule.delete({
      where: { id: scheduleId },
    });
    return res.status(200).json({ message: "Shift schedule deleted successfully." });
  } catch (error) {
    console.error("Error deleting shift schedule:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  createShiftSchedule,
  getShiftSchedules,
  updateShiftSchedule,
  deleteShiftSchedule,
};
