/**
 * services/revenueService.js
 *
 * Read layer over the `platform_revenue` table (migrations/005_platform_revenue.sql).
 * Every row in that table is one filled trade's brokerage amount — i.e. actual
 * Stocksy revenue, not the full "estimated charges" shown to the user (which
 * also includes STT, exchange charges, SEBI charges, stamp duty and GST — all
 * of which are pass-throughs to the government/exchange, not platform revenue).
 *
 * This is platform-wide data (every user's trades), so every handler in
 * controllers/revenueController.js that calls into this file should sit
 * behind an admin check, not just `protect` — see the route file for the
 * TODO on that.
 */

const { pool } = require('../config/postgres');

// ── Headline summary card: all-time / this month / today ───────────────────────
async function getRevenueSummary() {
  const { rows: [summary] } = await pool.query(
    `SELECT * FROM vw_revenue_summary`
  );
  return {
    totalRevenueAllTime: parseFloat(summary.total_revenue_all_time),
    totalRevenueThisMonth: parseFloat(summary.total_revenue_this_month),
    totalRevenueToday: parseFloat(summary.total_revenue_today),
    totalTradesAllTime: parseInt(summary.total_trades_all_time, 10),
    totalTradesThisMonth: parseInt(summary.total_trades_this_month, 10),
  };
}

// ── Month-by-month trend, e.g. for a bar chart ──────────────────────────────────
async function getMonthlyRevenue({ limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM vw_revenue_monthly ORDER BY month DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    month: r.month,
    tradeCount: parseInt(r.trade_count, 10),
    totalTurnover: parseFloat(r.total_turnover),
    totalRevenue: parseFloat(r.total_revenue),
    avgRevenuePerTrade: parseFloat(r.avg_revenue_per_trade),
  }));
}

// ── Day-by-day trend, e.g. for a line chart over the last N days ────────────────
async function getDailyRevenue({ limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM vw_revenue_daily ORDER BY day DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    day: r.day,
    tradeCount: parseInt(r.trade_count, 10),
    totalTurnover: parseFloat(r.total_turnover),
    totalRevenue: parseFloat(r.total_revenue),
  }));
}

// ── Which symbols generate the most brokerage ───────────────────────────────────
async function getRevenueBySymbol({ limit = 10 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM vw_revenue_by_symbol LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    tradeCount: parseInt(r.trade_count, 10),
    totalTurnover: parseFloat(r.total_turnover),
    totalRevenue: parseFloat(r.total_revenue),
  }));
}

// ── Raw ledger, paginated — for an admin "revenue log" table ────────────────────
async function getRevenueLedger({ limit = 50, offset = 0, from, to } = {}) {
  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`earned_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`earned_at <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const { rows } = await pool.query(
    `
    SELECT id, trade_id, order_id, user_id, wallet_id, instrument_key, symbol,
           side, product_type, trade_value, brokerage_amount, earned_at
    FROM platform_revenue
    ${whereClause}
    ORDER BY earned_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    tradeId: r.trade_id,
    orderId: r.order_id,
    userId: r.user_id,
    walletId: r.wallet_id,
    instrumentKey: r.instrument_key,
    symbol: r.symbol,
    side: r.side,
    productType: r.product_type,
    tradeValue: parseFloat(r.trade_value),
    brokerageAmount: parseFloat(r.brokerage_amount),
    earnedAt: r.earned_at,
  }));
}

module.exports = {
  getRevenueSummary,
  getMonthlyRevenue,
  getDailyRevenue,
  getRevenueBySymbol,
  getRevenueLedger,
};