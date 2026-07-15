-- DropIndex
DROP INDEX "VirtualAccount_userId_key";

-- CreateTable
CREATE TABLE "SimulationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "virtualAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTimestamp" DATETIME NOT NULL,
    "currentTimestamp" DATETIME NOT NULL,
    "endTimestamp" DATETIME NOT NULL,
    "initialBalancePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "playbackSpeed" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SimulationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SimulationSession_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulationSession_virtualAccountId_key" ON "SimulationSession"("virtualAccountId");

-- CreateIndex
CREATE INDEX "SimulationSession_userId_createdAt_idx" ON "SimulationSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VirtualAccount_userId_idx" ON "VirtualAccount"("userId");
