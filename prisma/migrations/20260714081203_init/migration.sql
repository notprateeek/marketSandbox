-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Authenticator" (
    "credentialID" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "credentialPublicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "credentialDeviceType" TEXT NOT NULL,
    "credentialBackedUp" BOOLEAN NOT NULL,
    "transports" TEXT,

    PRIMARY KEY ("userId", "credentialID"),
    CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VirtualAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startingBalancePaise" INTEGER NOT NULL,
    "availableCashPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VirtualAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Authenticator_credentialID_key" ON "Authenticator"("credentialID");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_userId_key" ON "VirtualAccount"("userId");

-- CreateIndex
CREATE INDEX "LedgerEntry_virtualAccountId_createdAt_idx" ON "LedgerEntry"("virtualAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_referenceType_referenceId_idx" ON "LedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_one_initial_credit_per_account_key" ON "LedgerEntry"("virtualAccountId") WHERE "type" = 'INITIAL_CREDIT';

-- Keep the opening credit immutable after it has been recorded.
CREATE TRIGGER "LedgerEntry_initial_credit_no_update"
BEFORE UPDATE ON "LedgerEntry"
WHEN OLD."type" = 'INITIAL_CREDIT'
BEGIN
    SELECT RAISE(ABORT, 'INITIAL_CREDIT ledger entries are immutable');
END;

CREATE TRIGGER "LedgerEntry_initial_credit_no_delete"
BEFORE DELETE ON "LedgerEntry"
WHEN OLD."type" = 'INITIAL_CREDIT'
BEGIN
    SELECT RAISE(ABORT, 'INITIAL_CREDIT ledger entries are immutable');
END;

-- CreateIndex
CREATE INDEX "Instrument_symbol_isActive_idx" ON "Instrument"("symbol", "isActive");

-- CreateIndex
CREATE INDEX "Instrument_companyName_idx" ON "Instrument"("companyName");

-- CreateIndex
CREATE INDEX "Instrument_isin_idx" ON "Instrument"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_exchange_symbol_key" ON "Instrument"("exchange", "symbol");
