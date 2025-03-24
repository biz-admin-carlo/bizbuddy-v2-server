/*
  Warnings:

  - You are about to drop the column `transactionId` on the `Payment` table. All the data in the column will be lost.
  - Added the required column `stripeId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "transactionId",
ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardExpMonth" INTEGER,
ADD COLUMN     "cardExpYear" INTEGER,
ADD COLUMN     "cardLast4" TEXT,
ADD COLUMN     "paymentIntentId" TEXT,
ADD COLUMN     "paymentMethodType" TEXT,
ADD COLUMN     "paymentReceiptUrl" TEXT,
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "stripeId" TEXT NOT NULL;
