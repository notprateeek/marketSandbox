-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "simulationSessionId" TEXT,
    "direction" TEXT NOT NULL,
    "startingPricePaise" INTEGER NOT NULL,
    "targetPricePaise" INTEGER NOT NULL,
    "targetPercentage" REAL NOT NULL,
    "predictionTimestamp" DATETIME NOT NULL,
    "expiryTimestamp" DATETIME NOT NULL,
    "endingPricePaise" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "directionCorrect" BOOLEAN,
    "targetReached" BOOLEAN,
    "notes" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prediction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prediction_simulationSessionId_fkey" FOREIGN KEY ("simulationSessionId") REFERENCES "SimulationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Prediction_userId_status_idx" ON "Prediction"("userId", "status");

-- CreateIndex
CREATE INDEX "Prediction_instrumentId_idx" ON "Prediction"("instrumentId");

-- CreateIndex
CREATE INDEX "Prediction_simulationSessionId_idx" ON "Prediction"("simulationSessionId");
