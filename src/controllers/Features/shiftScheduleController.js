// src/controllers/Features/shiftScheduleController.js
const { prisma } = require("@config/connection");
const { RRule } = require("rrule");

function normalizeDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const toUtcIso = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m)).toISOString();
};

const toUtcTimeOnly = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) {
    throw new Error(`Invalid HH:mm string: ${hhmm}`);
  }
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, 0, 0));
};

const hhmmToIsoUtc = (hhmm) => {
  // "08:00" -> "1970-01-01T08:00:00.000Z"
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m)).toISOString();
};

const normalizeToIsoTime = (val) => {
  // Accept "08:00", "8:00", or any ISO-ish string
  if (!val) return null;
  if (typeof val === "string" && !val.includes("T")) {
    // assume HH:mm
    return hhmmToIsoUtc(val);
  }
  // already ISO/Date-like
  try {
    return new Date(val).toISOString();
  } catch {
    return null;
  }
};

const makeSplitNames = (base) => ({
  split1: `${base} (Split 1)`,
  split2: `${base} (Split 2)`,
});

async function ensureShiftTemplate({ companyId, name, startIso, endIso, timeZone }) {
  // Try to reuse an identical template to avoid clutter
  const existing = await prisma.shift.findFirst({
    where: {
      companyId,
      shiftName: name,
      startTime: new Date(startIso),
      endTime: new Date(endIso),
    },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.shift.create({
    data: {
      companyId,
      shiftName: name,
      startTime: new Date(startIso),
      endTime: new Date(endIso),
      differentialMultiplier: 1.0,
      timeZone: timeZone || "UTC",
      crossesMidnight: startIso > endIso, // same logic you use elsewhere
    },
    select: { id: true },
  });
}

const hasTimeOverlap = (shift1, shift2) => {
  const parseTime = (timeInput) => {
    console.log("Parsing time input:", timeInput, typeof timeInput);

    if (timeInput instanceof Date) {
      const hours = timeInput.getUTCHours();
      const minutes = timeInput.getUTCMinutes();
      const totalMinutes = hours * 60 + minutes;
      console.log(`Date parsed (UTC): ${hours}:${minutes} = ${totalMinutes} minutes`);
      return totalMinutes;
    }

    if (typeof timeInput === "string") {
      const [hours, minutes] = timeInput.split(":").map(Number);
      const totalMinutes = hours * 60 + minutes;
      console.log(`String parsed: ${hours}:${minutes} = ${totalMinutes} minutes`);
      return totalMinutes;
    }

    console.log("Defaulting to 0");
    return 0;
  };

  try {
    const start1 = parseTime(shift1.startTime);
    const end1 = parseTime(shift1.endTime);
    const start2 = parseTime(shift2.startTime);
    const end2 = parseTime(shift2.endTime);

    console.log(`Comparing shifts: ${start1}-${end1} vs ${start2}-${end2}`);
    const hasOverlap = start1 < end2 && end1 > start2;
    console.log(`Overlap result: ${hasOverlap}`);

    return hasOverlap;
  } catch (error) {
    console.error("Time parsing error:", error);
    return false;
  }
};

const detectTimeConflicts = async (userId, newShift, assignedDate) => {
  const conflicts = [];

  const existingUserShifts = await prisma.userShift.findMany({
    where: { 
      userId: userId,
      assignedDate: new Date(assignedDate)
    },
    include: { shift: true }
  });

  for (const existing of existingUserShifts) {
    if (hasTimeOverlap(existing.shift, newShift)) {
      conflicts.push({
        existingShiftId: existing.shift.id,
        existingShiftName: existing.shift.shiftName,
      });
    }
  }

  return conflicts;
};

async function createSplitShiftTemplates({ companyId, baseName, timeZone, split1, split2 }) {
  const names = makeSplitName(baseName);

  const tryFind = async (name, start, end) =>
    prisma.shift.findFirst({
      where: {
        companyId,
        shiftName: name,
        startTime: new Date(toUtcIso(start)),
        endTime: new Date(toUtcIso(end)),
      },
      select: { id: true },
    });

  const ensure = async (name, start, end) => {
    const found = await tryFind(name, start, end);
    if (found) return found;

    return prisma.shift.create({
      data: {
        companyId,
        shiftName: name,
        startTime: new Date(toUtcIso(start)),
        endTime: new Date(toUtcIso(end)),
        timeZone: timeZone || "UTC",
        differentialMultiplier: 1.0,
        crossesMidnight: start > end,
      },
      select: { id: true },
    });
  };

  const s1 = await ensure(names.split1, split1.start, split1.end);
  const s2 = await ensure(names.split2, split2.start, split2.end);

  return { split1Id: s1.id, split2Id: s2.id, names };
}

const createUserShiftsWithConflictDetection = async (
  users,
  schedule,
  occurrenceDates,
  conflictResolutions = {}
) => {
  console.log("Conflict Resolutions received:", conflictResolutions);

  const userShiftData = [];
  const conflicts = [];

  // Load the new (target) shift once
  const newShift = await prisma.shift.findUnique({
    where: { id: schedule.shiftId },
  });
  if (!newShift) throw new Error("Shift not found");

  for (const date of occurrenceDates) {
    const day = new Date(date); // normalize if needed
    for (const user of users) {
      // Detect conflicts for this user on this date against the new shift
      const userConflicts = await detectTimeConflicts(user.id, newShift, day);

      // You were reading existing; keeping (may be useful downstream)
      const existing = await prisma.userShift.findMany({
        where: { userId: user.id, assignedDate: day },
        select: { id: true, shiftId: true },
      });

      if (userConflicts.length > 0) {
        // Accept both string and object formats
        const resolutionData = conflictResolutions[user.id];
        const resolution =
          typeof resolutionData === "object" ? resolutionData.resolution : resolutionData;

        console.log(`User ${user.id} has conflicts. Resolution: ${resolution}`);

        if (resolution === "SKIP_NEW") {
          // do nothing—leave existing as is
          continue;

        } else if (resolution === "OVERRIDE_EXISTING") {
          // remove all conflicting assignments for that day for this user
          await prisma.userShift.deleteMany({
            where: {
              userId: user.id,
              assignedDate: day,
              shiftId: { in: userConflicts.map((c) => c.existingShiftId) },
            },
          });

          // assign the new (single) shift normally
          userShiftData.push({
            userId: user.id,
            shiftId: schedule.shiftId, // reuse template
            assignedDate: day,
            // no custom times in a single-block override
            createdAt: new Date(),
            updatedAt: new Date(),
          });

        } else if (resolution === "MULTI_SCHEDULE") {
          // 1) Remove all conflicting assignments for that day (affected day only)
          await prisma.userShift.deleteMany({
            where: {
              userId: user.id,
              assignedDate: day,
              shiftId: { in: userConflicts.map((c) => c.existingShiftId) },
            },
          });

          // 2) Create TWO UserShift rows (split) that REUSE the original template
          // Expecting resolutionData.scheduleData = { firstSchedule: {startTime,endTime}, secondSchedule: {...} }
          const first = resolutionData?.scheduleData?.firstSchedule;
          const second = resolutionData?.scheduleData?.secondSchedule;
          if (!first || !second) {
            throw new Error(
              "MULTI_SCHEDULE missing scheduleData.firstSchedule/secondSchedule"
            );
          }

          const originalId =
            userConflicts[0]?.existingShiftId || schedule.shiftId; // audit trail

          userShiftData.push(
            {
              userId: user.id,
              shiftId: schedule.shiftId, // REUSE the template
              assignedDate: day,
              customStartTime: toUtcTimeOnly(first.startTime),
              customEndTime: toUtcTimeOnly(first.endTime),
              isSplitShift: true,
              originalShiftId: originalId,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              userId: user.id,
              shiftId: schedule.shiftId, // REUSE the template
              assignedDate: day,
              customStartTime: toUtcTimeOnly(second.startTime),
              customEndTime: toUtcTimeOnly(second.endTime),
              isSplitShift: true,
              originalShiftId: originalId,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          );

        } else {
          // No resolution provided: log conflicts (kept)
          for (const conflict of userConflicts) {
            conflicts.push({
              scheduleId: schedule.id,
              userId: user.id,
              userEmail: user.email,
              conflictingShiftId: conflict.existingShiftId,
              newShiftId: newShift.id,
              assignedDate: day,
              conflictDetails: {
                existingShift: {
                  start: conflict.existingShift?.startTime ?? new Date(Date.UTC(1970,0,1,8,0)),
                  end: conflict.existingShift?.endTime ?? new Date(Date.UTC(1970,0,1,17,0)),
                },
                newShift: {
                  start: newShift.startTime,
                  end: newShift.endTime,
                },
              },
              existingShiftName: conflict.existingShiftName,
              newShiftName: newShift.shiftName,
            });
          }
        }
      } else {
        // No conflicts: assign normally (no custom times)
        userShiftData.push({
          userId: user.id,
          shiftId: schedule.shiftId,
          assignedDate: day,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  }

  return { userShiftData, conflicts };
};

async function updateUserShiftsForSchedule(schedule, conflictResolutions) {
  try {
    const now = new Date();
    const normalizedNow = normalizeDate(now);
    const windowLengthDays = 30;
    const windowStart = normalizedNow;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + windowLengthDays);

    const scheduleStart = normalizeDate(schedule.startDate);
    let scheduleEnd = schedule.endDate ? normalizeDate(schedule.endDate) : null;

    if (scheduleEnd && scheduleEnd <= scheduleStart) scheduleEnd = null;
    if (scheduleEnd && scheduleEnd < normalizedNow) return { conflicts: [] };

    const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
    let effectiveWindowEnd = scheduleEnd ? (scheduleEnd < windowEnd ? scheduleEnd : windowEnd) : windowEnd;

    if (windowEffectiveStart > effectiveWindowEnd) return { conflicts: [] };

    const byDayPart = schedule.recurrencePattern.split(";").find((p) => p.startsWith("BYDAY="));
    const daysArray = byDayPart ? byDayPart.replace("BYDAY=", "").split(",") : [];
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const validDays = daysArray.map((day) => dayMap[day]).filter((d) => d !== undefined);

    const occurrenceDates = [];
    let currentDate = new Date(windowEffectiveStart);
    while (currentDate <= effectiveWindowEnd) {
      if (validDays.includes(currentDate.getDay())) occurrenceDates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let users = [];
    if (schedule.assignedToAll) {
      users = await prisma.user.findMany({ where: { companyId: schedule.companyId } });
    } else if (schedule.assignedToDepartment) {
      users = await prisma.user.findMany({
        where: { companyId: schedule.companyId, departmentId: schedule.departmentId },
      });
    } else if (schedule.assignedUserId) {
      const user = await prisma.user.findUnique({ where: { id: schedule.assignedUserId } });
      if (user) users.push(user);
    }

    await prisma.userShift.deleteMany({
      where: {
        shiftId: schedule.shiftId,
        userId: { in: users.map(u => u.id) },
        assignedDate: {
          gte: windowEffectiveStart,
          lte: effectiveWindowEnd,
        },
      },
    });

    const { userShiftData, conflicts, removals = [] } =
    await createUserShiftsWithConflictDetection(users, schedule, occurrenceDates, conflictResolutions);

    await prisma.$transaction(async (trx) => {
      if (removals.length) {
        await trx.userShift.deleteMany({
          where: { OR: removals.map(r => ({
            userId: r.userId,
            assignedDate: r.assignedDate,
            shiftId: r.shiftId,
          })) }
        });
      }
    
      if (userShiftData.length) {
        await trx.userShift.createMany({ data: userShiftData });
      }
    
      if (conflicts.length) {
        await trx.scheduleConflict.createMany({
          data: conflicts.map(c => ({
            scheduleId: c.scheduleId,
            userId: c.userId,
            conflictingShiftId: c.conflictingShiftId,
            newShiftId: c.newShiftId,
            assignedDate: c.assignedDate,
            status: "PENDING",
            conflictDetails: c.conflictDetails,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        });
      }
    });

    return { conflicts };
  } catch (error) {
    console.error("Error updating user shifts for schedule:", error);
    throw error;
  }
}

const preflightConflictCheck = async (req, res) => {
  try {
    const {
      shiftId,
      recurrencePattern,
      startDate,
      endDate,
      assignedToAll,
      assignedToDepartment,
      departmentId,
      assignedUserId,
    } = req.body;

    if (!shiftId || !recurrencePattern || !startDate) {
      return res.status(400).json({ message: "Required fields are missing." });
    }

    const assignmentCount = [assignedToAll, assignedToDepartment, !!assignedUserId].filter(Boolean).length;
    if (assignmentCount !== 1) {
      return res.status(400).json({ message: "Exactly one assignment type must be specified." });
    }
    if (assignedToDepartment && !departmentId) {
      return res.status(400).json({ message: "Department ID is required when assigning to department." });
    }

    const mockSchedule = {
      id: "mock-id",
      companyId: req.user.companyId,
      shiftId,
      recurrencePattern,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      assignedToAll: assignedToAll || false,
      assignedToDepartment: assignedToDepartment || false,
      departmentId: assignedToDepartment ? departmentId : null,
      assignedUserId: assignedToAll || assignedToDepartment ? null : assignedUserId,
    };

    const newShift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!newShift) return res.status(400).json({ message: "Shift not found." });

    let targetUsers = [];

    if (mockSchedule.assignedToAll) {
      targetUsers = await prisma.user.findMany({
        where: { companyId: req.user.companyId },
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      });
    } else if (mockSchedule.assignedToDepartment) {
      targetUsers = await prisma.user.findMany({
        where: { companyId: req.user.companyId, departmentId: mockSchedule.departmentId },
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      });
    } else if (mockSchedule.assignedUserId) {
      const user = await prisma.user.findUnique({
        where: { id: mockSchedule.assignedUserId },
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      });
      if (user) targetUsers.push(user);
    }

    const now = new Date();
    const normalizedNow = normalizeDate(now);
    const windowLengthDays = 30;
    const windowStart = normalizedNow;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + windowLengthDays);

    const scheduleStart = normalizeDate(mockSchedule.startDate);
    let scheduleEnd = mockSchedule.endDate ? normalizeDate(mockSchedule.endDate) : null;
    if (scheduleEnd && scheduleEnd <= scheduleStart) scheduleEnd = null;
    if (scheduleEnd && scheduleEnd < normalizedNow)
      return res.status(200).json({ message: "Schedule is in the past.", successful: [], conflicts: [] });

    const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
    let effectiveWindowEnd = scheduleEnd ? (scheduleEnd < windowEnd ? scheduleEnd : windowEnd) : windowEnd;

    if (windowEffectiveStart > effectiveWindowEnd)
      return res.status(200).json({ message: "No valid dates in schedule window.", successful: [], conflicts: [] });

    const byDayPart = mockSchedule.recurrencePattern.split(";").find((p) => p.startsWith("BYDAY="));
    const daysArray = byDayPart ? byDayPart.replace("BYDAY=", "").split(",") : [];
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

    const successful = [];
    const conflicts = [];
    const usersWithConflicts = new Set();

    for (const user of targetUsers) {
      let userHasConflicts = false;

      for (const date of occurrenceDates) {
        const userConflicts = await detectTimeConflicts(user.id, newShift, new Date(date));

        if (userConflicts.length > 0) {
          userHasConflicts = true;
          usersWithConflicts.add(user.id);

          for (const conflict of userConflicts) {
            const conflictingShift = await prisma.shift.findUnique({
              where: { id: conflict.existingShiftId },
            });

            conflicts.push({
              userId: user.id,
              user,
              conflictDate: date.toISOString(),
              conflictingShiftId: conflict.existingShiftId,
              newShiftId: newShift.id,
              existingShift: {
                id: conflictingShift.id,
                shiftName: conflictingShift.shiftName,
                startTime:
                  conflictingShift.startTime instanceof Date
                    ? conflictingShift.startTime.toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : conflictingShift.startTime,
                endTime:
                  conflictingShift.endTime instanceof Date
                    ? conflictingShift.endTime.toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : conflictingShift.endTime,
                crossesMidnight: conflictingShift.crossesMidnight,
              },
              newShift: {
                id: newShift.id,
                shiftName: newShift.shiftName,
                startTime:
                  newShift.startTime instanceof Date
                    ? newShift.startTime.toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : newShift.startTime,
                endTime:
                  newShift.endTime instanceof Date
                    ? newShift.endTime.toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : newShift.endTime,
                crossesMidnight: newShift.crossesMidnight,
              },
            });
          }
        }
      }

      if (!userHasConflicts) successful.push(user);
    }

    const uniqueConflicts = conflicts.reduce((acc, conflict) => {
      const exists = acc.find(
        (c) =>
          c.userId === conflict.userId &&
          c.conflictingShiftId === conflict.conflictingShiftId &&
          c.newShiftId === conflict.newShiftId &&
          new Date(c.conflictDate).toDateString() === new Date(conflict.conflictDate).toDateString()
      );
      if (!exists) acc.push(conflict);
      return acc;
    }, []);

    return res.status(200).json({
      message: "Preflight conflict check completed successfully.",
      successful,
      conflicts: uniqueConflicts,
      summary: {
        totalUsers: targetUsers.length,
        successfulUsers: successful.length,
        conflictedUsers: usersWithConflicts.size,
        totalConflicts: uniqueConflicts.length,
        occurrenceDates: occurrenceDates.length,
      },
    });
  } catch (error) {
    console.error("Error in preflight conflict check:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const createShiftSchedule = async (req, res) => {
  try {
    const {
      shiftId,
      recurrencePattern,
      startDate,
      endDate,
      assignedToAll,
      assignedToDepartment,
      departmentId,
      assignedUserId,
      conflictResolutions
    } = req.body;

    if (!shiftId || !recurrencePattern || !startDate) {
      return res.status(400).json({ message: "Required fields are missing." });
    }

    const assignmentCount = [assignedToAll, assignedToDepartment, !!assignedUserId].filter(Boolean).length;
    if (assignmentCount !== 1) {
      return res.status(400).json({ message: "Exactly one assignment type must be specified." });
    }
    if (assignedToDepartment && !departmentId) {
      return res.status(400).json({ message: "Department ID is required when assigning to department." });
    }

    const schedule = await prisma.shiftSchedule.create({
      data: {
        companyId: req.user.companyId,
        shiftId,
        recurrencePattern,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        assignedToAll: assignedToAll || false,
        assignedToDepartment: assignedToDepartment || false,
        departmentId: assignedToDepartment ? departmentId : null,
        assignedUserId: assignedToAll || assignedToDepartment ? null : assignedUserId,
      },
      include: { shift: true },
    });

    const { conflicts } = await updateUserShiftsForSchedule(schedule, conflictResolutions);

    return res.status(201).json({
      message: "Shift schedule created successfully.",
      data: schedule,
      conflicts:
        conflicts.length > 0
          ? {
              count: conflicts.length,
              details: conflicts.slice(0, 5),
              totalAffectedUsers: [...new Set(conflicts.map((c) => c.userId))].length,
            }
          : null,
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
      include: {
        shift: true,
        department: {
          select: { id: true, name: true },
        },
        assignedUser: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        _count: { select: { conflicts: { where: { status: "PENDING" } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = schedules.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate ? s.endDate.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      pendingConflicts: s._count.conflicts,
    }));

    return res.status(200).json({
      message: "Shift schedules retrieved successfully.",
      data: formatted,
    });
  } catch (error) {
    console.error("Error fetching shift schedules:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateShiftSchedule = async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const {
      recurrencePattern,
      startDate,
      endDate,
      assignedToAll,
      assignedToDepartment,
      departmentId,
      assignedUserId,
    } = req.body;

    const assignmentCount = [assignedToAll, assignedToDepartment, !!assignedUserId].filter(Boolean).length;
    if (assignmentCount !== 1) {
      return res.status(400).json({ message: "Exactly one assignment type must be specified." });
    }

    const updatedSchedule = await prisma.shiftSchedule.update({
      where: { id: scheduleId },
      data: {
        recurrencePattern,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        assignedToAll: assignedToAll || false,
        assignedToDepartment: assignedToDepartment || false,
        departmentId: assignedToDepartment ? departmentId : null,
        assignedUserId: assignedToAll || assignedToDepartment ? null : assignedUserId,
      },
      include: { shift: true },
    });

    const { conflicts } = await updateUserShiftsForSchedule(updatedSchedule);

    return res.status(200).json({
      message: "Shift schedule updated successfully.",
      data: updatedSchedule,
      conflicts:
        conflicts.length > 0
          ? {
              count: conflicts.length,
              details: conflicts.slice(0, 5),
              totalAffectedUsers: [...new Set(conflicts.map((c) => c.userId))].length,
            }
          : null,
    });
  } catch (error) {
    console.error("Error updating shift schedule:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteShiftSchedule = async (req, res) => {
  try {
    const scheduleId = req.params.id;

    const schedule = await prisma.shiftSchedule.findUnique({ where: { id: scheduleId } });
    if (schedule) {
      const now = new Date();
      const normalizedNow = normalizeDate(now);
      const scheduleStart = normalizeDate(schedule.startDate);
      let scheduleEnd = schedule.endDate ? normalizeDate(schedule.endDate) : null;

      if (scheduleEnd && scheduleEnd <= scheduleStart) scheduleEnd = null;

      const windowEffectiveStart = scheduleStart > normalizedNow ? scheduleStart : normalizedNow;
      const windowLengthDays = 30;
      const windowEnd = new Date(windowEffectiveStart);
      windowEnd.setDate(windowEnd.getDate() + windowLengthDays);

      let effectiveWindowEnd = scheduleEnd ? (scheduleEnd < windowEnd ? scheduleEnd : windowEnd) : windowEnd;

      await prisma.userShift.deleteMany({
        where: {
          shiftId: schedule.shiftId,
          assignedDate: { gte: windowEffectiveStart, lte: effectiveWindowEnd },
        },
      });

      await prisma.scheduleConflict.deleteMany({ where: { scheduleId } });
    }

    await prisma.shiftSchedule.delete({ where: { id: scheduleId } });

    return res.status(200).json({ message: "Shift schedule deleted successfully." });
  } catch (error) {
    console.error("Error deleting shift schedule:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getShiftSchedulesEnhanced = async (req, res) => {
  try {
    const { shiftName, userEmail, search } = req.query;

    const schedules = await prisma.shiftSchedule.findMany({
      where: { companyId: req.user.companyId },
      include: {
        shift: true,
        department: {
          select: { id: true, name: true },
        },
        assignedUser: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        _count: {
          select: {
            conflictsAsSchedule: { where: { status: "PENDING" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    let filtered = schedules;

    if (shiftName) {
      filtered = filtered.filter((s) =>
        s.shift.shiftName.toLowerCase().includes(shiftName.toLowerCase())
      );
    }

    if (userEmail && !filtered[0]?.assignedToAll && !filtered[0]?.assignedToDepartment) {
      filtered = filtered.filter((s) =>
        s.assignedUser?.email.toLowerCase().includes(userEmail.toLowerCase())
      );
    }

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (f) =>
          f.shift.shiftName.toLowerCase().includes(s) ||
          f.assignedUser?.email.toLowerCase().includes(s) ||
          f.department?.name.toLowerCase().includes(s)
      );
    }

    const formatted = filtered.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate ? s.endDate.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      assignedUserName: s.assignedToAll
        ? "All Employees"
        : s.assignedToDepartment
        ? `Department: ${s.department?.name}`
        : s.assignedUser
        ? `${s.assignedUser.profile?.firstName} ${s.assignedUser.profile?.lastName}`
        : "Unassigned",
      assignedUserEmail: s.assignedToAll
        ? "all@company"
        : s.assignedToDepartment
        ? `dept-${s.department?.id}@company`
        : s.assignedUser?.email || "unassigned",
      pendingConflicts: s._count.conflictsAsSchedule,
    }));

    return res.status(200).json({
      message: "Enhanced shift schedules retrieved successfully.",
      data: formatted,
    });
  } catch (error) {
    console.error("Error fetching enhanced shift schedules:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ---------------- EXPORT ----------------
module.exports = {
  createShiftSchedule,
  getShiftSchedules,
  updateShiftSchedule,
  deleteShiftSchedule,
  getShiftSchedulesEnhanced,
  preflightConflictCheck,
};
