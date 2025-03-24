// src/controllers/Account/subscriptionPlanController.js

const { prisma } = require("@config/connection");

const getAllPlans = async (req, res) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { name: "asc" },
    });
    return res.status(200).json({ message: "Subscription plans retrieved successfully.", data: plans });
  } catch (error) {
    console.error("Error in getAllPlans:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const createPlan = async (req, res) => {
  try {
    const { name, rangeOfUsers, price, description, features } = req.body;
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: {
        name: { equals: name.trim(), mode: "insensitive" },
        rangeOfUsers: rangeOfUsers.trim(),
      },
    });
    if (existingPlan) {
      return res.status(400).json({ message: `A plan with name "${name}" and user range "${rangeOfUsers}" already exists.` });
    }
    const newPlan = await prisma.subscriptionPlan.create({
      data: {
        name: name.trim(),
        rangeOfUsers: rangeOfUsers.trim(),
        price: price || 0,
        description: description || "",
        features: features || {},
      },
    });
    return res.status(201).json({ message: "Subscription plan created successfully.", data: newPlan });
  } catch (error) {
    console.error("Error in createPlan:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * PUT /api/subscription-plans/:id
 * Updates an existing subscription plan.
 */
const updatePlan = async (req, res) => {
  try {
    const planId = req.params.id;
    const { name, rangeOfUsers, price, description, features } = req.body;
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ message: "Subscription plan not found." });
    }
    const nameChanged = name && name.trim() !== plan.name;
    const rangeChanged = rangeOfUsers && rangeOfUsers.trim() !== plan.rangeOfUsers;
    if (nameChanged || rangeChanged) {
      const duplicate = await prisma.subscriptionPlan.findFirst({
        where: {
          name: name ? name.trim() : plan.name,
          rangeOfUsers: rangeOfUsers ? rangeOfUsers.trim() : plan.rangeOfUsers,
          NOT: { id: planId },
        },
      });
      if (duplicate) {
        return res.status(400).json({ message: "Another plan with the same name and user range already exists." });
      }
    }
    const updatedPlan = await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        name: name !== undefined ? name.trim() : plan.name,
        rangeOfUsers: rangeOfUsers !== undefined ? rangeOfUsers.trim() : plan.rangeOfUsers,
        price: price !== undefined ? price : plan.price,
        description: description !== undefined ? description : plan.description,
        features: features !== undefined ? features : plan.features,
      },
    });
    return res.status(200).json({ message: "Subscription plan updated successfully.", data: updatedPlan });
  } catch (error) {
    console.error("Error in updatePlan:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * DELETE /api/subscription-plans/:id
 * Deletes a subscription plan.
 */
const deletePlan = async (req, res) => {
  try {
    const planId = req.params.id;
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ message: "Subscription plan not found." });
    }
    await prisma.subscriptionPlan.delete({ where: { id: planId } });
    return res.status(200).json({ message: "Subscription plan deleted successfully." });
  } catch (error) {
    console.error("Error in deletePlan:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
};
