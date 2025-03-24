// jobs/generateUpcomingUserShifts.js

const cron = require("node-cron");
const { prisma } = require("@config/connection");

// Normalize a date by setting its time to midnight
function normalizeDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function generateUpcomingUserShifts() {
  try {
    const now = new Date();
    const normalizedNow = normalizeDate(now);
    const windowLengthDays = 30;
    const windowStart = normalizedNow;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + windowLengthDays);

    const schedules = await prisma.shiftSchedule.findMany({
      where: {
        startDate: { lte: windowEnd },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: { shift: true },
    });

    for (const schedule of schedules) {
      // Normalize startDate and endDate
      const scheduleStart = normalizeDate(schedule.startDate);
      let scheduleEnd = schedule.endDate ? normalizeDate(schedule.endDate) : null;

      // If an endDate is provided but it's not after the startDate, treat it as no end date.
      if (scheduleEnd && scheduleEnd <= scheduleStart) {
        scheduleEnd = null;
      }

      // If schedule has an endDate and it's before today, skip processing it.
      if (scheduleEnd && scheduleEnd < normalizedNow) {
        console.warn(`Skipping schedule ${schedule.id} because its endDate is in the past.`);
        continue;
      }

      // Calculate the effective window for generating occurrences.
      // Use the later of scheduleStart or today.
      const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
      let effectiveWindowEnd = windowEnd;
      if (scheduleEnd) {
        // Use the earlier of scheduleEnd or windowEnd.
        effectiveWindowEnd = scheduleEnd < windowEnd ? scheduleEnd : windowEnd;
      }

      // If the effective window is invalid, skip the schedule.
      if (windowEffectiveStart > effectiveWindowEnd) {
        console.warn(`Skipping schedule ${schedule.id} because effective window is invalid.`);
        continue;
      }

      // Parse the recurrence pattern (expects something like "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
      const byDayPart = schedule.recurrencePattern.split(";").find((part) => part.startsWith("BYDAY="));
      let daysArray = [];
      if (byDayPart) {
        daysArray = byDayPart.replace("BYDAY=", "").split(",");
      }
      // Map day abbreviations to JavaScript day numbers (0 = Sunday, 6 = Saturday)
      const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const validDays = daysArray.map((day) => dayMap[day]).filter((d) => d !== undefined);

      // Generate occurrence dates within the effective window
      const occurrenceDates = [];
      let currentDate = new Date(windowEffectiveStart);
      while (currentDate <= effectiveWindowEnd) {
        if (validDays.includes(currentDate.getDay())) {
          occurrenceDates.push(new Date(currentDate));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Determine which users to assign based on schedule settings.
      let users = [];
      if (schedule.assignedToAll) {
        users = await prisma.user.findMany({
          where: { companyId: schedule.companyId },
        });
      } else if (schedule.assignedUserId) {
        const user = await prisma.user.findUnique({ where: { id: schedule.assignedUserId } });
        if (user) users.push(user);
      }

      // Prepare user shift assignment records, skipping duplicates.
      const userShiftData = [];
      for (const date of occurrenceDates) {
        for (const user of users) {
          const exists = await prisma.userShift.findFirst({
            where: {
              userId: user.id,
              shiftId: schedule.shiftId,
              assignedDate: date,
            },
          });
          if (!exists) {
            userShiftData.push({
              userId: user.id,
              shiftId: schedule.shiftId,
              assignedDate: date,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }

      if (userShiftData.length > 0) {
        await prisma.userShift.createMany({ data: userShiftData });
      }
    }
    console.log("Background job: Upcoming user shifts generated.");
  } catch (error) {
    console.error("Background job error:", error);
  }
}

// Run this job every day at midnight
cron.schedule("0 0 * * *", () => {
  generateUpcomingUserShifts();
});

module.exports = { generateUpcomingUserShifts };
