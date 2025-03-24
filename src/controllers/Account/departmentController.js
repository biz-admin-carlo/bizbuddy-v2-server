// src/controllers/Account/departmentController.js

const { prisma } = require("@config/connection");

const createDepartment = async (req, res) => {
  try {
    let { name, supervisorId } = req.body;
    const companyId = req.user.companyId;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Department name is required." });
    }
    name = name.trim().toLowerCase();
    const existingDept = await prisma.department.findFirst({
      where: { companyId, name: { equals: name, mode: "insensitive" } },
    });
    if (existingDept) {
      return res.status(409).json({ error: "Department already exists in your company." });
    }
    let supervisor = null;
    if (supervisorId) {
      supervisor = await prisma.user.findFirst({
        where: { id: supervisorId, companyId, role: "supervisor" },
      });
      if (!supervisor) {
        return res.status(400).json({ error: "Invalid supervisor ID." });
      }
    }
    const newDepartment = await prisma.department.create({
      data: {
        name,
        companyId,
        supervisorId: supervisor ? supervisor.id : null,
      },
    });
    return res.status(201).json({ data: newDepartment, message: "Department created successfully." });
  } catch (error) {
    console.error("Error in createDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/departments/all
 * Retrieves all departments for the current company.
 */
const getAllDepartments = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "No company associated with the user." });
    }
    const departments = await prisma.department.findMany({
      where: { companyId },
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        users: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        _count: { select: { users: true } },
      },
    });
    return res.status(200).json({ data: departments, message: "Departments retrieved successfully." });
  } catch (error) {
    console.error("Error in getAllDepartments:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/departments/:id
 * Retrieves a department by its ID.
 */
const getDepartmentById = async (req, res) => {
  try {
    const departmentId = req.params.id;
    const companyId = req.user.companyId;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({
      where: { id: departmentId, companyId },
      include: {
        supervisor: { select: { id: true, firstName: true, lastName: true, email: true } },
        users: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    return res.status(200).json({ data: department, message: "Department retrieved successfully." });
  } catch (error) {
    console.error("Error in getDepartmentById:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/departments/update/:id
 * Updates an existing department.
 */
const updateDepartment = async (req, res) => {
  try {
    const departmentId = req.params.id;
    let { name, supervisorId } = req.body;
    const companyId = req.user.companyId;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    if (name) {
      name = name.trim().toLowerCase();
      const duplicateDept = await prisma.department.findFirst({
        where: { companyId, name: { equals: name, mode: "insensitive" }, NOT: { id: departmentId } },
      });
      if (duplicateDept) {
        return res.status(409).json({ error: "Another department with this name exists." });
      }
    }
    if (supervisorId !== undefined && supervisorId !== null) {
      const supervisor = await prisma.user.findFirst({
        where: { id: supervisorId, companyId, role: "supervisor" },
      });
      if (!supervisor) {
        return res.status(400).json({ error: "Invalid supervisor ID." });
      }
    }
    const updatedDepartment = await prisma.department.update({
      where: { id: departmentId },
      data: {
        name: name || department.name,
        supervisorId: supervisorId !== undefined ? supervisorId : department.supervisorId,
      },
    });
    return res.status(200).json({ data: updatedDepartment, message: "Department updated successfully." });
  } catch (error) {
    console.error("Error in updateDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * DELETE /api/departments/delete/:id
 * Deletes a department.
 */
const deleteDepartment = async (req, res) => {
  try {
    const departmentId = req.params.id;
    const companyId = req.user.companyId;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    await prisma.department.delete({ where: { id: departmentId } });
    return res.status(200).json({ message: "Department deleted successfully." });
  } catch (error) {
    console.error("Error in deleteDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/departments/:id/assign-users
 * Assigns a list of users to a department.
 */
const assignUsersToDepartment = async (req, res) => {
  try {
    const departmentId = req.params.id;
    const { userIds } = req.body;
    const companyId = req.user.companyId;
    const requesterRole = req.user.role;
    const requesterId = req.user.id;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    if (requesterRole === "supervisor" && department.supervisorId !== requesterId) {
      return res.status(403).json({ error: "You are not authorized to assign users for this department." });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "A non-empty array of user IDs is required." });
    }
    const validUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, companyId, role: { not: "superadmin" } },
      select: { id: true },
    });
    const validUserIds = validUsers.map((user) => user.id);
    const invalidUserIds = userIds.filter((id) => !validUserIds.includes(id));
    if (invalidUserIds.length > 0) {
      return res.status(400).json({ error: `Users with IDs ${invalidUserIds.join(", ")} were not found.` });
    }
    await prisma.user.updateMany({
      where: { id: { in: validUserIds }, companyId },
      data: { departmentId },
    });
    // Removed auto‑assignment of supervisor to avoid interfering with regular member assignment.
    return res.status(200).json({ data: { assignedUserIds: validUserIds }, message: "Users assigned successfully." });
  } catch (error) {
    console.error("Error in assignUsersToDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * PUT /api/departments/:id/remove-users
 * Removes a list of users from a department.
 */
const removeUsersFromDepartment = async (req, res) => {
  try {
    const departmentId = req.params.id;
    const { userIds } = req.body;
    const companyId = req.user.companyId;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "A non-empty array of user IDs is required." });
    }
    const assignedUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, departmentId, companyId },
      select: { id: true },
    });
    const assignedUserIds = assignedUsers.map((user) => user.id);
    const notAssignedUserIds = userIds.filter((id) => !assignedUserIds.includes(id));
    if (notAssignedUserIds.length > 0) {
      return res.status(400).json({ error: `Users with IDs ${notAssignedUserIds.join(", ")} are not assigned to this department.` });
    }
    await prisma.user.updateMany({
      where: { id: { in: assignedUserIds }, companyId },
      data: { departmentId: null },
    });
    return res.status(200).json({ data: { removedUserIds: assignedUserIds }, message: "Users removed successfully." });
  } catch (error) {
    console.error("Error in removeUsersFromDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/**
 * GET /api/departments/:id/users
 * Retrieves all users assigned to a department.
 */
const getUsersInDepartment = async (req, res) => {
  try {
    const departmentId = req.params.id;
    const companyId = req.user.companyId;
    if (!departmentId) {
      return res.status(400).json({ error: "Invalid department ID." });
    }
    const department = await prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!department) {
      return res.status(404).json({ error: "Department not found." });
    }
    const users = await prisma.user.findMany({
      where: { departmentId, companyId },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ data: users, message: "Users retrieved successfully." });
  } catch (error) {
    console.error("Error in getUsersInDepartment:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

module.exports = {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  assignUsersToDepartment,
  removeUsersFromDepartment,
  getUsersInDepartment,
};
