-- =============================================================
-- 012_stop_loss_position_link.sql
--
-- Stop-loss (SL / SL_M) support already existed at the mechanical
-- level (order_type enum, executionEngine trigger-price checks,
-- orderWorker's 1s requeue loop for OPEN orders) — what was missing
-- was lifecycle management: nothing tied a resting SL order back to
-- the position it was meant to protect, so:
--
--   1. Closing that position any OTHER way (manual exit, RMS
--      force-close, 3:20pm MIS square-off) left the SL order sitting
--      OPEN. Since it's still in the 1s requeue loop, the moment its
--      trigger price was later hit it would fire against a position
--      that no longer existed — opening a brand-new, unintended
--      position instead of protecting anything.
--   2. There was no way to look up "what SL orders currently guard
--      this position" for cancel-on-close logic or a future UI.
--
-- position_id is nullable: only resting orders (SL/SL_M/LIMIT) placed
-- against an existing position get linked. MARKET orders and orders
-- that open a brand-new position (no existing position row yet) stay
-- NULL — nothing to auto-cancel there.
-- =============================================================

ALTER TABLE orders
  ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

-- Partial index — only PENDING/OPEN orders are ever looked up by
-- position_id (to cancel siblings once a position goes flat), so no
-- need to index FILLED/CANCELLED/REJECTED rows.
CREATE INDEX idx_orders_position_open
  ON orders(position_id)
  WHERE status IN ('PENDING', 'OPEN');