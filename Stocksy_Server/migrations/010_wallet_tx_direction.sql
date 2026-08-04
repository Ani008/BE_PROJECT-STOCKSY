-- 011_wallet_tx_direction.sql
--
-- wallet_transactions previously stored only an unsigned `amount`, with
-- no record of whether that fill actually debited or credited the wallet.
-- Direction was being re-guessed downstream from order side (BUY/SELL),
-- which is wrong for short selling: a SELL that opens/extends a short
-- debits the wallet (margin reserved), while a SELL that closes a long
-- credits it — same order side, opposite cash direction. This column
-- stores the real direction at insert time, in executionEngine.js, where
-- it's actually known.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS direction TEXT
  CHECK (direction IN ('debit', 'credit'));

-- Backfill existing order_fill rows using the old (side-based) guess as a
-- best-effort default. This is not fully accurate for historical short
-- rows, but leaves no NULLs and does not fabricate data — it just applies
-- the same imperfect rule the app used to rely on. New rows going forward
-- are correct.
UPDATE wallet_transactions wt
SET direction = CASE WHEN o.side = 'BUY' THEN 'debit' ELSE 'credit' END
FROM orders o
WHERE wt.ref_order_id = o.id
  AND wt.type = 'order_fill'
  AND wt.direction IS NULL;

-- order_reserve / order_release rows are always a debit / credit
-- respectively, no ambiguity there.
UPDATE wallet_transactions
SET direction = 'debit'
WHERE type = 'order_reserve' AND direction IS NULL;

UPDATE wallet_transactions
SET direction = 'credit'
WHERE type = 'order_release' AND direction IS NULL;