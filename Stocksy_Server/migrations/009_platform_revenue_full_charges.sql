-- 009_platform_revenue_full_charges.sql
ALTER TABLE platform_revenue
  ADD COLUMN IF NOT EXISTS stt                 NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_txn_charge  NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sebi_charges         NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stamp_duty           NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst                  NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_charges        NUMERIC(18, 4) NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW vw_revenue_daily AS
  SELECT date_trunc('day', earned_at) AS day, COUNT(*) AS trade_count,
    SUM(trade_value) AS total_turnover, SUM(brokerage_amount) AS total_revenue,
    SUM(total_charges) AS total_charges_collected
  FROM platform_revenue GROUP BY date_trunc('day', earned_at) ORDER BY day DESC;

CREATE OR REPLACE VIEW vw_revenue_monthly AS
  SELECT date_trunc('month', earned_at) AS month, COUNT(*) AS trade_count,
    SUM(trade_value) AS total_turnover, SUM(brokerage_amount) AS total_revenue,
    AVG(brokerage_amount) AS avg_revenue_per_trade, SUM(total_charges) AS total_charges_collected
  FROM platform_revenue GROUP BY date_trunc('month', earned_at) ORDER BY month DESC;

CREATE OR REPLACE VIEW vw_revenue_summary AS
  SELECT
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue) AS total_revenue_all_time,
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue WHERE earned_at >= date_trunc('month', NOW())) AS total_revenue_this_month,
    (SELECT COALESCE(SUM(brokerage_amount), 0) FROM platform_revenue WHERE earned_at >= date_trunc('day', NOW())) AS total_revenue_today,
    (SELECT COUNT(*) FROM platform_revenue) AS total_trades_all_time,
    (SELECT COUNT(*) FROM platform_revenue WHERE earned_at >= date_trunc('month', NOW())) AS total_trades_this_month,
    (SELECT COALESCE(SUM(total_charges), 0) FROM platform_revenue) AS total_charges_all_time;

-- 010_trades_total_charges.sql
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS total_charges NUMERIC(18, 4) NOT NULL DEFAULT 0;