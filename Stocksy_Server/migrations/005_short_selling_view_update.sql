-- =============================================================
-- 005_short_selling_view_update.sql
--
-- No schema change required for short selling itself — positions.quantity
-- was always a plain NUMERIC with no CHECK(quantity >= 0), so negative
-- (short) quantities were already representable. This migration only
-- fixes up the admin/debug view, which used to filter to `quantity > 0`
-- and would therefore silently hide open shorts.
-- =============================================================

CREATE OR REPLACE VIEW vw_portfolio_summary AS
  SELECT
    p.user_id,
    p.wallet_id,
    w.name AS wallet_name,
    COUNT(*) AS position_count,
    COUNT(*) FILTER (WHERE p.quantity < 0) AS short_position_count,
    SUM(p.quantity * p.avg_cost) AS net_invested_value,
    SUM(ABS(p.quantity) * p.avg_cost) AS gross_invested_value,
    SUM(p.realised_pnl) AS total_realised_pnl
  FROM positions p
  JOIN wallets w ON w.id = p.wallet_id
  WHERE p.quantity != 0
  GROUP BY p.user_id, p.wallet_id, w.name;
