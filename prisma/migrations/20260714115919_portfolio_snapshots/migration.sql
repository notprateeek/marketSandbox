-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualAccountId" TEXT NOT NULL,
    "simulationSessionId" TEXT NOT NULL,
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

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_simulationSessionId_timestamp_idx" ON "PortfolioSnapshot"("simulationSessionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_virtualAccountId_timestamp_key" ON "PortfolioSnapshot"("virtualAccountId", "timestamp");
