// src/controllers/PayrollSystem/payrollSystemController.js

const { prisma } = require("@config/connection");

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
        role: {
          in: ['employee', 'supervisor', 'admin'] // Exclude superadmin
        }
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

exports.generatePayrollPDF = async (req, res) => {
  try {
    const { payrollData, dateRange, employees, earningTypes, deductionTypes, checkNumber } = req.body;
    const companyId = req.user.companyId;

    // Fetch company info
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
        businessEmail: true,
        phoneNumber: true,
        gracePeriodMinutes: true,
      },
    });

    // Helper function to parse decimal
    const parseDecimal = (value) => {
      if (!value || value === '') return 0;
      const parsed = parseFloat(value.toString().replace(/,/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    };

    const round2 = (num) => Math.round(num * 100) / 100;

    // Calculate earnings and deductions for each employee
    const processedEmployees = employees.map(emp => {
      const empData = payrollData[emp.userId] || { earnings: {}, deductions: {} };
      
      let grossEarnings = 0;
      const earningsDetail = [];

      // Process earnings
      earningTypes.forEach(et => {
        const value = parseDecimal(empData.earnings[et.id]);
        if (value > 0) {
          grossEarnings += value;
          earningsDetail.push({
            label: et.label,
            value: value,
            type: et.calculationType,
          });
        }
      });

      let totalDeductions = 0;
      const deductionsDetail = [];

      // Process deductions
      deductionTypes.forEach(dt => {
        const value = parseDecimal(empData.deductions[dt.id]);
        if (value > 0) {
          totalDeductions += value;
          deductionsDetail.push({
            label: dt.label,
            value: value,
            isPreTax: dt.isPreTax,
          });
        }
      });

      const netPay = round2(grossEarnings - totalDeductions);

      return {
        name: emp.employeeName,
        position: emp.position || 'N/A',
        payType: emp.payType,
        grossEarnings: round2(grossEarnings),
        totalDeductions: round2(totalDeductions),
        netPay: netPay,
        earningsDetail,
        deductionsDetail,
        regularHours: parseDecimal(empData.earnings[earningTypes.find(et => et.code === 'regular_hours')?.id]),
        overtimeHours: parseDecimal(empData.earnings[earningTypes.find(et => et.code === 'overtime')?.id]),
      };
    }).filter(emp => emp.grossEarnings > 0); // Only include employees with earnings

    // Calculate totals
    const totals = {
      totalEmployees: processedEmployees.length,
      totalGross: round2(processedEmployees.reduce((sum, emp) => sum + emp.grossEarnings, 0)),
      totalDeductions: round2(processedEmployees.reduce((sum, emp) => sum + emp.totalDeductions, 0)),
      totalNet: round2(processedEmployees.reduce((sum, emp) => sum + emp.netPay, 0)),
      totalRegularHours: round2(processedEmployees.reduce((sum, emp) => sum + emp.regularHours, 0)),
      totalOvertimeHours: round2(processedEmployees.reduce((sum, emp) => sum + emp.overtimeHours, 0)),
    };

    // ═══════════════════════════════════════════════════════
    // CREATE PDF
    // ═══════════════════════════════════════════════════════
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 50,
      info: {
        Title: `Payroll Report - ${dateRange.payFrom}`,
        Author: company.name,
        Subject: 'Payroll Summary Report',
      }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payroll-report-${dateRange.payFrom}-${dateRange.payTo}.pdf`
    );

    // Pipe PDF to response
    doc.pipe(res);

    // ═══════════════════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════════════════
    doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .text('PAYROLL SUMMARY REPORT', { align: 'center' })
      .moveDown(0.5);

    doc
      .fontSize(10)
      .font('Helvetica')
      .text(company.name, { align: 'center' })
      .text(`${company.addressLine1 || ''} ${company.city || ''}, ${company.state || ''} ${company.postalCode || ''}`, { align: 'center' })
      .text(company.businessEmail || '', { align: 'center' })
      .moveDown(1.5);

    // ═══════════════════════════════════════════════════════
    // PAY PERIOD INFO
    // ═══════════════════════════════════════════════════════
    const infoY = doc.y;
    
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Pay Period:', 50, infoY)
      .font('Helvetica')
      .text(`${dateRange.payFrom} - ${dateRange.payTo}`, 160, infoY);

    doc
      .font('Helvetica-Bold')
      .text('Pay Date:', 50, doc.y + 5)
      .font('Helvetica')
      .text(dateRange.payDate || new Date().toISOString().split('T')[0], 160, doc.y - 12);

    doc
      .font('Helvetica-Bold')
      .text('Check Starting #:', 50, doc.y + 5)
      .font('Helvetica')
      .text(checkNumber || 'N/A', 160, doc.y - 12);

    doc.moveDown(2);

    if (req.body.excludedEmployees && req.body.excludedEmployees.length > 0) {
      doc.moveDown(0.5);
      
      const noticeBoxY = doc.y;
      const noticeHeight = 40 + (Math.ceil(req.body.excludedEmployees.length / 3) * 12);
      
      doc
        .rect(50, noticeBoxY, 495, noticeHeight)
        .fillAndStroke('#FEF3C7', '#F59E0B');
      
      doc
        .fillColor('#92400E')
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('⚠️ EXCLUDED EMPLOYEES (No Pay Rate)', 60, noticeBoxY + 10);
      
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#78350F')
        .text(
          `The following ${req.body.excludedEmployees.length} employee(s) were excluded from this report due to missing pay rate configuration:`,
          60,
          noticeBoxY + 25,
          { width: 475 }
        );
      
      doc
        .fontSize(8)
        .fillColor('#92400E')
        .text(
          req.body.excludedEmployees.join(', '),
          60,
          doc.y + 5,
          { width: 475 }
        );
      
      doc.fillColor('#000000');
      doc.y = noticeBoxY + noticeHeight + 10;
    }
    
    doc.moveDown(1);

    // ═══════════════════════════════════════════════════════
    // SUMMARY BOX
    // ═══════════════════════════════════════════════════════
    const summaryBoxY = doc.y;
    const summaryBoxHeight = 100;

    doc
      .rect(50, summaryBoxY, 495, summaryBoxHeight)
      .fillAndStroke('#F3F4F6', '#E5E7EB');

    doc
      .fillColor('#000000')
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('PAYROLL SUMMARY', 50 + 10, summaryBoxY + 10, { width: 475 });

    const summaryY = summaryBoxY + 40;
    const col1X = 70;
    const col2X = 180;
    const col3X = 290;
    const col4X = 400;

    // Row 1: Employees and Hours
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6B7280')
      .text('EMPLOYEES', col1X, summaryY)
      .text('REGULAR HRS', col2X, summaryY)
      .text('OVERTIME HRS', col3X, summaryY)
      .text('TOTAL HOURS', col4X, summaryY);

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text(totals.totalEmployees.toString(), col1X, summaryY + 15)
      .fillColor('#3B82F6')
      .text(totals.totalRegularHours.toFixed(1), col2X, summaryY + 15)
      .fillColor('#F59E0B')
      .text(totals.totalOvertimeHours.toFixed(1), col3X, summaryY + 15)
      .fillColor('#10B981')
      .text((totals.totalRegularHours + totals.totalOvertimeHours).toFixed(1), col4X, summaryY + 15);

    // Row 2: Financial Summary
    const summaryY2 = summaryY + 40;
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6B7280')
      .text('GROSS PAY', col1X, summaryY2)
      .text('DEDUCTIONS', col2X, summaryY2)
      .text('NET PAY', col3X, summaryY2);

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#10B981')
      .text(`$${totals.totalGross.toLocaleString('en-US', {minimumFractionDigits: 2})}`, col1X, summaryY2 + 15)
      .fillColor('#EF4444')
      .text(`$${totals.totalDeductions.toLocaleString('en-US', {minimumFractionDigits: 2})}`, col2X, summaryY2 + 15)
      .fillColor('#3B82F6')
      .text(`$${totals.totalNet.toLocaleString('en-US', {minimumFractionDigits: 2})}`, col3X, summaryY2 + 15);

    doc.fillColor('#000000');
    doc.y = summaryBoxY + summaryBoxHeight + 20;

    // ═══════════════════════════════════════════════════════
    // EMPLOYEE TABLE HEADER
    // ═══════════════════════════════════════════════════════
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('EMPLOYEE PAYROLL DETAILS', 50, doc.y)
      .moveDown(0.5);

    const tableTop = doc.y;
    const rowHeight = 35;
    
    // Table header
    doc
      .rect(50, tableTop, 495, rowHeight)
      .fillAndStroke('#374151', '#374151');

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#FFFFFF')
      .text('EMPLOYEE', 60, tableTop + 12)
      .text('HOURS', 240, tableTop + 12, { width: 60, align: 'center' })
      .text('GROSS', 310, tableTop + 12, { width: 70, align: 'right' })
      .text('DEDUCT', 390, tableTop + 12, { width: 70, align: 'right' })
      .text('NET PAY', 470, tableTop + 12, { width: 65, align: 'right' });

    doc.fillColor('#000000');

    // ═══════════════════════════════════════════════════════
    // EMPLOYEE ROWS
    // ═══════════════════════════════════════════════════════
    let currentY = tableTop + rowHeight;

    processedEmployees.forEach((emp, index) => {
      // Check if we need a new page
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      // Alternating row colors
      const bgColor = index % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      doc
        .rect(50, currentY, 495, rowHeight)
        .fillAndStroke(bgColor, '#E5E7EB');

      // Employee Name & Position
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text(emp.name, 60, currentY + 8, { width: 170, ellipsis: true })
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#6B7280')
        .text(emp.position, 60, currentY + 22, { width: 170, ellipsis: true });

      // Hours (Regular + OT)
      const totalHours = emp.regularHours + emp.overtimeHours;
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text(`${totalHours.toFixed(1)}h`, 240, currentY + 12, { width: 60, align: 'center' });

      // Gross Pay
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#10B981')
        .text(`$${emp.grossEarnings.toLocaleString('en-US', {minimumFractionDigits: 2})}`, 310, currentY + 12, { width: 70, align: 'right' });

      // Deductions
      doc
        .fillColor('#EF4444')
        .text(`$${emp.totalDeductions.toLocaleString('en-US', {minimumFractionDigits: 2})}`, 390, currentY + 12, { width: 70, align: 'right' });

      // Net Pay
      doc
        .fillColor(emp.netPay < 0 ? '#EF4444' : '#3B82F6')
        .font('Helvetica-Bold')
        .text(`$${emp.netPay.toLocaleString('en-US', {minimumFractionDigits: 2})}`, 470, currentY + 12, { width: 65, align: 'right' });

      currentY += rowHeight;
    });

    doc.fillColor('#000000');

    // ═══════════════════════════════════════════════════════
    // FOOTER
    // ═══════════════════════════════════════════════════════
    const footerY = 750;
    
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#6B7280')
      .text(
        `Generated on ${new Date().toLocaleString('en-US', { 
          dateStyle: 'long', 
          timeStyle: 'short' 
        })}`,
        50,
        footerY,
        { align: 'center', width: 495 }
      )
      .text(
        `Report prepared by ${req.user.username || 'System'} | ${company.name}`,
        50,
        footerY + 12,
        { align: 'center', width: 495 }
      );

    // Finalize PDF
    doc.end();

    console.log(`[✅ Payroll PDF Generated] ${totals.totalEmployees} employees`);

  } catch (error) {
    console.error("❌ Error generating payroll PDF:", error);
    return res.status(500).json({ 
      success: false,
      message: "Failed to generate PDF report", 
      error: error.message 
    });
  }
};