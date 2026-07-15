-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualAccountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'MARKET',
    "requestedQuantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "simulationTimestamp" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_quantity_check" CHECK ("requestedQuantity" >= 0 AND "filledQuantity" >= 0 AND "filledQuantity" <= "requestedQuantity")
);

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "virtualAccountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "grossAmountPaise" INTEGER NOT NULL,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "simulationTimestamp" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeExecution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeExecution_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeExecution_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeExecution_values_check" CHECK ("quantity" > 0 AND "pricePaise" > 0 AND "grossAmountPaise" = "quantity" * "pricePaise")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualAccountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averageBuyPricePaise" INTEGER NOT NULL,
    "totalCostPaise" INTEGER NOT NULL,
    "realizedPnlPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Position_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Position_values_check" CHECK ("quantity" >= 0 AND "averageBuyPricePaise" >= 0 AND "totalCostPaise" >= 0)
);

-- CreateIndex
CREATE INDEX "Order_virtualAccountId_submittedAt_idx" ON "Order"("virtualAccountId", "submittedAt");

-- CreateIndex
CREATE INDEX "Order_instrumentId_submittedAt_idx" ON "Order"("instrumentId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeExecution_orderId_key" ON "TradeExecution"("orderId");

-- CreateIndex
CREATE INDEX "TradeExecution_virtualAccountId_executedAt_idx" ON "TradeExecution"("virtualAccountId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeExecution_instrumentId_executedAt_idx" ON "TradeExecution"("instrumentId", "executedAt");

-- CreateIndex
CREATE INDEX "Position_instrumentId_idx" ON "Position"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_virtualAccountId_instrumentId_key" ON "Position"("virtualAccountId", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_account_reference_key" ON "LedgerEntry"("virtualAccountId", "referenceType", "referenceId");

-- Keep cash non-negative even if a future caller bypasses the trading service.
CREATE TRIGGER "VirtualAccount_available_cash_nonnegative_insert"
BEFORE INSERT ON "VirtualAccount"
WHEN NEW."availableCashPaise" < 0
BEGIN
    SELECT RAISE(ABORT, 'Virtual account cash cannot be negative');
END;

CREATE TRIGGER "VirtualAccount_available_cash_nonnegative_update"
BEFORE UPDATE OF "availableCashPaise" ON "VirtualAccount"
WHEN NEW."availableCashPaise" < 0
BEGIN
    SELECT RAISE(ABORT, 'Virtual account cash cannot be negative');
END;
