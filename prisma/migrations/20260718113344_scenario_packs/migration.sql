-- AlterTable
ALTER TABLE "SimulationSession" ADD COLUMN     "scenarioPackId" TEXT;

-- CreateTable
CREATE TABLE "ScenarioPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startTimestamp" TIMESTAMP(3) NOT NULL,
    "endTimestamp" TIMESTAMP(3) NOT NULL,
    "instrumentIds" TEXT NOT NULL,
    "startingBalancePaise" BIGINT NOT NULL,
    "checkpoints" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioPack_slug_key" ON "ScenarioPack"("slug");

-- CreateIndex
CREATE INDEX "SimulationSession_scenarioPackId_idx" ON "SimulationSession"("scenarioPackId");

-- AddForeignKey
ALTER TABLE "SimulationSession" ADD CONSTRAINT "SimulationSession_scenarioPackId_fkey" FOREIGN KEY ("scenarioPackId") REFERENCES "ScenarioPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
