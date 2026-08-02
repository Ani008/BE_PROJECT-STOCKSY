/**
 * services/positionService.js
 * Production-grade position service
 * Merged version:
 * - Clean structure from NEW file
 * - Live LTP + PnL engine from OLD file
 * - Wallet metadata + richer joins from NEW file
 */

const { pool } = require('../config/postgres');
const redisClient = require('./redisService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function getLivePrices(instrumentKeys = []) {
  if (!instrumentKeys.length) {
    return {};
  }

  const redisKeys = instrumentKeys.map(
    key => `stock:${key}`
  );

  const values = await redisClient.mGet(redisKeys);

  const prices = {};

  redisKeys.forEach((key, index) => {
    try {
      const parsed = values[index]
        ? JSON.parse(values[index])
        : null;

      prices[key] = parsed?.ltpc?.ltp
        ? parseFloat(parsed.ltpc.ltp)
        : null;

    } catch {
      prices[key] = null;
    }
  });

  return prices;
}

// ─────────────────────────────────────────────────────────────
// Get Positions
// ─────────────────────────────────────────────────────────────

async function getPositions(userId, walletId = null) {

  // Fetch positions + wallet metadata
  const { rows: positions } = await pool.query(
    `
    SELECT
      p.*,
      w.name  AS wallet_name,
      w.color AS wallet_color,
      w.balance AS wallet_balance
    FROM positions p
    JOIN wallets w
      ON w.id = p.wallet_id
    WHERE p.user_id = $1
      AND ($2::uuid IS NULL OR p.wallet_id = $2)
      AND p.quantity != 0
    ORDER BY p.updated_at DESC
    `,
    [userId, walletId]
  );

  // Fetch all live prices in one Redis call
  const prices = await getLivePrices(
    positions.map(p => p.instrument_key)
  );

  // Enrich positions with live calculations
  const enrichedPositions = positions.map(position => {

    const qty = parseFloat(position.quantity);

    const avgCost = parseFloat(position.avg_cost);

    const realisedPnl = parseFloat(
      position.realised_pnl || 0
    );

    const ltp = prices[
      `stock:${position.instrument_key}`
    ];

    // quantity is negative for a short — use the magnitude for
    // invested/current value so they read as sensible positive numbers,
    // same as any broker's positions screen. unrealised P&L keeps qty's
    // sign as-is: (ltp - avgCost) * qty naturally flips correctly for a
    // short (price falling below entry is a profit when qty is negative).
    const investedValue = avgCost * Math.abs(qty);

    const currentValue =
      ltp !== null
        ? ltp * Math.abs(qty)
        : investedValue;

    const unrealisedPnl =
      ltp !== null
        ? (ltp - avgCost) * qty
        : 0;

    const unrealisedPnlPct =
      ltp !== null && avgCost > 0
        ? ((ltp - avgCost) / avgCost) * 100 * (qty < 0 ? -1 : 1)
        : 0;

    return {
      ...position,

      quantity: qty,
      avg_cost: avgCost,
      position_side: qty < 0 ? 'SHORT' : 'LONG',
      realised_pnl: parseFloat(
        realisedPnl.toFixed(2)
      ),

      ltp,

      invested_value: parseFloat(
        investedValue.toFixed(2)
      ),

      current_value: parseFloat(
        currentValue.toFixed(2)
      ),

      unrealised_pnl: parseFloat(
        unrealisedPnl.toFixed(2)
      ),

      unrealised_pnl_pct: parseFloat(
        unrealisedPnlPct.toFixed(2)
      ),
    };
  });

  return enrichedPositions;
}

// ─────────────────────────────────────────────────────────────
// Portfolio Summary
// ─────────────────────────────────────────────────────────────

async function getPortfolioSummary(userId) {

  // Get enriched positions
  const positions = await getPositions(userId);

  // Wallets
  const { rows: wallets } = await pool.query(
    `
    SELECT
      id,
      name,
      balance,
      color,
      is_default,
      created_at
    FROM wallets
    WHERE user_id = $1
    ORDER BY created_at ASC
    `,
    [userId]
  );

  // Calculations
  const totalInvested = positions.reduce(
    (acc, pos) => acc + pos.invested_value,
    0
  );

  const totalCurrentValue = positions.reduce(
    (acc, pos) => acc + pos.current_value,
    0
  );

  const totalUnrealisedPnl = positions.reduce(
    (acc, pos) => acc + pos.unrealised_pnl,
    0
  );

  const totalRealisedPnl = positions.reduce(
    (acc, pos) => acc + pos.realised_pnl,
    0
  );

  const cashBalance = wallets.reduce(
    (acc, wallet) => acc + parseFloat(wallet.balance),
    0
  );

  const portfolioValue =
    totalCurrentValue + cashBalance;

  return {
    positions,

    wallets,

    summary: {

      total_invested: parseFloat(
        totalInvested.toFixed(2)
      ),

      total_current_value: parseFloat(
        totalCurrentValue.toFixed(2)
      ),

      total_unrealised_pnl: parseFloat(
        totalUnrealisedPnl.toFixed(2)
      ),

      total_realised_pnl: parseFloat(
        totalRealisedPnl.toFixed(2)
      ),

      cash_balance: parseFloat(
        cashBalance.toFixed(2)
      ),

      portfolio_value: parseFloat(
        portfolioValue.toFixed(2)
      ),

      position_count: positions.length,
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Trade History
// ─────────────────────────────────────────────────────────────

async function getTrades(
  userId,
  {
    walletId,
    instrumentKey,
    limit = 20,
    offset = 0
  } = {}
) {

  let query = `
    SELECT
      t.*,
      w.name AS wallet_name,
      o.order_type
    FROM trades t

    JOIN wallets w
      ON w.id = t.wallet_id

    JOIN orders o
      ON o.id = t.order_id

    WHERE t.user_id = $1
  `;

  const params = [userId];

  let idx = 2;

  if (walletId) {
    query += ` AND t.wallet_id = $${idx++}`;
    params.push(walletId);
  }

  if (instrumentKey) {
    query += ` AND t.instrument_key = $${idx++}`;
    params.push(instrumentKey);
  }

  query += `
    ORDER BY t.executed_at DESC
    LIMIT $${idx++}
    OFFSET $${idx++}
  `;

  params.push(limit, offset);

  const { rows } = await pool.query(
    query,
    params
  );

  return rows;
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  getPositions,
  getPortfolioSummary,
  getTrades
};