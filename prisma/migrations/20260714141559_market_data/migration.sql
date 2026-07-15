-- CreateTable
CREATE TABLE "PriceCandle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "openPaise" INTEGER NOT NULL,
    "highPaise" INTEGER NOT NULL,
    "lowPaise" INTEGER NOT NULL,
    "closePaise" INTEGER NOT NULL,
    "volume" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceCandle_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PriceCandle_instrumentId_timestamp_idx" ON "PriceCandle"("instrumentId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCandle_instrumentId_interval_timestamp_key" ON "PriceCandle"("instrumentId", "interval", "timestamp");
