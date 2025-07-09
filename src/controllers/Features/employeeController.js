// src/controllers/Features/employeeController.js

const bcrypt = require("bcryptjs");
const { prisma } = require("@config/connection");

const getAllEmployees = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "No company associated with the employee." });
    }
    const employees = await prisma.user.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        hireDate: true,
        employeeId: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            username: true,
          },
        },
        department: {
          select: { id: true, name: true },
        },
        company: {
          select: { id: true, name: true },
        },
        employmentDetail: {
          select: {
            jobTitle: true,
            employmentStatus: true,
            exemptStatus: true,
            employmentType: true,
            workLocation: true,
            probationEndDate: true,
            timeZone: true,
            supervisor: {
              select: { id: true, email: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ data: employees, message: "Employees retrieved successfully." });
  } catch (error) {
    console.error("Error in getAllEmployees:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const createEmployee = async (req, res) => {
  try {
    let { email, username, password, role, firstName, lastName, phone, status, departmentId, companyId, hireDate, employeeId } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Email, password, first name, and last name are required." });
    }

    const cleanedEmail = email.trim().toLowerCase();
    const cleanedUsername = username ? username.trim().toLowerCase() : cleanedEmail;
    const cleanedEmployeeId = employeeId ? employeeId.trim() : null;

    const existingUsername = await prisma.user.findUnique({ where: { username: cleanedUsername } });
    if (existingUsername) return res.status(409).json({ error: "Username already exists." });
    const existingEmail = await prisma.user.findFirst({ where: { email: cleanedEmail, companyId: req.user.companyId } });
    if (existingEmail) return res.status(409).json({ error: "Employee already exists with this email in your company." });
    if (cleanedEmployeeId) {
      const existingEmployeeId = await prisma.user.findFirst({ where: { employeeId: cleanedEmployeeId, companyId: req.user.companyId } });
      if (existingEmployeeId) return res.status(409).json({ error: "Employee ID already exists in your company." });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    let targetCompanyId = req.user.companyId;
    if (req.user.role === "superadmin" && companyId) {
      const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
      if (!companyExists) return res.status(400).json({ error: "Invalid company ID provided." });
      targetCompanyId = companyId;
    }

    let parsedHireDate = null;
    if (hireDate) {
      parsedHireDate = new Date(hireDate);
      if (isNaN(parsedHireDate.getTime())) return res.status(400).json({ error: "Invalid hire date format." });
    }

    const newEmployee = await prisma.user.create({
      data: {
        email: cleanedEmail,
        username: cleanedUsername,
        password: hashedPassword,
        role: role || "employee",
        status: status !== undefined ? status : "active",
        hireDate: parsedHireDate,
        employeeId: cleanedEmployeeId,
        company: { connect: { id: targetCompanyId } },
        ...(departmentId ? { department: { connect: { id: departmentId } } } : {}),
        profile: {
          create: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phoneNumber: phone ? phone.trim() : null,
            username: cleanedUsername,
            email: cleanedEmail,
          },
        },
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        hireDate: true,
        employeeId: true,
        createdAt: true,
        updatedAt: true,
        profile: { select: { firstName: true, lastName: true, phoneNumber: true, username: true } },
        company: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
    return res.status(201).json({ data: newEmployee, message: "Employee created successfully." });
  } catch (error) {
    console.error("Error in createEmployee:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const updateEmployee = async (req, res) => {
  try {
    const id = req.params.id;
    let { email, password, role, firstName, lastName, phone, status, companyId, departmentId, hireDate, employeeId } = req.body;

    const employee = await prisma.user.findFirst({
      where: { id, companyId: req.user.companyId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        hireDate: true,
        employeeId: true,
        companyId: true,
        profile: true,
        department: true,
      },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found or does not belong to your company." });
    }

    if (employee.id === req.user.id) {
      return res.status(400).json({ error: "You cannot update your own account." });
    }

    if (role && role.toLowerCase() === "superadmin" && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Cannot assign superadmin role." });
    }

    const requesterCompanyId = req.user.companyId;
    const cleanedEmail = email ? email.trim().toLowerCase() : employee.email;
    const cleanedEmployeeId = employeeId !== undefined ? (employeeId ? employeeId.trim() : null) : employee.employeeId;

    if (cleanedEmail !== employee.email) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: cleanedEmail, companyId: requesterCompanyId, id: { not: id } },
      });
      if (existingEmail) {
        return res.status(409).json({ error: "Another employee in your company already uses this email." });
      }
    }

    if (cleanedEmployeeId !== employee.employeeId) {
      const employeeIdExists = await prisma.user.findFirst({
        where: { employeeId: cleanedEmployeeId, companyId: requesterCompanyId, id: { not: id } },
      });
      if (employeeIdExists) {
        return res.status(409).json({ error: "Another employee in your company already uses this employee ID." });
      }
    }

    const userData = {
      email: cleanedEmail,
      role: role || employee.role,
      status: status !== undefined ? status : employee.status,
      employeeId: cleanedEmployeeId,
      updatedAt: new Date(),
    };

    if (password) {
      userData.password = bcrypt.hashSync(password, 10);
    }

    if (hireDate !== undefined) {
      if (hireDate === null) {
        userData.hireDate = null;
      } else if (hireDate) {
        const parsedHireDate = new Date(hireDate);
        if (isNaN(parsedHireDate.getTime())) {
          return res.status(400).json({ error: "Invalid hire date format." });
        }
        userData.hireDate = parsedHireDate;
      }
    }

    if (departmentId !== undefined) {
      if (departmentId && departmentId !== "none") {
        const deptExists = await prisma.department.findUnique({ where: { id: departmentId } });
        if (!deptExists) {
          return res.status(400).json({ error: "Invalid department ID." });
        }
        userData.department = { connect: { id: departmentId } };
      } else {
        userData.department = { disconnect: true };
      }
    }

    let targetCompanyId = employee.companyId;
    if (req.user.role === "superadmin" && companyId) {
      const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
      if (!companyExists) {
        return res.status(400).json({ error: "Invalid company ID provided." });
      }
      targetCompanyId = companyId;
      userData.company = { connect: { id: companyId } };
    }

    const profileData = {};
    if (firstName) profileData.firstName = firstName.trim();
    if (lastName) profileData.lastName = lastName.trim();
    if (phone !== undefined) profileData.phoneNumber = phone ? phone.trim() : null;

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: {
        ...userData,
        profile: Object.keys(profileData).length
          ? {
              update: {
                ...profileData,
                email: cleanedEmail,
                username: userData.username || employee.username,
              },
            }
          : undefined,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        hireDate: true,
        employeeId: true,
        createdAt: true,
        updatedAt: true,
        profile: { select: { firstName: true, lastName: true, phoneNumber: true, username: true } },
        company: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return res.status(200).json({ data: updatedEmployee, message: "Employee updated successfully." });
  } catch (error) {
    console.error("Error in updateEmployee:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const id = req.params.id;
    const requesterCompanyId = req.user.companyId;
    if (!requesterCompanyId) {
      return res.status(400).json({ error: "No company associated with the employee." });
    }
    const employee = await prisma.user.findFirst({
      where: { id, companyId: requesterCompanyId },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found or does not belong to your company." });
    }
    if (employee.id === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }
    await prisma.user.delete({ where: { id } });
    return res.status(200).json({ message: "Employee deleted successfully." });
  } catch (error) {
    console.error("Error in deleteEmployee:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const updateEmployeePresence = async (req, res) => {
  try {
    const employee = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
      },
    });
    return res.status(200).json({
      data: employee,
      message: "Employee presence update is not implemented in schema.",
    });
  } catch (error) {
    console.error("Error in updateEmployeePresence:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const changeEmployeePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "All password fields are required." });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New password and confirmation do not match." });
    }
    const employee = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found." });
    }
    const isMatch = bcrypt.compareSync(oldPassword, employee.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Old password is incorrect." });
    }
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: bcrypt.hashSync(newPassword, 10) },
    });
    return res.status(200).json({ message: "Employee password changed successfully." });
  } catch (error) {
    console.error("Error in changeEmployeePassword:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const id = req.params.id;
    const employee = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        companyId: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            username: true,
          },
        },
        department: {
          select: { id: true, name: true },
        },
        company: {
          select: { id: true, name: true },
        },
        employmentDetail: {
          select: {
            jobTitle: true,
            employmentStatus: true,
            exemptStatus: true,
            employmentType: true,
            workLocation: true,
            probationEndDate: true,
            timeZone: true,
            supervisor: { select: { id: true, email: true } },
          },
        },
      },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found." });
    }
    if (req.user.role !== "superadmin" && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: "Unauthorized request." });
    }
    return res.status(200).json({ data: employee, message: "Employee retrieved successfully." });
  } catch (error) {
    console.error("Error in getEmployeeById:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

module.exports = {
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  updateEmployeePresence,
  changeEmployeePassword,
  getEmployeeById,
};
