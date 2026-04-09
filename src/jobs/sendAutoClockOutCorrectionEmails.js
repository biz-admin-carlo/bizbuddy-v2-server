/**
 * One-time job: Send correction emails to employees whose time logs were
 * incorrectly auto-clocked out due to the late-clock-in bug (pre-fix).
 *
 * Affected logs: autoClockOut=false, status=true, timeOut=null, autoClockOutAt=null
 * that were recently reverted (updatedAt within the revert window).
 *
 * Run once:
 *   node src/jobs/sendAutoClockOutCorrectionEmails.js
 *
 * Test mode (sends one sample email to the given address, no real recipients touched):
 *   node src/jobs/sendAutoClockOutCorrectionEmails.js --test webdev@bizsolutions.us
 */

require("module-alias/register");
require("dotenv").config();

const { prisma } = require("@config/connection");
const { sendEmailNotification } = require("../services/notificationService");
const { sendEmail } = require("../services/emailService");

const testIndex = process.argv.indexOf("--test");
const TEST_EMAIL = testIndex !== -1 ? process.argv[testIndex + 1] : null;

async function sendCorrectionEmails() {
  if (TEST_EMAIL) {
    console.log(`\n📧 [CORRECTION EMAIL] TEST MODE — sending sample to ${TEST_EMAIL}`);
    // Use sendEmail directly to skip DB logging (no real userId/companyId in test)
    await sendEmail({
      to:           TEST_EMAIL,
      subject:      "Time Log Correction Notice",
      templateName: "autoClockOutCorrected",
      context: {
        employeeName:          "John Doe (Test)",
        companyName:           "BizBuddy Demo Company",
        originalDate:          "April 8, 2026",
        clockInTime:           "Apr 8, 2026, 10:14 PM",
        incorrectClockOutTime: "Removed (incorrectly set by system)",
        appUrl:                process.env.CLIENT_URL,
        currentYear:           new Date().getFullYear(),
      },
    });
    console.log(`   ✅ Test email sent to ${TEST_EMAIL}`);
    return;
  }

  console.log("\n📧 [CORRECTION EMAIL] Starting rollout...");

  // Query the originally affected logs using the same criteria as the bug:
  // autoClockOut=true, timeOut set, but recorded hours < 5.
  // Deduplicate by userId so each employee gets only one email.
  // Skip users without a companyId (system/admin accounts).
  const affectedLogs = await prisma.timeLog.findMany({
    where: {
      autoClockOut: true,
      timeOut:      { not: null },
      user: {
        companyId: { not: null },
      },
    },
    include: {
      user: {
        include: {
          profile: true,
          company: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  // Filter to logs where recorded hours < 5 (the affected condition)
  const revertedLogs = Object.values(
    affectedLogs
      .filter((log) => {
        const hours =
          (new Date(log.timeOut) - new Date(log.timeIn)) / (1000 * 60 * 60);
        return hours < 5;
      })
      // Deduplicate — one email per user (pick most recent affected log)
      .reduce((acc, log) => {
        if (
          !acc[log.userId] ||
          new Date(log.timeIn) > new Date(acc[log.userId].timeIn)
        ) {
          acc[log.userId] = log;
        }
        return acc;
      }, {})
  );

  if (revertedLogs.length === 0) {
    console.log("   ℹ️  No affected logs found.");
    return;
  }

  console.log(`   Found ${revertedLogs.length} affected employee(s). Sending emails...`);

  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const log of revertedLogs) {
    const user = log.user;

    if (!user.email) {
      console.log(`   ⚠️  No email for user ${user.id} — skipping`);
      skipCount++;
      continue;
    }

    const employeeName =
      `${user.profile?.firstName || ""} ${user.profile?.lastName || ""}`.trim() ||
      user.username;

    const companyName  = user.company?.name || "BizBuddy";
    const originalDate = new Date(log.timeIn).toLocaleDateString("en-US", {
      dateStyle: "long",
    });
    const clockInTime  = new Date(log.timeIn).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    try {
      await sendEmailNotification({
        to:           user.email,
        subject:      "Time Log Correction Notice",
        templateName: "autoClockOutCorrected",
        context: {
          employeeName,
          companyName,
          originalDate,
          clockInTime,
          incorrectClockOutTime: "Removed (incorrectly set by system)",
          appUrl:      process.env.CLIENT_URL,
          currentYear: new Date().getFullYear(),
        },
        notificationType: "AUTO_CLOCK_OUT",
        recipientUserId:  user.id,
        companyId:        user.companyId,
        metadata: {
          timeLogId:  log.id,
          revertedAt: new Date().toISOString(),
        },
      });

      console.log(`   ✓ Sent to: ${employeeName} <${user.email}>`);
      successCount++;
    } catch (err) {
      console.error(`   ❌ Failed for ${user.email}:`, err.message);
      errorCount++;
    }
  }

  console.log(
    `\n   ✅ Done — ${successCount} sent, ${skipCount} skipped (no email), ${errorCount} failed`
  );
}

sendCorrectionEmails()
  .catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
