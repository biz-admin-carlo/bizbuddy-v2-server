// controllers/Cutoff/cutoffSettingsController.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * GET /api/cutoff-settings/departments
 * Fetch all department cutoff configurations
 */
const getDepartmentSettings = async (req, res) => {
  try {
    const { companyId } = req.user;
    
    const settings = await prisma.departmentCutoffSettings.findMany({
      where: { 
        companyId, 
        isActive: true 
      },
      include: {
        department: {
          select: { 
            id: true, 
            name: true,
            users: {
              select: { id: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Add employee count to each setting
    const settingsWithStats = settings.map(setting => ({
      ...setting,
      employeeCount: setting.department.users.length
    }));
    
    res.json({ 
      success: true, 
      data: settingsWithStats 
    });
  } catch (error) {
    console.error('Error fetching department settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch department settings',
      error: error.message 
    });
  }
};

/**
 * GET /api/cutoff-settings/departments/:departmentId
 * Get specific department cutoff configuration
 */
const getDepartmentSetting = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { departmentId } = req.params;
    
    const setting = await prisma.departmentCutoffSettings.findUnique({
      where: { departmentId },
      include: {
        department: {
          select: { 
            id: true, 
            name: true,
            users: { select: { id: true } }
          }
        }
      }
    });

    if (!setting || setting.companyId !== companyId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Department cutoff settings not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: {
        ...setting,
        employeeCount: setting.department.users.length
      }
    });
  } catch (error) {
    console.error('Error fetching department setting:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch department setting',
      error: error.message 
    });
  }
};

/**
 * POST /api/cutoff-settings/departments
 * Create or update department cutoff configuration
 */
const saveDepartmentSettings = async (req, res) => {
  try {
    const { companyId, id: userId } = req.user;
    const { departmentId, frequency, startDate, paymentOffsetDays } = req.body;
    
    // Validate required fields
    if (!departmentId || !frequency || !startDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Department, frequency, and start date are required' 
      });
    }

    // Validate frequency
    const validFrequencies = ['bi-weekly', 'bi-monthly', 'monthly'];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` 
      });
    }

    // Validate payment offset
    const offset = paymentOffsetDays || 5;
    if (offset < 1 || offset > 30) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment offset must be between 1 and 30 days' 
      });
    }
    
    // Check if department exists and belongs to company
    const department = await prisma.department.findFirst({
      where: { 
        id: departmentId, 
        companyId 
      }
    });
    
    if (!department) {
      return res.status(404).json({ 
        success: false, 
        message: 'Department not found or does not belong to your company' 
      });
    }
    
    // Upsert settings (create or update)
    const settings = await prisma.departmentCutoffSettings.upsert({
      where: { departmentId },
      update: {
        frequency,
        startDate: new Date(startDate),
        paymentOffsetDays: offset,
        updatedAt: new Date()
      },
      create: {
        id: `dept_cutoff_${Date.now()}`,
        companyId,
        departmentId,
        frequency,
        startDate: new Date(startDate),
        paymentOffsetDays: offset
      },
      include: {
        department: {
          select: { id: true, name: true }
        }
      }
    });
    
    res.json({ 
      success: true, 
      data: settings,
      message: `Cutoff settings saved for ${department.name}` 
    });
  } catch (error) {
    console.error('Error saving department settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save department settings',
      error: error.message 
    });
  }
};

/**
 * DELETE /api/cutoff-settings/departments/:departmentId
 * Deactivate department cutoff configuration
 */
const deactivateDepartmentSettings = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { departmentId } = req.params;
    
    // Verify ownership
    const setting = await prisma.departmentCutoffSettings.findUnique({
      where: { departmentId }
    });

    if (!setting || setting.companyId !== companyId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Department cutoff settings not found' 
      });
    }
    
    // Soft delete (deactivate)
    await prisma.departmentCutoffSettings.update({
      where: { departmentId },
      data: { 
        isActive: false,
        updatedAt: new Date()
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Department cutoff settings deactivated' 
    });
  } catch (error) {
    console.error('Error deactivating department settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to deactivate department settings',
      error: error.message 
    });
  }
};

/**
 * GET /api/cutoff-settings/departments/:departmentId/preview
 * Preview upcoming cutoff periods for a department
 */
const previewDepartmentCutoffs = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { departmentId } = req.params;
    const { months = 3 } = req.query;
    
    const setting = await prisma.departmentCutoffSettings.findUnique({
      where: { departmentId },
      include: {
        department: { select: { name: true } }
      }
    });

    if (!setting || setting.companyId !== companyId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Department cutoff settings not found' 
      });
    }

    // Import generation service
    const { generatePeriodDates } = require('../../services/Cutoff/cutoffGenerationService');
    
    const periods = generatePeriodDates(
      setting.startDate,
      setting.frequency,
      setting.paymentOffsetDays,
      parseInt(months)
    );
    
    res.json({ 
      success: true, 
      data: {
        department: setting.department.name,
        frequency: setting.frequency,
        startDate: setting.startDate,
        paymentOffsetDays: setting.paymentOffsetDays,
        periods: periods.slice(0, 10) // Preview first 10 periods
      }
    });
  } catch (error) {
    console.error('Error previewing cutoffs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to preview cutoff periods',
      error: error.message 
    });
  }
};

module.exports = {
  getDepartmentSettings,
  getDepartmentSetting,
  saveDepartmentSettings,
  deactivateDepartmentSettings,
  previewDepartmentCutoffs
};