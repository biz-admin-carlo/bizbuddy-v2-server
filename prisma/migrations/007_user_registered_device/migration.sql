-- Mobile single-device login: track the registered app install per user account
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registeredDeviceId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registeredDeviceAt" TIMESTAMPTZ;
