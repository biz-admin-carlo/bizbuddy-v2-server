// src/controllers/Account/resetPasswordController.js

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { prisma } = require("@config/connection");

const transporter = nodemailer.createTransport({
  host: "smtp.dreamhost.com",
  port: "587",
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, 
  },
});

const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const sendResetPasswordEmail = async (email, resetToken, userName, companyName) => {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/confirm?token=${resetToken}`;
      
      const mailOptions = {
        from: `"BizBuddy Support" <no-reply@mybizbuddy.co>`,
        to: email,
        subject: "Your BizBuddy Account - Password Reset Instructions",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; background-color: #f3f4f6; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: #ffffff; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; color: #1f2937; }
              .reset-button { 
                display: inline-block; 
                background: linear-gradient(135deg, #f97316, #ea580c); 
                color: #ffffff; 
                padding: 15px 30px; 
                text-decoration: none; 
                border-radius: 8px; 
                font-weight: bold; 
                margin: 20px 0;
                text-align: center;
              }
              .token-box { background: #ffffff; border: 2px solid #f97316; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
              .token { font-size: 16px; font-weight: bold; color: #f97316; word-break: break-all; }
              .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; color: #92400e; }
              .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔐 Password Reset Request</h1>
              </div>
              <div class="content">
                <p>Hello <strong>${userName}</strong>,</p>
                
                <p>We received a request to reset the password for your BizBuddy account${companyName ? ` at <strong>${companyName}</strong>` : ''}.</p>
                
                <p style="text-align: center;">
                  <a href="${resetUrl}" class="reset-button">Reset My Password</a>
                </p>
                
                <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
                <div class="token-box">
                  <div class="token">${resetUrl}</div>
                </div>
                
                <div class="warning">
                  <p style="margin: 0;"><strong>⏰ Important:</strong></p>
                  <p style="margin: 5px 0 0 0;">This password reset link will expire in <strong>5 minutes</strong> for your security.</p>
                </div>
                
                <p>If you did not request a password reset, please ignore this email. Your account will remain secure.</p>
                
                <p>Best regards,<br><strong>BizBuddy Team</strong></p>
              </div>
              <div class="footer">
                <p>This is an automated email. Please do not reply to this message.</p>
                <p>&copy; ${new Date().getFullYear()} BizBuddy. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };
  
      await transporter.sendMail(mailOptions);
      console.log(`Reset password email sent to: ${email}`);
      return true;
    } catch (error) {
      console.error("Error sending reset password email:", error);
      throw error;
    }
};
  
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user with email
    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail },
      include: { 
        profile: true,
        company: true 
      },
    });

    // If user doesn't exist, log and return success (security best practice)
    if (!user) {
      console.log(`Attempt to reset-password for account: ${normalizedEmail}`);
      return res.status(200).json({
        message: "If an account exists with this email, a password reset link has been sent.",
        success: true,
      });
    }

    // Check for recent reset requests (rate limiting)
    const recentRequest = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(Date.now() - 60 * 1000), // 1 minute cooldown
        },
      },
    });

    if (recentRequest) {
      console.log(`Rate-limited password reset request for: ${normalizedEmail}`);
      return res.status(200).json({
        message: "If an account exists with this email, a password reset link has been sent.",
        success: true,
      });
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalidate any existing tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        used: false,
      },
      data: { expiresAt: new Date() }, // Expire immediately
    });

    // Create new reset token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });

    // Send reset email
    const userName = `${user.profile?.firstName || ""} ${user.profile?.lastName || ""}`.trim() || user.email;
    const companyName = user.company?.name;

    try {
      await sendResetPasswordEmail(normalizedEmail, resetToken, userName, companyName);
      console.log(`Password reset token created and email sent for: ${normalizedEmail}`);
    } catch (emailError) {
      console.error("Reset email send failed:", emailError);
      // Don't reveal email failure to user
    }

    return res.status(200).json({
      message: "If an account exists with this email, a password reset link has been sent.",
      success: true,
    });

  } catch (error) {
    console.error("Error in requestPasswordReset:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Reset token is required." });
    }

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            profile: true,
            company: true,
          },
        },
      },
    });

    if (!resetToken) {
      return res.status(400).json({ 
        message: "Invalid or expired reset token.",
        expired: true 
      });
    }

    return res.status(200).json({
      message: "Reset token is valid.",
      success: true,
      data: {
        user: {
          email: resetToken.user.email,
          firstName: resetToken.user.profile?.firstName || "",
          lastName: resetToken.user.profile?.lastName || "",
          companyName: resetToken.user.company?.name || "",
        },
      },
    });

  } catch (error) {
    console.error("Error verifying reset token:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    // Find and validate token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!resetToken) {
      return res.status(400).json({ 
        message: "Invalid or expired reset token.",
        expired: true 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password and mark token as used
    await prisma.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      });

      // Mark token as used
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { 
          used: true,
          usedAt: new Date(),
        },
      });

      // Invalidate all other tokens for this user
      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          used: false,
          id: { not: resetToken.id },
        },
        data: { expiresAt: new Date() },
      });
    });

    console.log(`Password successfully reset for user: ${resetToken.user.email}`);

    return res.status(200).json({
      message: "Password has been reset successfully.",
      success: true,
    });

  } catch (error) {
    console.error("Error resetting password:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
};