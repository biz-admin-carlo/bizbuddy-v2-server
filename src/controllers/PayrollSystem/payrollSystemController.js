// src/controllers/PayrollSystem/payrollSystemController.js

const { prisma } = require("@config/connection");
const generatePayslipPDF = require('@utils/generatePayslipPDF');

exports.getEmployeeList = async (req, res) => {
  try {
    const { companyId } = req.user;

    if (!companyId) {
      return res.status(400).json({ 
        success: false,
        message: "Company ID is required." 
      });
    }

    // Fetch all employees with related data
    const users = await prisma.user.findMany({
      where: {
        companyId: companyId,
        // role: {
        //   in: ['employee', 'supervisor', 'admin'] // Exclude superadmin
        // }
      },
      include: {
        profile: {
          select: {
            firstName: true,
            lastName: true,
          }
        },
        employmentDetail: {
          select: {
            jobTitle: true,
            departmentId: true,
          }
        },
        department: {
          select: {
            name: true,
          }
        },
        UserRate: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1, // Get most recent rate
          select: {
            hourlyRate: true,
          }
        }
      },
      orderBy: [
        {
          status: 'asc' // Active first, then inactive, then deleted
        },
        {
          createdAt: 'asc'
        }
      ]
    });

    // Transform data to match frontend expectations
    const employees = users.map(user => {
      const firstName = user.profile?.firstName || '';
      const lastName = user.profile?.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || user.username;
      
      return {
        id: user.id,
        name: fullName,
        position: user.employmentDetail?.jobTitle || '',
        status: user.status.charAt(0).toUpperCase() + user.status.slice(1), // Capitalize
        departmentName: user.department?.name || '',
        employeeId: user.employeeId || '',
        hourlyRate: user.UserRate?.[0]?.hourlyRate?.toString() || '0.00',
        email: user.email,
      };
    });

    // Separate by status for better organization
    const activeEmployees = employees.filter(emp => emp.status === 'Active');
    const inactiveEmployees = employees.filter(emp => emp.status === 'Inactive');
    const deletedEmployees = employees.filter(emp => emp.status === 'Deleted');

    // Combine: active first, then inactive, then deleted
    const sortedEmployees = [
      ...activeEmployees,
      ...inactiveEmployees,
      ...deletedEmployees
    ];

    return res.status(200).json({
      success: true,
      message: "Employee list retrieved successfully",
      data: {
        employees: sortedEmployees,
        count: {
          total: sortedEmployees.length,
          active: activeEmployees.length,
          inactive: inactiveEmployees.length,
          deleted: deletedEmployees.length,
        }
      }
    });

  } catch (err) {
    console.error("getEmployeeList error:", err);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.savePayrollRun = async (req, res) => {
  try {
    const { companyId, userId } = req.user;
    const {
      payDate,
      periodStart,
      periodEnd,
      checkNumberStart,
      employees,
      earningTypes,
      deductionTypes,
      totals,
      hoursData,
    } = req.body;

    // Validation
    if (!payDate || !periodStart || !periodEnd || !employees || employees.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields (payDate, periodStart, periodEnd, employees)' 
      });
    }

    // Check for duplicate period
    const existingRun = await prisma.payrollRun.findFirst({
      where: {
        companyId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        locked: true,
      },
    });

    if (existingRun) {
      return res.status(409).json({
        success: false,
        message: 'Payroll for this period has already been saved and locked.',
        data: { payrollRunId: existingRun.id },
      });
    }

    // Build frozen JSON snapshot
    const payrollSnapshot = {
      payDate,
      periodStart,
      periodEnd,
      checkNumberStart,
      processedAt: new Date().toISOString(),
      processedBy: userId,
      employees: employees.map((emp, index) => ({
        employeeId: emp.id,
        employeeName: emp.name,
        position: emp.position,
        payType: emp.payrollDetails?.payType || 'hourly',
        checkNumber: String(parseInt(checkNumberStart) + index),
        
        // Earnings breakdown
        earnings: emp.calculated.earningsBreakdown,
        grossPay: emp.calculated.grossEarnings,
        
        // Taxes breakdown
        taxes: emp.taxes,
        totalTaxes: emp.taxes.totalTaxes,
        
        // Deductions breakdown
        deductions: emp.calculated.deductionsBreakdown,
        totalDeductions: emp.calculated.totalDeductions,
        
        // Net pay (after taxes and deductions)
        netPay: emp.netPayAfterTaxes,
        
        // Hours data (if available)
        hoursData: hoursData[emp.id] || null,
      })),
      
      // Metadata
      earningTypes: earningTypes.filter(et => et.enabled !== false),
      deductionTypes: deductionTypes.filter(dt => dt.enabled !== false),
      totals,
      
      // Tax rates used (for historical record)
      taxRatesUsed: {
        federalRate: 0.12,
        stateRate: 0.05,
        ficaRate: 0.062,
        medicareRate: 0.0145,
        sdiRate: 0.011,
      },
      
      systemVersion: '1.0',
    };

    // Save to database
    const payrollRun = await prisma.payrollRun.create({
      data: {
        companyId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        payDate: new Date(payDate),
        checkNumberStart,
        status: 'finalized',
        locked: true,
        
        totalGross: parseFloat(totals.grossEarnings),
        totalTaxes: parseFloat(totals.totalTaxes),
        totalDeductions: parseFloat(totals.totalDeductions),
        totalNet: parseFloat(totals.netPay),
        
        payrollSnapshot,
        
        savedBy: userId,
        savedAt: new Date(),
      },
    });

    console.log('✅ Payroll Run Saved:', {
      id: payrollRun.id,
      period: `${periodStart} to ${periodEnd}`,
      employees: employees.length,
      totalNet: totals.netPay,
    });

    return res.status(201).json({
      success: true,
      message: 'Payroll saved successfully',
      data: {
        payrollRunId: payrollRun.id,
        periodStart,
        periodEnd,
        payDate,
        employeesProcessed: employees.length,
        totalNet: totals.netPay,
      },
    });

  } catch (error) {
    console.error('❌ Error saving payroll:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to save payroll',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

exports.getPayrollRun = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId } = req.user;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payroll run ID is required',
      });
    }

    const payrollRun = await prisma.payrollRun.findFirst({
      where: {
        id,
        companyId,
      },
      select: {
        id: true,
        payDate: true,
        periodStart: true,
        periodEnd: true,
        checkNumberStart: true,
        status: true,
        locked: true,
        totalGross: true,
        totalTaxes: true,
        totalDeductions: true,
        totalNet: true,
        payrollSnapshot: true,
        savedBy: true,
        savedAt: true,
        createdAt: true,
      },
    });

    if (!payrollRun) {
      return res.status(404).json({
        success: false,
        message: 'Payroll run not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payroll run retrieved successfully',
      data: payrollRun,
    });

  } catch (error) {
    console.error('Error fetching payroll run:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payroll run',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

exports.listPayrollRuns = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;

    const where = { companyId };
    if (status) {
      where.status = status;
    }

    const payrollRuns = await prisma.payrollRun.findMany({
      where,
      select: {
        id: true,
        payDate: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        locked: true,
        totalGross: true,
        totalNet: true,
        savedAt: true,
      },
      orderBy: {
        periodEnd: 'desc',
      },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const total = await prisma.payrollRun.count({ where });

    return res.status(200).json({
      success: true,
      message: 'Payroll runs retrieved successfully',
      data: {
        payrollRuns,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      },
    });

  } catch (error) {
    console.error('Error listing payroll runs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list payroll runs',
    });
  }
};

exports.getPayrollReports = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { from, to, year, sortBy = 'payDate' } = req.query;

    // Build date range filter
    const where = { 
      companyId,
      locked: true, // Only show saved/finalized payrolls
    };

    if (from && to && year) {
      const fromDate = new Date(`${year}-${from}`);
      const toDate = new Date(`${year}-${to}`);
      
      where.periodStart = { gte: fromDate };
      where.periodEnd = { lte: toDate };
    }

    // Determine sort order
    let orderBy = {};
    switch (sortBy) {
      case 'Pay Date':
        orderBy = { payDate: 'desc' };
        break;
      case 'Employee Name':
        orderBy = { createdAt: 'desc' }; // Fallback
        break;
      case 'Amount':
        orderBy = { totalNet: 'desc' };
        break;
      default:
        orderBy = { payDate: 'desc' };
    }

    const payrollRuns = await prisma.payrollRun.findMany({
      where,
      select: {
        id: true,
        payDate: true,
        periodStart: true,
        periodEnd: true,
        checkNumberStart: true,
        totalGross: true,
        totalTaxes: true,
        totalDeductions: true,
        totalNet: true,
        payrollSnapshot: true,
        savedAt: true,
      },
      orderBy,
    });

    // Transform data for frontend
    const reports = payrollRuns.map(run => ({
      id: run.id,
      payDate: run.payDate,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      checkNumberStart: run.checkNumberStart,
      totalGross: parseFloat(run.totalGross),
      totalTaxes: parseFloat(run.totalTaxes),
      totalDeductions: parseFloat(run.totalDeductions),
      totalNet: parseFloat(run.totalNet),
      employeeCount: run.payrollSnapshot?.employees?.length || 0,
      savedAt: run.savedAt,
      employees: run.payrollSnapshot?.employees || [],
    }));

    return res.status(200).json({
      success: true,
      message: 'Payroll reports retrieved successfully',
      data: {
        reports,
        count: reports.length,
      },
    });

  } catch (error) {
    console.error('Error fetching payroll reports:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payroll reports',
    });
  }
};

exports.getUnviewedReportsCount = async (req, res) => {
  try {
    const { companyId, userId } = req.user;

    // Count payrolls saved in last 7 days (adjust as needed)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const count = await prisma.payrollRun.count({
      where: {
        companyId,
        locked: true,
        savedAt: {
          gte: sevenDaysAgo,
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: { count },
    });

  } catch (error) {
    console.error('Error counting unviewed reports:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to count reports',
    });
  }
};

exports.generatePayslipPDF = async (req, res) => {
  try {
    const { payrollRunId, employeeId } = req.params;
    const { companyId } = req.user;

    const payrollRun = await prisma.payrollRun.findFirst({
      where: { id: payrollRunId, companyId },
      select: {
        payrollSnapshot: true,
        payDate: true,
        periodStart: true,
        periodEnd: true,
      },
    });

    if (!payrollRun) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    const employee = payrollRun.payrollSnapshot.employees.find(e => e.employeeId === employeeId);
    
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, addressLine1: true, city: true, state: true, postalCode: true },
    });

    // ✅ FIX: Get earning/deduction types from snapshot
    const earningTypes = payrollRun.payrollSnapshot.earningTypes || [];
    const deductionTypes = payrollRun.payrollSnapshot.deductionTypes || [];

    // Generate PDF with labels
    const pdfBuffer = await generatePayslipPDF(payrollRun, employee, company, earningTypes, deductionTypes);

    // ✅ FIX: Better filename
    const cleanName = employee.employeeName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const startDate = new Date(payrollRun.periodStart).toISOString().split('T')[0]; // YYYY-MM-DD
    const endDate = new Date(payrollRun.periodEnd).toISOString().split('T')[0];
    const filename = `Payslip_${cleanName}_${startDate}_to_${endDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('❌ Error generating payslip:', error);
    res.status(500).json({ success: false, message: 'Failed to generate payslip' });
  }
};