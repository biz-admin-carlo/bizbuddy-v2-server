// controllers/Cutoff/cutoffApprovalsController.js
const { PrismaClient } = require("@prisma/client");
const {
  getEmployeeScheduleForDate,
  calculateTimeLogMetrics,
  calculateBreakDeductions,
  calculatePayrollHours,
  getApprovedOvertime
} = require('../../services/Cutoff/scheduleMatchingService');

const prisma = new PrismaClient();

/**
 * GET /api/cutoff-periods/:cutoffId/approvals/pending
 * Get pending time log approvals for a cutoff period
 * INCLUDES "CLEANING" LOGIC - validates against schedules
 */
const getPendingApprovals = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { cutoffId } = req.params;
    
    // Get cutoff period with department info
    const cutoff = await prisma.cutoffPeriod.findFirst({
      where: { id: cutoffId, companyId },
      include: { 
        department: {
          select: { id: true, name: true }
        }
      }
    });
    
    if (!cutoff) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cutoff period not found' 
      });
    }
    
    // Get company grace period settings
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true }
    });
    
    const gracePeriod = company?.gracePeriodMinutes || 15;
    
    // Build user filter based on department
    const userWhere = { companyId };
    if (cutoff.departmentId) {
      userWhere.departmentId = cutoff.departmentId; // ✅ Filter by department
    }
    
    // Fetch time logs within cutoff period
    const timeLogs = await prisma.timeLog.findMany({
      where: {
        timeIn: {
          gte: cutoff.periodStart,
          lte: cutoff.periodEnd
        },
        user: userWhere, // ✅ Department filter applied here
        timeOut: { not: null } // Only completed shifts
      },
      include: {
        user: {
          include: {
            profile: true,
            department: true
          }
        },
        approval: true // Include existing approval if any
      },
      orderBy: { timeIn: 'asc' }
    });
    
    // Filter to only pending approvals
    const pendingTimeLogs = timeLogs.filter(log => {
      if (!log.approval) return true; // No approval record = pending
      return log.approval.status === 'pending';
    });

    console.log(`Found ${pendingTimeLogs.length} pending time logs for cutoff ${cutoffId}`);
    
    // "CLEAN" each time log - match against schedule and calculate
    const approvals = await Promise.all(
      pendingTimeLogs.map(async (timeLog) => {
        try {
          // 1. Get employee's schedule for this day
          const schedule = await getEmployeeScheduleForDate(
            timeLog.userId,
            timeLog.timeIn
          );
          
          // 2. Calculate metrics (late, early, variance, etc.)
          const calculatedData = calculateTimeLogMetrics(
            timeLog,
            schedule,
            gracePeriod
          );
          
          // 3. Calculate break deductions
          const breakData = await calculateBreakDeductions(
            timeLog.id,
            companyId
          );
          
          // 4. Get approved overtime
          const overtimeData = await getApprovedOvertime(timeLog.id);
          
          // 5. Calculate final payroll hours
          const payrollSummary = calculatePayrollHours(
            calculatedData,
            breakData,
            schedule
          );
          
          // 6. Add approved OT to payroll summary
          if (overtimeData.hasApprovedOT) {
            payrollSummary.approvedOTHours = overtimeData.approvedOTHours;
            payrollSummary.totalPayableHours = 
              payrollSummary.payableRegularHours + overtimeData.approvedOTHours;
          }
          
          return {
            id: `approval_${timeLog.id}`,
            timeLogId: timeLog.id,
            timeLog: timeLog,
            schedule: schedule,
            calculatedData: {
              ...calculatedData,
              hasApprovedOT: overtimeData.hasApprovedOT,
              approvedOTHours: overtimeData.approvedOTHours
            },
            breakData: breakData,
            payrollSummary: payrollSummary
          };
        } catch (error) {
          console.error(`Error processing time log ${timeLog.id}:`, error);
          // Return minimal data on error
          return {
            id: `approval_${timeLog.id}`,
            timeLogId: timeLog.id,
            timeLog: timeLog,
            schedule: null,
            calculatedData: { actualHours: 0, hasSchedule: false },
            breakData: { totalDeductions: { hours: 0 } },
            payrollSummary: { totalPayableHours: 0 },
            error: error.message
          };
        }
      })
    );
    
    res.json({
      success: true,
      data: approvals,
      gracePeriodMinutes: gracePeriod,
      department: cutoff.department,
      cutoffPeriod: {
        id: cutoff.id,
        periodStart: cutoff.periodStart,
        periodEnd: cutoff.periodEnd,
        paymentDate: cutoff.paymentDate
      }
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load pending approvals',
      error: error.message 
    });
  }
};

/**
 * GET /api/cutoff-periods/:cutoffId/approvals?status=approved|rejected
 * Get approved or rejected approvals
 */
const getApprovalsByStatus = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { cutoffId } = req.params;
    const { status = 'approved' } = req.query;
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Status must be approved or rejected' 
      });
    }
    
    const cutoff = await prisma.cutoffPeriod.findFirst({
      where: { id: cutoffId, companyId },
      include: { department: true }
    });
    
    if (!cutoff) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cutoff period not found' 
      });
    }

    // Get company grace period
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { gracePeriodMinutes: true }
    });
    const gracePeriod = company?.gracePeriodMinutes || 15;
    
    // Build user filter
    const userWhere = { companyId };
    if (cutoff.departmentId) {
      userWhere.departmentId = cutoff.departmentId;
    }
    
    // Fetch time logs with specific approval status
    const timeLogs = await prisma.timeLog.findMany({
      where: {
        timeIn: {
          gte: cutoff.periodStart,
          lte: cutoff.periodEnd
        },
        user: userWhere,
        timeOut: { not: null },
        approval: {
          status: status,
          cutoffPeriodId: cutoffId
        }
      },
      include: {
        user: {
          include: {
            profile: true,
            department: true
          }
        },
        approval: {
          include: {
            approver: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: { firstName: true, lastName: true }
                }
              }
            }
          }
        }
      },
      orderBy: { timeIn: 'asc' }
    });
    
    // Process each time log (same cleaning logic)
    const approvals = await Promise.all(
      timeLogs.map(async (timeLog) => {
        const schedule = await getEmployeeScheduleForDate(timeLog.userId, timeLog.timeIn);
        const calculatedData = calculateTimeLogMetrics(timeLog, schedule, gracePeriod);
        const breakData = await calculateBreakDeductions(timeLog.id, companyId);
        const overtimeData = await getApprovedOvertime(timeLog.id);
        const payrollSummary = calculatePayrollHours(calculatedData, breakData, schedule);
        
        if (overtimeData.hasApprovedOT) {
          payrollSummary.approvedOTHours = overtimeData.approvedOTHours;
          payrollSummary.totalPayableHours = 
            payrollSummary.payableRegularHours + overtimeData.approvedOTHours;
        }
        
        return {
          id: `approval_${timeLog.id}`,
          timeLogId: timeLog.id,
          timeLog: timeLog,
          schedule: schedule,
          calculatedData: {
            ...calculatedData,
            hasApprovedOT: overtimeData.hasApprovedOT,
            approvedOTHours: overtimeData.approvedOTHours
          },
          breakData: breakData,
          payrollSummary: payrollSummary,
          approval: timeLog.approval
        };
      })
    );
    
    res.json({
      success: true,
      data: approvals,
      gracePeriodMinutes: gracePeriod,
      department: cutoff.department
    });
  } catch (error) {
    console.error(`Error fetching ${status} approvals:`, error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to load ${status} approvals`,
      error: error.message 
    });
  }
};

/**
 * PATCH /api/cutoff-periods/:cutoffId/approvals/:approvalId
 * Approve or reject a single time log
 */
const updateApproval = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const { cutoffId, approvalId } = req.params;
    const { action, notes } = req.body; // action: 'approve' | 'reject'
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Action must be approve or reject' 
      });
    }
    
    // Extract timeLogId from approvalId (format: approval_{timeLogId})
    const timeLogId = approvalId.replace('approval_', '');
    
    // Verify time log exists and belongs to this cutoff
    const timeLog = await prisma.timeLog.findFirst({
      where: {
        id: timeLogId,
        timeIn: {
          gte: (await prisma.cutoffPeriod.findUnique({ where: { id: cutoffId } }))?.periodStart,
          lte: (await prisma.cutoffPeriod.findUnique({ where: { id: cutoffId } }))?.periodEnd
        }
      }
    });
    
    if (!timeLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Time log not found in this cutoff period' 
      });
    }
    
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    // Create or update approval record
    const approval = await prisma.timeLogApproval.upsert({
      where: { timeLogId },
      update: {
        status: newStatus,
        approvedBy: userId,
        approvedAt: new Date(),
        notes: notes || null,
        cutoffPeriodId: cutoffId
      },
      create: {
        id: `approval_record_${timeLogId}`,
        timeLogId,
        cutoffPeriodId: cutoffId,
        status: newStatus,
        approvedBy: userId,
        approvedAt: new Date(),
        notes: notes || null
      }
    });
    
    res.json({ 
      success: true, 
      data: approval,
      message: `Time log ${action}d successfully` 
    });
  } catch (error) {
    console.error('Error updating approval:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update approval',
      error: error.message 
    });
  }
};

/**
 * PATCH /api/cutoff-periods/:cutoffId/approvals/bulk
 * Bulk approve or reject multiple time logs
 */
const bulkUpdateApprovals = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const { cutoffId } = req.params;
    const { timeLogIds, action, notes } = req.body;
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Action must be approve or reject' 
      });
    }
    
    if (!Array.isArray(timeLogIds) || timeLogIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'timeLogIds must be a non-empty array' 
      });
    }
    
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const now = new Date();
    
    // Process each time log
    const results = await Promise.all(
      timeLogIds.map(async (timeLogId) => {
        try {
          const approval = await prisma.timeLogApproval.upsert({
            where: { timeLogId },
            update: {
              status: newStatus,
              approvedBy: userId,
              approvedAt: now,
              notes: notes || null,
              cutoffPeriodId: cutoffId
            },
            create: {
              id: `approval_record_${timeLogId}_${Date.now()}`,
              timeLogId,
              cutoffPeriodId: cutoffId,
              status: newStatus,
              approvedBy: userId,
              approvedAt: now,
              notes: notes || null
            }
          });
          
          return { timeLogId, success: true };
        } catch (error) {
          console.error(`Error processing ${timeLogId}:`, error);
          return { timeLogId, success: false, error: error.message };
        }
      })
    );
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({ 
      success: true,
      data: {
        total: timeLogIds.length,
        successful,
        failed,
        results
      },
      message: `${successful} time log(s) ${action}d successfully${failed > 0 ? `, ${failed} failed` : ''}` 
    });
  } catch (error) {
    console.error('Error bulk updating approvals:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to bulk update approvals',
      error: error.message 
    });
  }
};

module.exports = {
  getPendingApprovals,
  getApprovalsByStatus,
  updateApproval,
  bulkUpdateApprovals
};