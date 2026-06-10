-- Pre-create per-year order number sequences so they never need to be
-- created inside a transaction. DDL inside an interactive transaction
-- acquires an AccessExclusive catalog lock; two concurrent order-creation
-- transactions trying to CREATE the same sequence will deadlock.
-- onModuleInit keeps the current and next year up-to-date at runtime.
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2025 START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2026 START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2027 START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2028 START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2029 START 1;
CREATE SEQUENCE IF NOT EXISTS order_number_seq_2030 START 1;
