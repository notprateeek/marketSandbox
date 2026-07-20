-- Data-integrity guards that Prisma does not model, ported from the original
-- SQLite schema. They enforce invariants at the database level even if a future
-- caller bypasses the trading service.

-- Keep the opening credit immutable after it has been recorded.
CREATE OR REPLACE FUNCTION "ledger_initial_credit_immutable"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'INITIAL_CREDIT ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_initial_credit_no_update"
BEFORE UPDATE ON "LedgerEntry"
FOR EACH ROW
WHEN (OLD."type" = 'INITIAL_CREDIT')
EXECUTE FUNCTION "ledger_initial_credit_immutable"();

CREATE TRIGGER "LedgerEntry_initial_credit_no_delete"
BEFORE DELETE ON "LedgerEntry"
FOR EACH ROW
WHEN (OLD."type" = 'INITIAL_CREDIT')
EXECUTE FUNCTION "ledger_initial_credit_immutable"();

-- Keep cash non-negative even if a future caller bypasses the trading service.
CREATE OR REPLACE FUNCTION "virtual_account_cash_nonnegative"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Virtual account cash cannot be negative';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VirtualAccount_available_cash_nonnegative_insert"
BEFORE INSERT ON "VirtualAccount"
FOR EACH ROW
WHEN (NEW."availableCashPaise" < 0)
EXECUTE FUNCTION "virtual_account_cash_nonnegative"();

CREATE TRIGGER "VirtualAccount_available_cash_nonnegative_update"
BEFORE UPDATE OF "availableCashPaise" ON "VirtualAccount"
FOR EACH ROW
WHEN (NEW."availableCashPaise" < 0)
EXECUTE FUNCTION "virtual_account_cash_nonnegative"();
