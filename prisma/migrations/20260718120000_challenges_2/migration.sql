-- CreateEnum
CREATE TYPE "ChallengeRecurrence" AS ENUM ('WEEKLY');

-- AlterTable
ALTER TABLE "Challenge"
  ADD COLUMN "inviteCode" TEXT,
  ADD COLUMN "recurrence" "ChallengeRecurrence",
  ADD COLUMN "sponsorName" TEXT,
  ADD COLUMN "sponsorLogoUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_inviteCode_key" ON "Challenge"("inviteCode");

-- CreateIndex
CREATE INDEX "Challenge_recurrence_endTimestamp_idx" ON "Challenge"("recurrence", "endTimestamp");
