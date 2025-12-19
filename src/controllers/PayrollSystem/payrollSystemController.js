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