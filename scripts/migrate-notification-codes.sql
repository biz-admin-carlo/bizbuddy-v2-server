-- Add missing NotificationCode enum values
-- Run this against the DB, then run: npx prisma generate

ALTER TYPE "NotificationCode" ADD VALUE IF NOT EXISTS 'AUTO_CLOCK_OUT_SV';
ALTER TYPE "NotificationCode" ADD VALUE IF NOT EXISTS 'CLOCK_OUT_WARNING';
