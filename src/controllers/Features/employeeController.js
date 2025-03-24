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
        NOT: { id: req.user.id },
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
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
      },
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ data: employees, message: "Employees retrieved successfully." });
  } catch (error) {
    console.error("Error in getAllEmployees:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * POST /api/features/employee
 * Creates a new employee with nested profile data.
 * Validations:
 *  - Trims and lowercases username and email.
 *  - Ensures username is unique globally.
 *  - Ensures email is unique within the company.
 */
const createEmployee = async (req, res) => {
  try {
    let { email, username, password, role, firstName, lastName, phone, status, departmentId, companyId } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Email, password, first name, and last name are required." });
    }

    // Clean and standardize the fields
    const cleanedEmail = email.trim().toLowerCase();
    const cleanedUsername = username ? username.trim().toLowerCase() : cleanedEmail;

    // Check that username is unique globally
    const existingUsername = await prisma.user.findUnique({
      where: { username: cleanedUsername },
    });
    if (existingUsername) {
      return res.status(409).json({ error: "Username already exists." });
    }

    // Check that email is unique within the same company
    const existingEmail = await prisma.user.findFirst({
      where: { email: cleanedEmail, companyId: req.user.companyId },
    });
    if (existingEmail) {
      return res.status(409).json({ error: "Employee already exists with this email in your company." });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    // Determine the target company id
    let targetCompanyId = req.user.companyId;
    if (req.user.role === "superadmin" && companyId) {
      const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
      if (!companyExists) {
        return res.status(400).json({ error: "Invalid company ID provided." });
      }
      targetCompanyId = companyId;
    }

    const newEmployee = await prisma.user.create({
      data: {
        email: cleanedEmail,
        username: cleanedUsername,
        password: hashedPassword,
        role: role || "employee",
        status: status !== undefined ? status : "active",
        company: { connect: { id: targetCompanyId } },
        // Use nested connect for department if provided; otherwise, leave it null.
        ...(departmentId ? { department: { connect: { id: departmentId } } } : {}),
        // Create the associated profile.
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
        company: {
          select: { id: true, name: true },
        },
        department: {
          select: { id: true, name: true },
        },
      },
    });
    return res.status(201).json({ data: newEmployee, message: "Employee created successfully." });
  } catch (error) {
    console.error("Error in createEmployee:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/features/employee/:id
 * Updates an existing employee along with their nested profile data.
 */
const updateEmployee = async (req, res) => {
  try {
    const id = req.params.id;
    let { email, password, role, firstName, lastName, phone, status, companyId, departmentId } = req.body;

    if (email) {
      email = email.trim().toLowerCase();
    }
    if (req.body.username) {
      req.body.username = req.body.username.trim().toLowerCase();
    }

    const requesterCompanyId = req.user.companyId;
    if (!requesterCompanyId) {
      return res.status(400).json({ error: "No company associated with the employee." });
    }

    const employee = await prisma.user.findFirst({
      where: { id, companyId: requesterCompanyId },
      include: { profile: true },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found or does not belong to your company." });
    }

    const userData = {};
    const profileData = {};

    if (email !== undefined && email !== employee.email) {
      const emailExists = await prisma.user.findFirst({ where: { email, companyId: requesterCompanyId } });
      if (emailExists && emailExists.id !== employee.id) {
        return res.status(409).json({ error: "Another employee in your company already uses this email." });
      }
      userData.email = email;
      userData.username = email;
    }
    if (password) {
      userData.password = bcrypt.hashSync(password, 10);
    }
    if (role) userData.role = role;
    if (status !== undefined) userData.status = status;
    if (companyId !== undefined) {
      const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
      if (!companyExists) {
        return res.status(400).json({ error: "Invalid company ID provided." });
      }
      userData.company = { connect: { id: companyId } };
    }
    // Update department using nested connect/disconnect
    if (departmentId !== undefined) {
      userData.department = departmentId ? { connect: { id: departmentId } } : { disconnect: true };
    }
    if (firstName !== undefined) profileData.firstName = firstName.trim();
    if (lastName !== undefined) profileData.lastName = lastName.trim();
    if (phone !== undefined) profileData.phoneNumber = phone ? phone.trim() : null;

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: {
        ...userData,
        profile: { update: profileData },
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
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
      },
    });
    return res.status(200).json({ data: updatedEmployee, message: "Employee updated successfully." });
  } catch (error) {
    console.error("Error in updateEmployee:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * DELETE /api/features/employee/:id
 * Deletes an employee.
 */
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

/**
 * PUT /api/features/employee/presence
 * Since the schema does not define presence fields, this endpoint now simply returns the current user.
 */
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

/**
 * PUT /api/features/employee/change-password
 * Changes the employee's password.
 */
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

/**
 * GET /api/features/employee/:id
 * Retrieves an employee by ID along with their profile and related data.
 */
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
