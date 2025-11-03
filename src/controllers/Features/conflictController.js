// src/controllers/Features/conflictController.js

const { prisma } = require("@config/connection");

/**
 * Helper function to resolve multi-schedule for a single date
 */
const resolveSingleMultiSchedule = async (conflict, scheduleData, resolverId) => {
  // Keep existing shift
  // Add new shift with custom times for the same date
  await prisma.userShift.create({
    data: {
      userId: conflict.userId,
      shiftId: conflict.newShiftId,
      assignedDate: conflict.assignedDate,
      customStartTime: scheduleData.secondSchedule.startTime,
      customEndTime: scheduleData.secondSchedule.endTime,
      isMultiSchedule: true,
      multiScheduleGroup: `${conflict.userId}_${conflict.assignedDate.toISOString().split('T')[0]}`,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  // Update existing shift with custom times if provided
  if (scheduleData.firstSchedule) {
    await prisma.userShift.updateMany({
      where: {
        userId: conflict.userId,
        assignedDate: conflict.assignedDate,
        shiftId: conflict.conflictingShiftId
      },
      data: {
        customStartTime: scheduleData.firstSchedule.startTime,
        customEndTime: scheduleData.firstSchedule.endTime,
        isMultiSchedule: true,
        multiScheduleGroup: `${conflict.userId}_${conflict.assignedDate.toISOString().split('T')[0]}`
      }
    });
  }
};

/**
 * Helper function to resolve multi-schedule for all recurring conflicts
 */
const resolveRecurringMultiSchedule = async (conflict, scheduleData, resolverId) => {
  // Get all pending conflicts for this user and schedule
  const allConflicts = await prisma.scheduleConflict.findMany({
    where: {
      userId: conflict.userId,
      scheduleId: conflict.scheduleId,
      status: 'PENDING'
    }
  });

  console.log(`Found ${allConflicts.length} recurring conflicts to resolve`);

  // Process each conflict date
  for (const recurringConflict of allConflicts) {
    // Keep existing shift, update with custom times
    await prisma.userShift.updateMany({
      where: {
        userId: recurringConflict.userId,
        assignedDate: recurringConflict.assignedDate,
        shiftId: recurringConflict.conflictingShiftId
      },
      data: {
        customStartTime: scheduleData.firstSchedule.startTime,
        customEndTime: scheduleData.firstSchedule.endTime,
        isMultiSchedule: true,
        multiScheduleGroup: `${recurringConflict.userId}_${recurringConflict.assignedDate.toISOString().split('T')[0]}`
      }
    });

    // Add new shift for the same date
    await prisma.userShift.create({
      data: {
        userId: recurringConflict.userId,
        shiftId: recurringConflict.newShiftId,
        assignedDate: recurringConflict.assignedDate,
        customStartTime: scheduleData.secondSchedule.startTime,
        customEndTime: scheduleData.secondSchedule.endTime,
        isMultiSchedule: true,
        multiScheduleGroup: `${recurringConflict.userId}_${recurringConflict.assignedDate.toISOString().split('T')[0]}`,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  }
};

/**
 * Helper function to get count of resolved conflicts
 */
const getResolvedConflictCount = async (userId, scheduleId) => {
  return await prisma.scheduleConflict.count({
    where: {
      userId,
      scheduleId,
      status: 'RESOLVED'
    }
  });
};

/**
 * GET /api/conflicts
 * Get all pending conflicts for the company
 */
const getConflicts = async (req, res) => {
  try {
    const { status = 'PENDING', limit = 50, offset = 0 } = req.query;
    
    const conflicts = await prisma.scheduleConflict.findMany({
      where: {
        schedule: {
          companyId: req.user.companyId
        },
        status: status
      },
      include: {
        schedule: {
          include: {
            shift: true
          }
        },
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        conflictingShift: {
          select: {
            id: true,
            shiftName: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true
          }
        },
        newShift: {
          select: {
            id: true,
            shiftName: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true
          }
        },
        resolver: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const totalConflicts = await prisma.scheduleConflict.count({
      where: {
        schedule: {
          companyId: req.user.companyId
        },
        status: status
      }
    });

    const formattedConflicts = conflicts.map(conflict => ({
      ...conflict,
      assignedDate: conflict.assignedDate.toISOString(),
      createdAt: conflict.createdAt.toISOString(),
      updatedAt: conflict.updatedAt.toISOString(),
      resolvedAt: conflict.resolvedAt ? conflict.resolvedAt.toISOString() : null,
      userDisplayName: conflict.user.profile 
        ? `${conflict.user.profile.firstName} ${conflict.user.profile.lastName}`
        : conflict.user.email,
      resolverDisplayName: conflict.resolver?.profile
        ? `${conflict.resolver.profile.firstName} ${conflict.resolver.profile.lastName}`
        : conflict.resolver?.email
    }));

    return res.status(200).json({
      message: "Conflicts retrieved successfully.",
      data: {
        conflicts: formattedConflicts,
        pagination: {
          total: totalConflicts,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < totalConflicts
        }
      }
    });
  } catch (error) {
    console.error("Error fetching conflicts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * GET /api/conflicts/schedule/:scheduleId
 * Get conflicts for a specific schedule
 */
const getConflictsBySchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { status } = req.query;

    const whereClause = {
      scheduleId,
      schedule: {
        companyId: req.user.companyId
      }
    };

    if (status) {
      whereClause.status = status;
    }

    const conflicts = await prisma.scheduleConflict.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        conflictingShift: {
          select: {
            id: true,
            shiftName: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true
          }
        },
        newShift: {
          select: {
            id: true,
            shiftName: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedConflicts = conflicts.map(conflict => ({
      ...conflict,
      assignedDate: conflict.assignedDate.toISOString(),
      createdAt: conflict.createdAt.toISOString(),
      updatedAt: conflict.updatedAt.toISOString(),
      resolvedAt: conflict.resolvedAt ? conflict.resolvedAt.toISOString() : null,
      userDisplayName: conflict.user.profile 
        ? `${conflict.user.profile.firstName} ${conflict.user.profile.lastName}`
        : conflict.user.email
    }));

    return res.status(200).json({
      message: "Schedule conflicts retrieved successfully.",
      data: formattedConflicts
    });
  } catch (error) {
    console.error("Error fetching schedule conflicts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * PUT /api/conflicts/:id/resolve
 * Resolve a specific conflict
 */
const resolveConflict = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution, note, applyToAllRecurring = false, customShiftId, scheduleData } = req.body;

    console.log('Resolving conflict:', { id, resolution, applyToAllRecurring, scheduleData });

    // Validate resolution type - Added MULTI_SCHEDULE
    const validResolutions = ['OVERRIDE_EXISTING', 'SKIP_NEW', 'MANUAL_ASSIGN', 'CREATE_CUSTOM', 'MULTI_SCHEDULE'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ 
        message: "Invalid resolution type. Must be one of: " + validResolutions.join(', ')
      });
    }

    // Get the conflict with all related data
    const conflict = await prisma.scheduleConflict.findFirst({
      where: {
        id,
        schedule: {
          companyId: req.user.companyId
        }
      },
      include: {
        schedule: true,
        user: true,
        newShift: true,
        conflictingShift: true
      }
    });

    if (!conflict) {
      return res.status(404).json({ message: "Conflict not found." });
    }

    if (conflict.status !== 'PENDING') {
      return res.status(400).json({ message: "Conflict has already been resolved." });
    }

    let resolvedCount = 1;

    // Handle Multi-Schedule Resolution
    if (resolution === 'MULTI_SCHEDULE') {
      if (applyToAllRecurring) {
        // Apply multi-schedule to all recurring conflicts for this user/schedule pattern
        await resolveRecurringMultiSchedule(conflict, scheduleData, req.user.id);
        
        // Mark all related recurring conflicts as resolved
        const updateResult = await prisma.scheduleConflict.updateMany({
          where: {
            userId: conflict.userId,
            scheduleId: conflict.scheduleId,
            status: 'PENDING'
          },
          data: {
            status: 'RESOLVED',
            resolution,
            resolvedBy: req.user.id,
            resolvedAt: new Date()
          }
        });
        
        resolvedCount = updateResult.count;
      } else {
        // Apply multi-schedule to just this date
        await resolveSingleMultiSchedule(conflict, scheduleData, req.user.id);
        
        // Mark single conflict as resolved
        await prisma.scheduleConflict.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            resolution,
            resolvedBy: req.user.id,
            resolvedAt: new Date()
          }
        });
      }
    }
    // Handle other resolution types
    else if (resolution === 'CREATE_CUSTOM') {
      // Remove existing conflicting shift
      await prisma.userShift.deleteMany({
        where: {
          userId: conflict.userId,
          assignedDate: conflict.assignedDate,
          shiftId: conflict.conflictingShiftId
        }
      });
    
      // Create new shift assignment with custom shift
      await prisma.userShift.create({
        data: {
          userId: conflict.userId,
          shiftId: customShiftId,
          assignedDate: conflict.assignedDate,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Mark single conflict as resolved
      await prisma.scheduleConflict.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        }
      });
    }
    // Execute other resolution logic
    else if (resolution === 'OVERRIDE_EXISTING') {
      // Remove existing conflicting shift(s) and assign new shift
      await prisma.userShift.deleteMany({
        where: {
          userId: conflict.userId,
          assignedDate: conflict.assignedDate,
          shiftId: conflict.conflictingShiftId
        }
      });

      // Create new shift assignment
      await prisma.userShift.create({
        data: {
          userId: conflict.userId,
          shiftId: conflict.newShiftId,
          assignedDate: conflict.assignedDate,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Mark single conflict as resolved
      await prisma.scheduleConflict.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        }
      });
    } 
    else if (resolution === 'SKIP_NEW') {
      // Do nothing - keep existing shift, don't assign new one
      await prisma.scheduleConflict.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        }
      });
    } 
    else if (resolution === 'MANUAL_ASSIGN') {
      // Custom logic - treat same as SKIP_NEW, but mark differently
      await prisma.scheduleConflict.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        }
      });
    }

    // Get updated conflict data
    const updatedConflict = await prisma.scheduleConflict.findFirst({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        newShift: {
          select: {
            shiftName: true
          }
        },
        conflictingShift: {
          select: {
            shiftName: true
          }
        }
      }
    });

    return res.status(200).json({
      message: `Conflict${resolvedCount > 1 ? 's' : ''} resolved successfully using ${resolution.toLowerCase().replace('_', ' ')}.${
        resolvedCount > 1 ? ` Applied to ${resolvedCount} recurring conflicts.` : ''
      }`,
      data: {
        ...updatedConflict,
        assignedDate: updatedConflict.assignedDate.toISOString(),
        createdAt: updatedConflict.createdAt.toISOString(),
        updatedAt: updatedConflict.updatedAt.toISOString(),
        resolvedAt: updatedConflict.resolvedAt ? updatedConflict.resolvedAt.toISOString() : null,
        resolvedCount
      }
    });

  } catch (error) {
    console.error("Error resolving conflict:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * PUT /api/conflicts/bulk-resolve
 * Resolve multiple conflicts at once
 */
const bulkResolveConflicts = async (req, res) => {
  try {
    const { conflictIds, resolution, scheduleData, applyToAllRecurring = false } = req.body;

    if (!Array.isArray(conflictIds) || conflictIds.length === 0) {
      return res.status(400).json({ message: "conflictIds must be a non-empty array." });
    }

    const validResolutions = ['OVERRIDE_EXISTING', 'SKIP_NEW', 'MANUAL_ASSIGN', 'CREATE_CUSTOM', 'MULTI_SCHEDULE'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ 
        message: "Invalid resolution type. Must be one of: " + validResolutions.join(', ')
      });
    }

    // Get all conflicts
    const conflicts = await prisma.scheduleConflict.findMany({
      where: {
        id: { in: conflictIds },
        schedule: {
          companyId: req.user.companyId
        },
        status: 'PENDING'
      },
      include: {
        schedule: true,
        user: true,
        newShift: true,
        conflictingShift: true
      }
    });

    if (conflicts.length === 0) {
      return res.status(404).json({ message: "No pending conflicts found." });
    }

    const resolvedConflicts = [];
    const errors = [];

    // Process each conflict
    for (const conflict of conflicts) {
      try {
        if (resolution === 'MULTI_SCHEDULE') {
          if (applyToAllRecurring) {
            await resolveRecurringMultiSchedule(conflict, scheduleData, req.user.id);
            // Mark all related conflicts as resolved
            await prisma.scheduleConflict.updateMany({
              where: {
                userId: conflict.userId,
                scheduleId: conflict.scheduleId,
                status: 'PENDING'
              },
              data: {
                status: 'RESOLVED',
                resolution,
                resolvedBy: req.user.id,
                resolvedAt: new Date()
              }
            });
          } else {
            await resolveSingleMultiSchedule(conflict, scheduleData, req.user.id);
            await prisma.scheduleConflict.update({
              where: { id: conflict.id },
              data: {
                status: 'RESOLVED',
                resolution,
                resolvedBy: req.user.id,
                resolvedAt: new Date()
              }
            });
          }
        } else if (resolution === 'OVERRIDE_EXISTING') {
          // Remove existing and create new
          await prisma.userShift.deleteMany({
            where: {
              userId: conflict.userId,
              assignedDate: conflict.assignedDate,
              shiftId: conflict.conflictingShiftId
            }
          });

          await prisma.userShift.create({
            data: {
              userId: conflict.userId,
              shiftId: conflict.newShiftId,
              assignedDate: conflict.assignedDate,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });

          // Mark as resolved
          await prisma.scheduleConflict.update({
            where: { id: conflict.id },
            data: {
              status: 'RESOLVED',
              resolution,
              resolvedBy: req.user.id,
              resolvedAt: new Date()
            }
          });
        } else {
          // Other resolutions
          await prisma.scheduleConflict.update({
            where: { id: conflict.id },
            data: {
              status: 'RESOLVED',
              resolution,
              resolvedBy: req.user.id,
              resolvedAt: new Date()
            }
          });
        }

        resolvedConflicts.push(conflict.id);
      } catch (error) {
        console.error(`Error resolving conflict ${conflict.id}:`, error);
        errors.push({ conflictId: conflict.id, error: error.message });
      }
    }

    return res.status(200).json({
      message: `Bulk resolution completed. ${resolvedConflicts.length} conflicts resolved.`,
      data: {
        resolvedCount: resolvedConflicts.length,
        resolvedConflicts,
        errors: errors.length > 0 ? errors : undefined
      }
    });

  } catch (error) {
    console.error("Error in bulk resolve:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * GET /api/conflicts/stats
 * Get conflict statistics for the company
 */
const getConflictStats = async (req, res) => {
  try {
    const stats = await prisma.scheduleConflict.groupBy({
      by: ['status'],
      where: {
        schedule: {
          companyId: req.user.companyId
        }
      },
      _count: {
        status: true
      }
    });

    const formattedStats = {
      pending: 0,
      resolved: 0,
      ignored: 0,
      total: 0
    };

    stats.forEach(stat => {
      formattedStats[stat.status.toLowerCase()] = stat._count.status;
      formattedStats.total += stat._count.status;
    });

    // Get recent conflicts (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentConflicts = await prisma.scheduleConflict.count({
      where: {
        schedule: {
          companyId: req.user.companyId
        },
        createdAt: {
          gte: weekAgo
        }
      }
    });

    return res.status(200).json({
      message: "Conflict statistics retrieved successfully.",
      data: {
        ...formattedStats,
        recentConflicts
      }
    });

  } catch (error) {
    console.error("Error fetching conflict stats:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getConflicts,
  getConflictsBySchedule,
  resolveConflict,
  bulkResolveConflicts,
  getConflictStats
};