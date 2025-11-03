// src/controllers/Account/accountSignupController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("@config/connection");
const { JWT_SECRET } = require("@config/env");
const { sendMail } = require("@utils/mailer");
const { renderWelcome } = require("@emails/renderTemplate");

const getAllSubscriptionPlans = async (req, res) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { name: "asc" },
    });
    return res.status(200).json({
      message: "Subscription plans retrieved successfully.",
      data: plans,
    });
  } catch (error) {
    console.error("Error in getAllSubscriptionPlans:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const checkCompanyName = async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ message: "Company name is required." });
    }
    const company = await prisma.company.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
    });
    return res.status(200).json({
      message: "Company name check complete.",
      data: { exists: !!company },
    });
  } catch (error) {
    console.error("Error in checkCompanyName:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const checkUsername = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ message: "Username is required." });
    }
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    return res.status(200).json({
      message: "Username check complete.",
      data: { available: !existingUser },
    });
  } catch (error) {
    console.error("Error in checkUsername:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const signUp = async (req, res) => {
  try {
    const { firstName, lastName, email, password, companyName, country, currency, language, subscriptionPlanId, isPaid, username } = req.body;
    const plainPassword = password;

    if (!firstName || !lastName || !email || !password || !companyName || !subscriptionPlanId) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username: username.trim().toLowerCase() },
      });
      if (existingUsername) {
        return res.status(409).json({ message: "Username already exists." });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username ? username.trim().toLowerCase() : normalizedEmail;
    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: normalizedUsername,
          email: normalizedEmail,
          password: hashedPassword,
          role: "admin",
        },
      });

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          username: newUser.username,
          email: newUser.email,
          firstName,
          lastName,
        },
      });

      const newCompany = await tx.company.create({
        data: {
          name: companyName,
          userId: newUser.id,
          country: country || "",
          currency: currency || "",
          language: language || "",
        },
      });

      await tx.user.update({
        where: { id: newUser.id },
        data: { companyId: newCompany.id },
      });

      if (!JWT_SECRET) throw new Error("JWT secret is not configured.");
      const token = jwt.sign({ userId: newUser.id, role: newUser.role, companyId: newCompany.id }, JWT_SECRET, { expiresIn: "10y" });
      const subscriptionPlan = await tx.subscriptionPlan.findUnique({
        where: { id: subscriptionPlanId },
      });
      if (!subscriptionPlan) {
        throw new Error("Invalid subscription plan.");
      }
      const isSubscriptionActive = !!isPaid;
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const newSubscription = await tx.subscription.create({
        data: {
          userId: newUser.id,
          companyId: newCompany.id,
          planId: subscriptionPlan.id,
          active: isSubscriptionActive,
          startDate,
          endDate,
        },
      });

      return { token, newUser, newCompany, newSubscription };
    });

    try {
      const html = renderWelcome({
        firstName,
        companyName,
        email: result.newUser.email,
        password: plainPassword, // you decided no token TTL; you’re emailing it
      });
    
      await sendMail({
        to: result.newUser.email,
        subject: "Welcome to BizBuddy — your account is live",
        html,
        text: `Hi ${firstName}, your BizBuddy account for ${companyName} is ready.
    Email: ${result.newUser.email}
    Password: ${plainPassword}
    `,
      });
      // optional: log success
      console.log(`[signUp] Welcome email sent to ${result.newUser.email}`);
    } catch (err) {
      console.error("[signUp] Failed to send welcome email:", err);
      // do not throw; account is already created
    }

    return res.status(201).json({
      message: "Account, company, and subscription created successfully.",
      data: {
        token: result.token,
        user: {
          id: result.newUser.id,
          email: result.newUser.email,
          role: result.newUser.role,
          companyId: result.newCompany.id,
        },
        subscription: result.newSubscription,
      },
    });
  } catch (error) {
    console.error("Error in signUp:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getApprover = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // First, find the user and check their department assignment
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employmentDetail: true, // Check employment details for department
        department: true        // Check direct department assignment
      }
    });

    if (!user || user.companyId !== companyId) {
      return res.status(404).json({ error: "User not found or company mismatch" });
    }

    // Determine user's department - check both possible assignments
    let userDepartmentId = user.departmentId || user.employmentDetail?.departmentId;

    if (userDepartmentId) {
      // User is assigned to a department - return department supervisors
      const departmentSupervisors = await prisma.user.findMany({
        where: {
          companyId: companyId,
          OR: [
            // Department supervisor (assigned to supervise the whole department)
            {
              supervisedDepartments: {
                some: { id: userDepartmentId }
              }
            },
            // Individual supervisors of employees in this department
            {
              supervisedEmployees: {
                some: { 
                  departmentId: userDepartmentId 
                }
              }
            },
            // Users with supervisor role in the same department
            {
              role: 'supervisor',
              OR: [
                { departmentId: userDepartmentId },
                { 
                  employmentDetail: { 
                    departmentId: userDepartmentId 
                  } 
                }
              ]
            }
          ],
          status: 'active' // Only active supervisors
        },
        select: {
          id: true,
          email: true,
          role: true,
          profile: {
            select: {
              firstName: true,
              lastName: true
            }
          },
          employmentDetail: {
            select: {
              jobTitle: true
            }
          }
        },
        distinct: ['id'] // Remove duplicates
      });

      return res.status(200).json({
        success: true,
        data: departmentSupervisors.map(supervisor => ({
          id: supervisor.id,
          name: supervisor.profile ? 
            `${supervisor.profile.firstName || ''} ${supervisor.profile.lastName || ''}`.trim() || 
            supervisor.email : supervisor.email,
          email: supervisor.email,
          role: supervisor.role,
          jobTitle: supervisor.employmentDetail?.jobTitle || 'Supervisor'
        }))
      });

    } else {
      // User has no department assignment - return all company admins
      const companyAdmins = await prisma.user.findMany({
        where: {
          companyId: companyId,
          role: {
            in: ['admin', 'superadmin']
          },
          status: 'active'
        },
        select: {
          id: true,
          email: true,
          role: true,
          profile: {
            select: {
              firstName: true,
              lastName: true
            }
          },
          employmentDetail: {
            select: {
              jobTitle: true
            }
          }
        }
      });

      return res.status(200).json({
        success: true,
        data: companyAdmins.map(admin => ({
          id: admin.id,
          name: admin.profile ? 
            `${admin.profile.firstName || ''} ${admin.profile.lastName || ''}`.trim() || 
            admin.email : admin.email,
          email: admin.email,
          role: admin.role,
          jobTitle: admin.employmentDetail?.jobTitle || 'Administrator'
        }))
      });
    }

  } catch (error) {
    console.error('Error fetching approvers:', error);
    return res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
};

module.exports = {
  getAllSubscriptionPlans,
  checkCompanyName,
  checkUsername,
  signUp,
  getApprover
};
