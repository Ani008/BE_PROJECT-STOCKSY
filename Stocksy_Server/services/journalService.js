/**
 * services/journalService.js
 *
 * Trade Journal — v1
 *
 * Two responsibilities:
 *   1. getIndicatorSnapshot(instrumentKey) — read the live RSI/VWAP/volume-
 *      ratio from Redis at the moment a trade fills, called from
 *      executionEngine.js right before the trade row is inserted so the
 *      snapshot can be written into the same INSERT.
 *   2. maybeGenerateJournalEntry(...) — called AFTER a SELL (or short-cover)
 *      fill commits, only when the position has just fully closed (quantity
 *      hit 0). Finds the trade that opened this round trip, runs the rule
 *      engine, and writes one trade_journal_entries row.
 *
 * v1 known limitation (documented, not hidden): round-trip matching is
 * FIFO over a single position_id — the oldest not-yet-consumed BUY trade
 * for that position is treated as "the entry". This is correct for the
 * common beginner pattern (one entry, one exit) and for sequential
 * single-lot round trips on the same instrument+wallet+product within a
 * day. It does not yet weight multiple partial entries into one blended
 * "entry snapshot" for a position built up across several BUY fills before
 * being closed in one SELL — that's a v2 refinement once the per-trade
 * card is validated with real usage.
 */

const { pool } = require('../config/postgres');
const redisClient = require('./redisService');
const logger = require('../utils/logger');
const { evaluateTrade } = require('./journalRuleEngine');

// ── 1. Snapshot capture (called at fill time) ──────────────────────────────

async function getIndicatorSnapshot(instrumentKey) {
  try {
    const raw = await redisClient.get(`indicators:${instrumentKey}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      rsi: data.rsi ?? null,
      vwap: data.vwap ?? null,
      volume_ratio: data.volume_ratio ?? null,
      ltp: data.ltp ?? null,
      ts: data.ts ?? null,
    };
  } catch (e) {
    logger.warn(`[journal] snapshot read failed for ${instrumentKey}: ${e.message}`);
    return null;
  }
}

// ── 2. Round-trip detection + journal entry generation ─────────────────────

/**
 * Call this after a SELL/cover fill commits, only when the fill closed the
 * position (newQty <= 0 in executionEngine.js). Runs outside the DB
 * transaction that filled the order — journal generation is reflective,
 * non-critical, and must never risk the order-fill path.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.walletId
 * @param {string} params.positionId
 * @param {string} params.instrumentKey
 * @param {string} params.symbol
 * @param {string} params.exitTradeId   — the trade row that closed the position
 * @param {string} params.side          — order_side of the round trip's ENTRY (BUY=long, SELL=short)
 * @param {number} params.exitPrice
 * @param {number} params.quantity      — total quantity of the round trip closed by this exit
 * @param {number} params.realisedPnl
 * @param {string} params.exitAt        — ISO timestamp of the exit fill
 */
async function maybeGenerateJournalEntry(params) {
  const {
    userId, walletId, positionId, instrumentKey, symbol,
    exitTradeId, side, exitPrice, quantity, realisedPnl, exitAt,
  } = params;

  try {
    const entrySide = side === 'BUY' ? 'BUY' : 'SELL'; // long round trip opened with BUY, short with SELL

    // FIFO: oldest entry-side trade for this position not already consumed
    // by a previous journal entry, before this exit's timestamp.
    const { rows: [entryTrade] } = await pool.query(
      `
      SELECT t.*
      FROM trades t
      WHERE t.position_id = $1
        AND t.side = $2
        AND t.executed_at < $3
        AND NOT EXISTS (
          SELECT 1 FROM trade_journal_entries j
          WHERE j.entry_trade_id = t.id
        )
      ORDER BY t.executed_at ASC
      LIMIT 1
      `,
      [positionId, entrySide, exitAt],
    );

    const { rows: [exitTrade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1`,
      [exitTradeId],
    );

    if (!exitTrade) {
      logger.warn(`[journal] exit trade ${exitTradeId} not found, skipping entry`);
      return null;
    }

    const entrySnapshot = entryTrade?.indicator_snapshot ?? null;
    const exitSnapshot = exitTrade.indicator_snapshot ?? null;

    const entryPrice = entryTrade ? parseFloat(entryTrade.price) : null;
    const entryAt = entryTrade ? entryTrade.executed_at : null;

    const holdingSeconds = entryAt
      ? Math.max(0, Math.round((new Date(exitAt) - new Date(entryAt)) / 1000))
      : null;

    const ctx = {
      side: entrySide,
      quantity: parseFloat(quantity),
      entryPrice,
      exitPrice: parseFloat(exitPrice),
      holdingSeconds,
      pnl: parseFloat(realisedPnl),
      entry: entrySnapshot,
      exit: exitSnapshot,
    };

    const insights = evaluateTrade(ctx);
    const ruleIds = insights.map((i) => i.ruleId);

    const { rows: [entry] } = await pool.query(
      `
      INSERT INTO trade_journal_entries (
        user_id, wallet_id, position_id, instrument_key, symbol, name,
        entry_trade_id, exit_trade_id, side, quantity,
        entry_price, exit_price, entry_at, exit_at, holding_seconds,
        realised_pnl, entry_snapshot, exit_snapshot, rule_ids, insights
      ) VALUES (
        $1,$2,$3,$4,$5,$5,
        $6,$7,$8,$9,
        $10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19
      )
      RETURNING *
      `,
      [
        userId, walletId, positionId, instrumentKey, symbol,
        entryTrade?.id ?? null, exitTradeId, entrySide, quantity,
        entryPrice, exitPrice, entryAt, exitAt, holdingSeconds,
        realisedPnl, JSON.stringify(entrySnapshot), JSON.stringify(exitSnapshot),
        ruleIds, JSON.stringify(insights),
      ],
    );

    logger.info(`[journal] entry generated for ${symbol} (${entry.id}), rules: ${ruleIds.join(', ') || 'none'}`);
    return entry;
  } catch (e) {
    // Journal generation is best-effort and must never affect trading.
    logger.error(`[journal] generation failed: ${e.message}`);
    return null;
  }
}

// ── 3. Listing / detail ─────────────────────────────────────────────────

async function listJournalEntries(userId, { walletId, limit = 20, offset = 0 } = {}) {
  const params = [userId];
  let where = 'WHERE user_id = $1';
  if (walletId) {
    params.push(walletId);
    where += ` AND wallet_id = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `
    SELECT *
    FROM trade_journal_entries
    ${where}
    ORDER BY exit_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return rows;
}

async function getJournalEntry(userId, id) {
  const { rows: [entry] } = await pool.query(
    `SELECT * FROM trade_journal_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return entry || null;
}

/**
 * Weekly pattern view — "N of your M losing trades this week were X".
 * Groups by rule_id across the last 7 days, computing frequency + avg P&L
 * for trades where that rule fired vs. trades where it didn't.
 */
async function getWeeklyPatterns(userId, { walletId } = {}) {
  const params = [userId];
  let where = 'WHERE user_id = $1 AND exit_at >= NOW() - INTERVAL \'7 days\'';
  if (walletId) {
    params.push(walletId);
    where += ` AND wallet_id = $${params.length}`;
  }

  const { rows: entries } = await pool.query(
    `SELECT rule_ids, realised_pnl FROM trade_journal_entries ${where}`,
    params,
  );

  if (entries.length === 0) {
    return { totalTrades: 0, losingTrades: 0, patterns: [] };
  }

  const byRule = {};
  for (const row of entries) {
    for (const ruleId of row.rule_ids || []) {
      if (!byRule[ruleId]) byRule[ruleId] = { count: 0, totalPnl: 0 };
      byRule[ruleId].count += 1;
      byRule[ruleId].totalPnl += parseFloat(row.realised_pnl);
    }
  }

  const patterns = Object.entries(byRule)
    .map(([ruleId, stats]) => ({
      ruleId,
      count: stats.count,
      avgPnl: Math.round((stats.totalPnl / stats.count) * 100) / 100,
    }))
    .sort((a, b) => a.avgPnl - b.avgPnl); // worst patterns first

  return {
    totalTrades: entries.length,
    losingTrades: entries.filter((e) => parseFloat(e.realised_pnl) < 0).length,
    patterns,
  };
}

module.exports = {
  getIndicatorSnapshot,
  maybeGenerateJournalEntry,
  listJournalEntries,
  getJournalEntry,
  getWeeklyPatterns,
};
