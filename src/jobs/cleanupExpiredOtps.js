import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const cleanupExpiredOtps = async () => {
  const now = new Date();
  const result = await prisma.otp.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  console.log(`🧹 Deleted ${result.count} expired OTPs at ${now.toISOString()}`);
  await prisma.$disconnect();
};

cleanupExpiredOtps()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ OTP cleanup failed:", err);
    process.exit(1);
  });
