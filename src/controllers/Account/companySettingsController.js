// src/controllers/Account/companySettingsController.js
const { prisma } = require("@config/connection");

exports.getSettings = async (req, res) => {
  try {
    const company = await prisma.company.findFirst({
      where: { id: req.user.companyId },
      select: {
        id: true,
        name: true,
        defaultShiftHours: true,
        minimumLunchMinutes: true,
        country: true,
        currency: true,
        language: true,
        timeZone: true,
      },
    });
    const formatted = {
      ...company,
      timezone: company.timeZone, 
    };

    delete formatted.timeZone;

    return res.json({ data: formatted });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!["admin", "superadmin"].includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });

    if (req.body.timezone && !req.body.timeZone) {
      req.body.timeZone = req.body.timezone;
    }

    const {
      defaultShiftHours,
      minimumLunchMinutes,
      gracePeriodMinutes,
      country,
      currency,
      language,
      timeZone,
    } = req.body;

    const updated = await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        ...(defaultShiftHours !== undefined && {
          defaultShiftHours:
            defaultShiftHours === null ? null : Number(defaultShiftHours) || null,
        }),
        ...(minimumLunchMinutes !== undefined && {
          minimumLunchMinutes:
            minimumLunchMinutes === null
              ? null
              : Number(minimumLunchMinutes) || 0,
        }),
        // ✅ NEW: Grace period update logic
        ...(gracePeriodMinutes !== undefined && {
          gracePeriodMinutes:
            gracePeriodMinutes === null
              ? 15  // Default to 15 if set to null
              : Number(gracePeriodMinutes) || 15,
        }),
        ...(timeZone !== undefined && { timeZone }),
        country,
        currency,
        language,
      },
      select: {
        id: true,
        defaultShiftHours: true,
        minimumLunchMinutes: true,
        gracePeriodMinutes: true,  
        country: true,
        currency: true,
        language: true,
        timeZone: true,
      },
    });
    
    console.log('[✅ Company settings updated]', updated);
    res.json({ data: updated });
  } catch (e) {
    console.error("updateSettings error:", e);
    res.status(400).json({ error: e.message });
  }
};

exports.getCheckSettings = async (req, res) => {
  try {
    const { companyId } = req.user;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        checkTemplate: true,
        checkPositions: true,
      },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Return saved positions or defaults
    const defaultPositions = {
      date: { x: 480, y: 95 },
      amountWords: { x: 90, y: 135 },
      amountNumber: { x: 455, y: 133 },
      payeeName: { x: 90, y: 170 },
      payeeAddress: { x: 90, y: 185 },
    };

    return res.status(200).json({
      success: true,
      data: {
        checkTemplate: company.checkTemplate || 'default',
        checkPositions: company.checkPositions || defaultPositions,
      },
    });

  } catch (error) {
    console.error("Error fetching check settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch check settings",
    });
  }
};

exports.updateCheckSettings = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { checkTemplate, checkPositions } = req.body;

    // Validate positions
    if (checkPositions) {
      const requiredFields = ['date', 'amountWords', 'amountNumber', 'payeeName', 'payeeAddress'];
      for (const field of requiredFields) {
        if (!checkPositions[field] || 
            typeof checkPositions[field].x !== 'number' || 
            typeof checkPositions[field].y !== 'number') {
          return res.status(400).json({
            success: false,
            message: `Invalid position data for ${field}`,
          });
        }
      }
    }

    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        checkTemplate: checkTemplate || 'default',
        checkPositions: checkPositions,
      },
      select: {
        checkTemplate: true,
        checkPositions: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Check settings updated successfully",
      data: updatedCompany,
    });

  } catch (error) {
    console.error("Error updating check settings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update check settings",
    });
  }
};

exports.getCheckTemplates = async (req, res) => {
  try {
    // Pre-defined templates for common banks
    const templates = {
      default: {
        name: "Default Template",
        positions: {
          date: { x: 480, y: 95, fontSize: 10 },
          amountWords: { x: 90, y: 135, fontSize: 10 },
          amountNumber: { x: 455, y: 133, fontSize: 14 },
          payeeName: { x: 90, y: 170, fontSize: 11 },
          payeeAddress: { x: 90, y: 185, fontSize: 9 },
        },
      },
      bofa: {
        name: "Bank of America",
        positions: {
          date: { x: 480, y: 95, fontSize: 10 },
          amountWords: { x: 90, y: 135, fontSize: 10 },
          amountNumber: { x: 455, y: 133, fontSize: 14 },
          payeeName: { x: 90, y: 170, fontSize: 11 },
          payeeAddress: { x: 90, y: 185, fontSize: 9 },
        },
      },
      chase: {
        name: "Chase Bank",
        positions: {
          date: { x: 490, y: 90 },
          amountWords: { x: 95, y: 130 },
          amountNumber: { x: 460, y: 128 },
          payeeName: { x: 95, y: 165 },
          payeeAddress: { x: 95, y: 180 },
        },
      },
      wells_fargo: {
        name: "Wells Fargo",
        positions: {
          date: { x: 475, y: 92 },
          amountWords: { x: 88, y: 132 },
          amountNumber: { x: 450, y: 130 },
          payeeName: { x: 88, y: 168 },
          payeeAddress: { x: 88, y: 183 },
        },
      },
      quickbooks: {
        name: "QuickBooks Compatible",
        positions: {
          date: { x: 485, y: 98 },
          amountWords: { x: 92, y: 138 },
          amountNumber: { x: 458, y: 136 },
          payeeName: { x: 92, y: 173 },
          payeeAddress: { x: 92, y: 188 },
        },
      },
    };

    return res.status(200).json({
      success: true,
      data: { templates },
    });

  } catch (error) {
    console.error("Error fetching templates:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
    });
  }
};

exports.generateTestCheckPDF = async (req, res) => {
  try {
    const { positions, mockData } = req.body;
    const { companyId } = req.user;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { 
        name: true, 
        addressLine1: true, 
        city: true, 
        state: true, 
        postalCode: true 
      },
    });

    // Mock employee data
    const mockEmployee = {
      employeeName: mockData.payeeName,
      address: mockData.payeeAddress,
      checkNumber: '6389',
      netPay: parseFloat(mockData.amountNumber.replace(/,/g, '')),
    };

    // Mock payroll run
    const mockPayrollRun = {
      payDate: new Date(),
      periodStart: new Date(),
      periodEnd: new Date(),
    };

    // Temporarily override company positions for this test
    const testCompany = {
      ...company,
      checkPositions: positions,
    };

    const generateCheckPDF = require('@utils/generateCheckPDF');
    const pdfBuffer = await generateCheckPDF(
      mockPayrollRun, 
      mockEmployee, 
      testCompany, 
      [], // No earnings for test
      []  // No deductions for test
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Test_Check_Preview.pdf"');
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating test check:', error);
    res.status(500).json({ success: false, message: 'Failed to generate test check' });
  }
};