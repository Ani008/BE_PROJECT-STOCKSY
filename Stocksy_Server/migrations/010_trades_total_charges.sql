-- =============================================================
-- 010_trades_total_charges.sql
--
-- Companion to 009_platform_revenue_full_charges.sql. That migration
-- taught platform_revenue about the full charges breakdown; this one
-- adds the same total_charges figure to the trades table itself, so
-- a user's own trade history/contract-note view can show what was
-- actually deducted for that fill (brokerage + STT + exchange txn
-- charge + SEBI charges + stamp duty + GST), not just the brokerage
-- line.
--
-- Pairs with the wallet-debit change in services/executionEngine.js
-- and services/orderService.js: the wallet now moves totalCharges,
-- not just brokerage, on every fill — this column is what actually
-- happened, recorded per trade.
-- =============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS total_charges NUMERIC(18, 4) NOT NULL DEFAULT 0;