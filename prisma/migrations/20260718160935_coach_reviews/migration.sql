-- CreateTable
CREATE TABLE "CoachReview" (
    "id" TEXT NOT NULL,
    "virtualAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "markdown" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tradeCountAtGeneration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachReview_virtualAccountId_createdAt_idx" ON "CoachReview"("virtualAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoachReview" ADD CONSTRAINT "CoachReview_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
