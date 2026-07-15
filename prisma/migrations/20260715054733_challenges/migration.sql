-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startTimestamp" DATETIME NOT NULL,
    "endTimestamp" DATETIME NOT NULL,
    "startingBalancePaise" INTEGER NOT NULL,
    "allowedInstrumentIds" TEXT,
    "maxTrades" INTEGER,
    "resetAllowed" BOOLEAN NOT NULL DEFAULT false,
    "scoringMethod" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChallengeAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "virtualAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeAccount_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChallengeAccount_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChallengeResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "finalValuePaise" INTEGER NOT NULL,
    "returnPercent" REAL NOT NULL,
    "maxDrawdownPercent" REAL NOT NULL,
    "predictionAccuracyPercent" REAL,
    "tradeCount" INTEGER NOT NULL,
    "score" REAL NOT NULL,
    "rank" INTEGER NOT NULL,
    "finalizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualAccountId" TEXT NOT NULL,
    "simulationSessionId" TEXT,
    "timestamp" DATETIME NOT NULL,
    "cashPaise" INTEGER NOT NULL,
    "holdingsValuePaise" INTEGER NOT NULL,
    "portfolioValuePaise" INTEGER NOT NULL,
    "realizedPnlPaise" INTEGER NOT NULL,
    "unrealizedPnlPaise" INTEGER NOT NULL,
    "totalPnlPaise" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioSnapshot_simulationSessionId_fkey" FOREIGN KEY ("simulationSessionId") REFERENCES "SimulationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PortfolioSnapshot" ("cashPaise", "createdAt", "holdingsValuePaise", "id", "portfolioValuePaise", "realizedPnlPaise", "simulationSessionId", "timestamp", "totalPnlPaise", "unrealizedPnlPaise", "virtualAccountId") SELECT "cashPaise", "createdAt", "holdingsValuePaise", "id", "portfolioValuePaise", "realizedPnlPaise", "simulationSessionId", "timestamp", "totalPnlPaise", "unrealizedPnlPaise", "virtualAccountId" FROM "PortfolioSnapshot";
DROP TABLE "PortfolioSnapshot";
ALTER TABLE "new_PortfolioSnapshot" RENAME TO "PortfolioSnapshot";
CREATE INDEX "PortfolioSnapshot_simulationSessionId_timestamp_idx" ON "PortfolioSnapshot"("simulationSessionId", "timestamp");
CREATE UNIQUE INDEX "PortfolioSnapshot_virtualAccountId_timestamp_key" ON "PortfolioSnapshot"("virtualAccountId", "timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Challenge_status_visibility_idx" ON "Challenge"("status", "visibility");

-- CreateIndex
CREATE INDEX "Challenge_creatorId_idx" ON "Challenge"("creatorId");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_userId_idx" ON "ChallengeParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeAccount_participantId_key" ON "ChallengeAccount"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeAccount_virtualAccountId_key" ON "ChallengeAccount"("virtualAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeResult_participantId_key" ON "ChallengeResult"("participantId");

-- CreateIndex
CREATE INDEX "ChallengeResult_participantId_idx" ON "ChallengeResult"("participantId");
