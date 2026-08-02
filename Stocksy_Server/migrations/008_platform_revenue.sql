-- =============================================================
-- 008_platform_revenue.sql
--
-- Tracks Stocksy's OWN revenue — i.e. what the platform actually
-- earns, as opposed to what the user pays in total.
--
-- Every order fill charges the user several line items (see the
-- "Estimated Charges" sheet on the buy/sell screen):
--   Stocksy Brokerage, STT, exchange transaction charges,
--   SEBI charges, stamp duty, GST
--
-- Of those, only Stocksy Brokerage is Stocksy's revenue.
-- STT -> Government of India, exchange charges -> NSE/BSE,
-- SEBI charges -> SEBI, stamp duty -> State Government, and GST
-- is collected on top of the brokerage/exchange fee and remitted
-- to the government, not kept. This table records ONLY the
-- brokerage line, so SUM(brokerage_amount) is a true revenue
-- figure, not an inflated one.
--
-- Written in the same DB transaction as the `trades` row
-- (services/executionEngine.js), so a trade and its revenue
-- entry can never exist independently of one another.
-- =============================================================

CREATE TABLE IF NOT EXISTS platform_revenue (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id          UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES orders(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  wallet_id         UUID NOT NULL REFERENCES wallets(id),
  instrument_key    VARCHAR(100) NOT NULL,
  symbol            VARCHAR(30) NOT NULL,
  side              order_side NOT NULL,
  product_type      product_type NOT NULL,
  trade_value       NUMERIC(18, 2) NOT NULL,       -- quantity * fill price (turnover)
  brokerage_amount  NUMERIC(18, 4) NOT NULL,       -- = platform revenue for this fill
  earned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_revenue_earned  ON platform_revenue(earned_at DESC);
CREATE INDEX idx_platform_revenue_user    ON platform_revenue(user_id);
CREATE INDEX idx_platform_revenue_wallet  ON platform_revenue(wallet_id);
CREATE INDEX idx_platform_revenue_symbol  ON platform_revenue(symbol);

-- =============================================================
-- ROLLUP VIEWS
-- =============================================================

-- Day-by-day revenue (for a chart / trend line)
CREATE OR REPLACE VIEW vw_revenue_daily AS
  SELECT
    date_trunc('day', earned_at)      AS day,
    COUNT(*)                          AS trade_count,
    SUM(trade_value)                  AS total_turnover,
    SUM(brokerage_amount)             AS total_revenue
  FROM platform_revenue
  GROUP BY date_trunc('day', earned_at)
  ORDER BY day DESC;

-- Month-by-month revenue ("this month I earned this much")
CREATE OR REPLACE VIEW vw_revenue_monthly AS
  SELECT
    date_trunc('month', earned_at)    AS month,
    COUNT(*)                          AS trade_count,
    SUM(trade_value)                  AS total_turnover,
    SUM(brokerage_amount)             AS total_revenue,
    AVG(brokerage_amount)             AS avg_revenue_per_trade
  FROM platform_revenue
  GROUP BY date_trunc('month', earned_at)
  ORDER BY month DESC;

-- Single-row headline summary — powers a dashboard card
CREATE OR REPLACE VIEW vw_revenue_summary AS
  SELECT
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue)
      AS total_revenue_all_time,
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue
       WHERE earned_at >= date_trunc('month', NOW()))
      AS total_revenue_this_month,
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue
       WHERE earned_at >= date_trunc('day', NOW()))
      AS total_revenue_today,
    (SELECT COUNT(*) FROM platform_revenue)
      AS total_trades_all_time,
    (SELECT COUNT(*) FROM platform_revenue
       WHERE earned_at >= date_trunc('month', NOW()))
      AS total_trades_this_month;

-- Revenue by symbol — which stocks generate the most brokerage
CREATE OR REPLACE VIEW vw_revenue_by_symbol AS
  SELECT
    symbol,
    COUNT(*)               AS trade_count,
    SUM(trade_value)        AS total_turnover,
    SUM(brokerage_amount)   AS total_revenue
  FROM platform_revenue
  GROUP BY symbol
  ORDER BY total_revenue DESC;