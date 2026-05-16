// services/Cutoff/cutoffGenerationService.js
// ✅ COMPLETE WITH APPROVAL RECORD CREATION

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * ✅ NEW: Create TimeLogApproval records for a cutoff period
 */
async function createApprovalRecords(cutoffPeriodId, periodStart, periodEnd, companyId, departmentId) {
  try {
    // Build user filter based on department
    const userWhere = { companyId };
    if (departmentId) {
      userWhere.departmentId = departmentId;
    }
    
    // Find time logs in this period for this department
    const timeLogs = await prisma.timeLog.findMany({
      where: {
        timeIn: {
          gte: periodStart,
          lte: periodEnd
        },
        timeOut: { not: null }, // Only completed shifts
        user: userWhere
      },
      select: { id: true }
    });
    
    if (timeLogs.length === 0) {
      console.log(`[ℹ️ No time logs found] ${periodStart.toISOString().split('T')[0]} - ${periodEnd.toISOString().split('T')[0]}`);
      return 0;
    }
    
    // Create approval records
    const created = await prisma.timeLogApproval.createMany({
      data: timeLogs.map(log => ({
        timeLogId: log.id,
        cutoffPeriodId,
        status: 'pending'
      })),
      skipDuplicates: true // Important: skip if already exists
    });
    
    console.log(`[✅ Created ${created.count} approval records] Cutoff: ${cutoffPeriodId}`);
    return created.count;
  } catch (error) {
    console.error('[❌ Error creating approval records]', error);
    return 0;
  }
}

/**
 * ✅ NEW: Generate periods between specific dates (for historical backfill)
 */
function generatePeriodsBetweenDates(startDate, endDate, frequency, paymentOffset) {
  const periods = [];
  let currentStart = new Date(startDate);
  const targetEnd = new Date(endDate);
  
  let iterationCount = 0;
  const maxIterations = 200; // Increased for historical data
  
  while (currentStart <= targetEnd && iterationCount < maxIterations) {
    const periodEnd = calculatePeriodEnd(currentStart, frequency);
    
    // Stop if we've passed the target end date
    if (periodEnd > targetEnd) {
      break;
    }
    
    const paymentDate = new Date(periodEnd);
    paymentDate.setDate(paymentDate.getDate() + paymentOffset);
    
    periods.push({
      periodStart: new Date(currentStart),
      periodEnd: periodEnd,
      paymentDate: paymentDate
    });
    
    // Next period starts the day after current ends
    currentStart = new Date(periodEnd);
    currentStart.setDate(currentStart.getDate() + 1);
    iterationCount++;
  }
  
  return periods;
}

/**
 * ✅ UPDATED: Generate period dates with optional historical support
 */
function generatePeriodDates(startDate, frequency, paymentOffset, months, includeHistorical = false) {
  const periods = [];
  let currentStart = new Date(startDate);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + months);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let iterationCount = 0;
  const maxIterations = 200; // Increased for historical data
  
  while (currentStart < endDate && iterationCount < maxIterations) {
    const periodEnd = calculatePeriodEnd(currentStart, frequency);
    const paymentDate = new Date(periodEnd);
    paymentDate.setDate(paymentDate.getDate() + paymentOffset);
    
    // ✅ FIXED: Allow past periods if includeHistorical is true
    const shouldInclude = includeHistorical ? true : periodEnd >= today;
    
    if (shouldInclude) {
      periods.push({
        periodStart: new Date(currentStart),
        periodEnd: periodEnd,
        paymentDate: paymentDate
      });
    }
    
    currentStart = new Date(periodEnd);
    currentStart.setDate(currentStart.getDate() + 1);
    iterationCount++;
  }
  
  return periods;
}

/**
 * Helper: Calculate period end date based on frequency
 */
function calculatePeriodEnd(startDate, frequency) {
  const end = new Date(startDate);
  
  switch (frequency) {
    case 'bi-weekly':
      // 14 days (2 weeks)
      end.setDate(end.getDate() + 13); // 13 days after start = 14 days total
      break;
      
    case 'bi-monthly':
      // Twice a month: 1-15, 16-end of month
      const dayOfMonth = startDate.getDate();
      
      if (dayOfMonth === 1) {
        // Period 1-15
        end.setDate(15);
      } else if (dayOfMonth === 16) {
        // Period 16-end of month
        end.setMonth(end.getMonth() + 1, 0); // Last day of current month
      } else {
        // Handle edge cases - default to 15 days
        end.setDate(end.getDate() + 14);
      }
      break;
      
    case 'monthly':
      // One month from start, ending on last day before next period
      end.setMonth(end.getMonth() + 1);
      end.setDate(end.getDate() - 1); // Day before next month starts
      break;
      
    default:
      throw new Error(`Invalid frequency: ${frequency}`);
  }
  
  return end;
}

/**
 * ✅ UPDATED: Generate cutoff periods with historical support + approval records
 */
const generateCutoffPeriods = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const { 
      departmentId, 
      months = 3,
      includeHistorical = false,  // ✅ NEW PARAMETER
      fromDate = null,            // ✅ NEW: Generate from specific date
      toDate = null               // ✅ NEW: Generate to specific date
    } = req.body;
    
    // Get department settings
    const settings = await prisma.departmentCutoffSettings.findFirst({
      where: { companyId, departmentId: departmentId ?? null },
      include: { department: true }
    });

    if (!settings) {
      return res.status(404).json({ 
        success: false, 
        message: 'Department cutoff settings not found. Please configure settings first.' 
      });
    }

    if (!settings.isActive) {
      return res.status(400).json({ 
        success: false, 
        message: 'Department cutoff settings are inactive. Please activate first.' 
      });
    }
    
    let periods;
    
    // ✅ Option 1: Generate between specific dates (for historical backfill)
    if (fromDate && toDate) {
      console.log(`[📅 Generating historical periods] ${settings.department.name}: ${fromDate} → ${toDate}`);
      periods = generatePeriodsBetweenDates(
        new Date(fromDate),
        new Date(toDate),
        settings.frequency,
        settings.paymentOffsetDays
      );
    }
    // ✅ Option 2: Generate X months with historical option
    else {
      console.log(`[📅 Generating ${months} months] ${settings.department.name} (includeHistorical: ${includeHistorical})`);
      periods = generatePeriodDates(
        settings.startDate,
        settings.frequency,
        settings.paymentOffsetDays,
        months,
        includeHistorical
      );
    }
    
    if (periods.length === 0) {
      return res.json({
        success: true,
        data: { 
          created: 0, 
          skipped: 0,
          departmentName: settings.department.name 
        },
        message: 'No periods to generate for the specified date range'
      });
    }
    
    // Check for existing periods (avoid duplicates)
    const existingPeriods = await prisma.cutoffPeriod.findMany({
      where: {
        companyId,
        departmentId,
        periodStart: { 
          in: periods.map(p => new Date(p.periodStart)) 
        }
      },
      select: { periodStart: true }
    });
    
    const existingStarts = new Set(
      existingPeriods.map(p => p.periodStart.toISOString().split('T')[0])
    );
    
    // Filter out existing periods
    const newPeriods = periods.filter(p => {
      const dateStr = new Date(p.periodStart).toISOString().split('T')[0];
      return !existingStarts.has(dateStr);
    });
    
    if (newPeriods.length === 0) {
      return res.json({
        success: true,
        data: { 
          created: 0, 
          skipped: periods.length,
          departmentName: settings.department.name 
        },
        message: `All ${periods.length} periods already exist for ${settings.department.name}`
      });
    }
    
    // ✅ Auto-set status based on date (past = processed, current/future = open)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // ✅ CREATE PERIODS ONE BY ONE (so we get IDs back for approval records)
    const createdPeriods = [];
    let totalApprovals = 0;
    
    for (const period of newPeriods) {
      const cutoffId = `cutoff_${departmentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create the cutoff period
      const cutoff = await prisma.cutoffPeriod.create({
        data: {
          id: cutoffId,
          companyId,
          departmentId,
          periodStart: new Date(period.periodStart),
          periodEnd: new Date(period.periodEnd),
          paymentDate: new Date(period.paymentDate),
          frequency: settings.frequency,
          status: new Date(period.periodEnd) < today ? 'processed' : 'open',
          isAutoGenerated: true,
          createdBy: userId
        }
      });
      
      // ✅ Create approval records for this period
      const approvalCount = await createApprovalRecords(
        cutoff.id,
        cutoff.periodStart,
        cutoff.periodEnd,
        companyId,
        departmentId
      );
      
      totalApprovals += approvalCount;
      createdPeriods.push(cutoff);
      
      console.log(`[✅ Period created] ${cutoff.periodStart.toISOString().split('T')[0]} - ${cutoff.periodEnd.toISOString().split('T')[0]} (${approvalCount} approvals)`);
    }
    
    // ✅ Count historical vs future
    const historicalCount = createdPeriods.filter(p => new Date(p.periodEnd) < today).length;
    const futureCount = createdPeriods.filter(p => new Date(p.periodEnd) >= today).length;
    
    console.log(`[✅ Generation complete] Created: ${createdPeriods.length} periods, ${totalApprovals} approvals`);
    
    res.json({
      success: true,
      data: { 
        created: createdPeriods.length,
        skipped: existingPeriods.length,
        historical: historicalCount,
        future: futureCount,
        totalApprovals,
        departmentName: settings.department.name,
        frequency: settings.frequency
      },
      message: `Generated ${createdPeriods.length} cutoff periods for ${settings.department.name}${historicalCount > 0 ? ` (${historicalCount} historical)` : ''} with ${totalApprovals} time log approvals`
    });
  } catch (error) {
    console.error('❌ Error generating cutoff periods:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate cutoff periods',
      error: error.message 
    });
  }
};

/**
 * ✅ UPDATED: Bulk generate for all departments with historical support + approvals
 */
const generateAllDepartmentCutoffs = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const { 
      months = 3,
      includeHistorical = false,
      fromDate = null,
      toDate = null
    } = req.body;
    
    // Get all active department settings
    const allSettings = await prisma.departmentCutoffSettings.findMany({
      where: { 
        companyId,
        isActive: true 
      },
      include: {
        department: { select: { name: true } }
      }
    });

    if (allSettings.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active department cutoff settings found' 
      });
    }

    const results = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Generate for each department
    for (const settings of allSettings) {
      try {
        let periods;
        
        if (fromDate && toDate) {
          periods = generatePeriodsBetweenDates(
            new Date(fromDate),
            new Date(toDate),
            settings.frequency,
            settings.paymentOffsetDays
          );
        } else {
          periods = generatePeriodDates(
            settings.startDate,
            settings.frequency,
            settings.paymentOffsetDays,
            months,
            includeHistorical
          );
        }

        // Check existing
        const existingPeriods = await prisma.cutoffPeriod.findMany({
          where: {
            companyId,
            departmentId: settings.departmentId,
            periodStart: { in: periods.map(p => new Date(p.periodStart)) }
          },
          select: { periodStart: true }
        });

        const existingStarts = new Set(
          existingPeriods.map(p => p.periodStart.toISOString().split('T')[0])
        );

        const newPeriods = periods.filter(p => {
          const dateStr = new Date(p.periodStart).toISOString().split('T')[0];
          return !existingStarts.has(dateStr);
        });

        if (newPeriods.length > 0) {
          const createdPeriods = [];
          let totalApprovals = 0;
          
          // ✅ Create periods one by one with approval records
          for (const period of newPeriods) {
            const cutoffId = `cutoff_${settings.departmentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const cutoff = await prisma.cutoffPeriod.create({
              data: {
                id: cutoffId,
                companyId,
                departmentId: settings.departmentId,
                periodStart: new Date(period.periodStart),
                periodEnd: new Date(period.periodEnd),
                paymentDate: new Date(period.paymentDate),
                frequency: settings.frequency,
                status: new Date(period.periodEnd) < today ? 'processed' : 'open',
                isAutoGenerated: true,
                createdBy: userId
              }
            });
            
            // ✅ Create approval records
            const approvalCount = await createApprovalRecords(
              cutoff.id,
              cutoff.periodStart,
              cutoff.periodEnd,
              companyId,
              settings.departmentId
            );
            
            totalApprovals += approvalCount;
            createdPeriods.push(cutoff);
          }

          const historicalCount = createdPeriods.filter(p => new Date(p.periodEnd) < today).length;

          results.push({
            department: settings.department.name,
            created: createdPeriods.length,
            skipped: existingPeriods.length,
            historical: historicalCount,
            future: createdPeriods.length - historicalCount,
            totalApprovals
          });
        } else {
          results.push({
            department: settings.department.name,
            created: 0,
            skipped: periods.length,
            totalApprovals: 0
          });
        }
      } catch (error) {
        console.error(`Error generating for ${settings.department.name}:`, error);
        results.push({
          department: settings.department.name,
          error: error.message
        });
      }
    }

    const totalCreated = results.reduce((sum, r) => sum + (r.created || 0), 0);
    const totalHistorical = results.reduce((sum, r) => sum + (r.historical || 0), 0);
    const totalApprovals = results.reduce((sum, r) => sum + (r.totalApprovals || 0), 0);

    res.json({
      success: true,
      data: {
        totalCreated,
        totalHistorical,
        totalApprovals,
        departments: results.length,
        details: results
      },
      message: `Generated ${totalCreated} cutoff periods across ${results.length} departments${totalHistorical > 0 ? ` (${totalHistorical} historical)` : ''} with ${totalApprovals} approvals`
    });
  } catch (error) {
    console.error('Error generating all department cutoffs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate cutoffs for all departments',
      error: error.message 
    });
  }
};

module.exports = {
  generateCutoffPeriods,
  generateAllDepartmentCutoffs,
  generatePeriodDates,
  generatePeriodsBetweenDates,
  createApprovalRecords
};