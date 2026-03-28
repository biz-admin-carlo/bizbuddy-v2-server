// src/controllers/Superadmin/provisionController.js

const bcrypt = require("bcryptjs");
const { prisma } = require("@config/connection");
const { sendMail } = require("@utils/mailer");
const { renderWelcome } = require("@emails/renderTemplate");

const provisionCompany = async (req, res) => {
  try {
    const {
      companyName,
      ownerEmail,
      ownerPassword,
      ownerFirstName,
      ownerLastName,
      ownerPhone,
      subscriptionPlanId,
      // Optional company details
      country,
      currency,
      timeZone,
      businessEmail,
    } = req.body;

    if (!companyName || !ownerEmail || !ownerPassword || !ownerFirstName || !ownerLastName) {
      return res.status(400).json({
        message: "Missing required fields: companyName, ownerEmail, ownerPassword, ownerFirstName, ownerLastName",
      });
    }

    const cleanedEmail = ownerEmail.trim().toLowerCase();
    const cleanedCompanyName = companyName.trim();

    // Check for existing company name
    const existingCompany = await prisma.company.findUnique({
      where: { name: cleanedCompanyName },
    });
    if (existingCompany) {
      return res.status(409).json({ message: `Company "${cleanedCompanyName}" already exists.` });
    }

    // Check for existing email globally
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanedEmail },
    });
    if (existingUser) {
      return res.status(409).json({ message: `Email "${cleanedEmail}" is already registered.` });
    }

    // Validate subscription plan if provided
    if (subscriptionPlanId) {
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: subscriptionPlanId } });
      if (!plan) {
        return res.status(400).json({ message: "Invalid subscriptionPlanId." });
      }
    }

    const hashedPassword = bcrypt.hashSync(ownerPassword, 10);
    const username = cleanedEmail;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create company
      const company = await tx.company.create({
        data: {
          name: cleanedCompanyName,
          country: country || null,
          currency: currency || null,
          timeZone: timeZone || "America/Los_Angeles",
          businessEmail: businessEmail ? businessEmail.trim().toLowerCase() : null,
        },
      });

      // 2. Create owner (admin role)
      const owner = await tx.user.create({
        data: {
          email: cleanedEmail,
          username,
          password: hashedPassword,
          role: "admin",
          status: "active",
          company: { connect: { id: company.id } },
          profile: {
            create: {
              firstName: ownerFirstName.trim(),
              lastName: ownerLastName.trim(),
              phoneNumber: ownerPhone ? ownerPhone.trim() : null,
              username,
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
          profile: { select: { firstName: true, lastName: true } },
        },
      });

      // 3. Optionally create subscription
      let subscription = null;
      if (subscriptionPlanId) {
        subscription = await tx.subscription.create({
          data: {
            userId: owner.id,
            companyId: company.id,
            planId: subscriptionPlanId,
            active: true,
            startDate: new Date(),
          },
        });
      }

      return { company, owner, subscription };
    });

    // 4. Send welcome email (non-blocking)
    try {
      const html = renderWelcome({
        firstName: ownerFirstName.trim(),
        companyName: cleanedCompanyName,
        email: cleanedEmail,
        password: ownerPassword,
      });

      await sendMail({
        to: cleanedEmail,
        subject: "Welcome to BizBuddy — your account is ready",
        html,
        text: `Hi ${ownerFirstName.trim()}, your BizBuddy admin account for ${cleanedCompanyName} has been created.\nEmail: ${cleanedEmail}\nPassword: ${ownerPassword}`,
      });

      await prisma.emailNotificationLog.create({
        data: {
          notificationType: "WELCOME_EMAIL",
          recipientEmail: cleanedEmail,
          recipientUserId: result.owner.id,
          companyId: result.company.id,
          subject: "Welcome to BizBuddy — your account is ready",
          body: JSON.stringify({ firstName: ownerFirstName.trim(), companyName: cleanedCompanyName }),
          status: "sent",
        },
      });

      console.log(`[provisionCompany] Welcome email sent to ${cleanedEmail}`);
    } catch (emailErr) {
      console.error("[provisionCompany] Failed to send welcome email:", emailErr);

      try {
        await prisma.emailNotificationLog.create({
          data: {
            notificationType: "WELCOME_EMAIL",
            recipientEmail: cleanedEmail,
            recipientUserId: result.owner.id,
            companyId: result.company.id,
            subject: "Welcome to BizBuddy — your account is ready",
            body: JSON.stringify({ firstName: ownerFirstName.trim(), companyName: cleanedCompanyName }),
            status: "failed",
            errorMessage: emailErr.message,
          },
        });
      } catch (_) {}
    }

    return res.status(201).json({
      message: "Company and owner account provisioned successfully.",
      data: {
        company: {
          id: result.company.id,
          name: result.company.name,
        },
        owner: result.owner,
        subscription: result.subscription
          ? { id: result.subscription.id, planId: result.subscription.planId, active: result.subscription.active }
          : null,
      },
    });
  } catch (error) {
    console.error("❌ Error in provisionCompany:", error);
    return res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

module.exports = { provisionCompany };
