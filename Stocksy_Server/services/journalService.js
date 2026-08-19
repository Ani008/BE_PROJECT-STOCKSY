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
const { evaluateTrade, RULE_LABELS } = require('./journalRuleEngine');

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

// ── 3. Listing / detail / filtering ─────────────────────────────────────

// 'week' → last 7 days, 'month' → last 30 days, 'all'/undefined → no date filter.
const RANGE_DAYS = { week: 7, month: 30, all: null };

function resolveRangeDays(range) {
  if (range == null) return null;
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, range) ? RANGE_DAYS[range] : null;
}

/**
 * @param {object} opts
 * @param {string} [opts.walletId]
 * @param {number} [opts.limit=20]
 * @param {number} [opts.offset=0]
 * @param {'week'|'month'|'all'} [opts.range]  — omit for no date filter (same as 'all')
 * @param {string} [opts.ruleId]                — only entries where this rule fired
 *   (e.g. clicking a "top keyword" chip)
 */
async function listJournalEntries(userId, { walletId, limit = 20, offset = 0, range, ruleId } = {}) {
  const params = [userId];
  let where = 'WHERE user_id = $1';

  if (walletId) {
    params.push(walletId);
    where += ` AND wallet_id = $${params.length}`;
  }

  const days = resolveRangeDays(range);
  if (days != null) {
    params.push(days);
    where += ` AND exit_at >= NOW() - ($${params.length} || ' days')::interval`;
  }

  if (ruleId) {
    params.push(ruleId);
    where += ` AND $${params.length} = ANY(rule_ids)`;
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
 * Shared aggregation behind both the "this week's pattern" narrative card
 * and the "top keywords" filter chips — same grouping logic, different
 * sort order and time window.
 *
 * @param {object} opts
 * @param {string} [opts.walletId]
 * @param {number|null} [opts.days=7] — lookback window in days, or null for all-time
 * @param {'avgPnl'|'count'} [opts.sortBy='avgPnl'] — 'avgPnl' = worst pattern first
 *   (for the narrative card), 'count' = most frequent first (for keyword chips)
 * @param {number} [opts.limit] — cap the number of patterns returned
 */
async function computePatternSummary(userId, { walletId, days = 7, sortBy = 'avgPnl', limit } = {}) {
  const params = [userId];
  let where = 'WHERE user_id = $1';
  if (walletId) {
    params.push(walletId);
    where += ` AND wallet_id = $${params.length}`;
  }
  if (days != null) {
    params.push(days);
    where += ` AND exit_at >= NOW() - ($${params.length} || ' days')::interval`;
  }

  const { rows: entries } = await pool.query(
    `SELECT rule_ids, realised_pnl FROM trade_journal_entries ${where}`,
    params,
  );

  if (entries.length === 0) {
    return { totalTrades: 0, losingTrades: 0, patterns: [] };
  }

  const pnls = entries.map((e) => parseFloat(e.realised_pnl));
  const losingTrades = pnls.filter((p) => p < 0).length;

  const byRule = {};
  for (let i = 0; i < entries.length; i++) {
    const ruleIds = entries[i].rule_ids || [];
    for (const ruleId of ruleIds) {
      if (!byRule[ruleId]) byRule[ruleId] = { matchPnls: [] };
      byRule[ruleId].matchPnls.push(pnls[i]);
    }
  }

  let patterns = Object.entries(byRule).map(([ruleId, stats]) => {
    const matchPnls = stats.matchPnls;
    const matchCount = matchPnls.length;
    const matchLossCount = matchPnls.filter((p) => p < 0).length;
    const avgPnl = round2(sum(matchPnls) / matchCount);

    // Everything else = trades NOT matching this rule, for comparison.
    const otherPnls = pnls.filter((p, i) => !(entries[i].rule_ids || []).includes(ruleId));
    const otherAvgPnl = otherPnls.length ? round2(sum(otherPnls) / otherPnls.length) : null;

    // Rough "this pattern cost you" figure: only meaningful when the
    // pattern's trades did worse than everything else — never shown as
    // a negative/confusing number when the pattern is neutral or good.
    const estimatedCost =
      otherAvgPnl != null && otherAvgPnl > avgPnl
        ? round2((otherAvgPnl - avgPnl) * matchCount)
        : null;

    return {
      ruleId,
      label: RULE_LABELS[ruleId] || ruleId,
      count: matchCount,
      lossCount: matchLossCount,
      avgPnl,
      otherAvgPnl,
      estimatedCost,
    };
  });

  patterns.sort(
    sortBy === 'count'
      ? (a, b) => b.count - a.count // most frequent first
      : (a, b) => a.avgPnl - b.avgPnl, // worst P&L first
  );

  if (limit) patterns = patterns.slice(0, limit);

  return { totalTrades: entries.length, losingTrades, patterns };
}

/**
 * Weekly pattern view — "N of your M losing trades this week were X".
 * Always the last 7 days, worst pattern first — this is the narrative
 * card, not a filter control.
 */
async function getWeeklyPatterns(userId, { walletId } = {}) {
  return computePatternSummary(userId, { walletId, days: 7, sortBy: 'avgPnl' });
}

/**
 * Top keywords — the 5 most frequently-firing rules over a selectable
 * range, sorted by frequency (not P&L). Meant to back clickable filter
 * chips: tapping one calls listJournalEntries(userId, { ruleId, ... }).
 *
 * @param {'week'|'month'|'all'} [opts.range='month']
 */
async function getTopKeywords(userId, { walletId, range = 'month', limit = 5 } = {}) {
  const days = resolveRangeDays(range);
  return computePatternSummary(userId, { walletId, days, sortBy: 'count', limit });
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  getIndicatorSnapshot,
  maybeGenerateJournalEntry,
  listJournalEntries,
  getJournalEntry,
  getWeeklyPatterns,
  getTopKeywords,
};
