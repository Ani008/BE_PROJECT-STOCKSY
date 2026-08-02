-- =============================================================
-- GTT (Good Till Triggered) — auto-order support on top of
-- price_alerts. NOTIFY keeps the existing notify-only behavior;
-- BUY/SELL auto-place a real order through the same placeOrder()
-- pipeline used for manual orders, once triggered.
--
-- CNC (Delivery) ONLY — same reasoning real brokers (Zerodha) use:
-- a GTT can sit un-triggered for days/weeks, which doesn't fit MIS's
-- same-day-square-off rule. NOTIFY-only alerts are unaffected and
-- still work for both CNC and MIS, since they carry no order/margin
-- implication.
-- =============================================================

CREATE TYPE alert_action AS ENUM ('NOTIFY', 'BUY', 'SELL');

-- EXECUTED / FAILED only apply to BUY/SELL alerts. TRIGGERED stays
-- reserved for NOTIFY alerts (kept as-is, not repurposed) so existing
-- rows and the watcher's NOTIFY branch don't need to change meaning.
ALTER TYPE alert_status ADD VALUE 'EXECUTED';
ALTER TYPE alert_status ADD VALUE 'FAILED';

ALTER TABLE price_alerts
  ADD COLUMN action           alert_action NOT NULL DEFAULT 'NOTIFY',
  ADD COLUMN quantity         NUMERIC(12, 4),                  -- required when action != NOTIFY
  ADD COLUMN wallet_id        UUID REFERENCES wallets(id) ON DELETE CASCADE,
  ADD COLUMN product_type     VARCHAR(10),                     -- always 'CNC' when action != NOTIFY
  ADD COLUMN resulting_order_id UUID REFERENCES orders(id),    -- set once a BUY/SELL alert executes successfully
  ADD COLUMN fail_reason      TEXT;                            -- set once a BUY/SELL alert fails to execute

CREATE INDEX idx_price_alerts_wallet ON price_alerts(wallet_id);