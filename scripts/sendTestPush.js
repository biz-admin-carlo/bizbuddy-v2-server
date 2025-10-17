// scripts/sendTestPush.js
require("module-alias/register");
require("dotenv").config();

const { prisma } = require("@config/connection");
const { initFirebase, getMessaging } = require("@config/firebase");

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: node scripts/sendTestPush.js <username>");
    process.exit(1);
  }

  initFirebase();
  const messaging = getMessaging();
  if (!messaging) {
    console.error("Firebase messaging not available. Check env config.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, deviceToken: true },
  });

  if (!user) {
    console.error(`User not found: ${username}`);
    process.exit(1);
  }
  if (!user.deviceToken) {
    console.error(`No deviceToken for user: ${username}`);
    process.exit(1);
  }

  try {
    const resp = await messaging.send({
      token: user.deviceToken,
      notification: {
        title: "BizBuddy test",
        body: "This is a test push notification.",
      },
      data: {
        type: "test",
        userId: String(user.id),
      },
    });
    console.log("Sent! Message ID:", resp);
  } catch (err) {
    console.error("Send error:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
