-- AlterTable
ALTER TABLE "Order" ADD COLUMN "expiryTimestamp" DATETIME;
ALTER TABLE "Order" ADD COLUMN "limitPricePaise" INTEGER;
ALTER TABLE "Order" ADD COLUMN "stopPricePaise" INTEGER;
ALTER TABLE "Order" ADD COLUMN "triggeredAt" DATETIME;
