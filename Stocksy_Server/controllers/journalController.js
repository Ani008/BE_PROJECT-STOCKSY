const {
  listJournalEntries,
  getJournalEntry,
  getWeeklyPatterns,
  getTopKeywords,
} = require('../services/journalService');
const { sendError } = require('../utils/errors');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

const VALID_RANGES = new Set(['week', 'month', 'all']);

// ── GET /api/journal?range=week|month|all&rule_id=... ──────────────────────
async function listJournal(req, res) {
  try {
    const userId = req.user.id;
    const { wallet_id, limit = 20, offset = 0, range, rule_id } = req.query;
    const entries = await listJournalEntries(userId, {
      walletId: wallet_id,
      limit: Math.min(+limit || 20, 100),
      offset: +offset || 0,
      range: VALID_RANGES.has(range) ? range : undefined,
      ruleId: rule_id || undefined,
    });
    return res.json({ entries });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/journal/patterns ─────────────────────────────────────────────
// Must be registered BEFORE /journal/:id in routes, or "patterns" gets
// swallowed as an :id param.
async function weeklyPatterns(req, res) {
  try {
    const userId = req.user.id;
    const { wallet_id } = req.query;
    const summary = await getWeeklyPatterns(userId, { walletId: wallet_id });
    return res.json(summary);
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/journal/keywords?range=week|month|all ─────────────────────────
// Top 5 most-frequent rule "keywords" for the filter chips. Also registered
// before /:id for the same reason as /patterns above.
async function topKeywords(req, res) {
  try {
    const userId = req.user.id;
    const { wallet_id, range } = req.query;
    const summary = await getTopKeywords(userId, {
      walletId: wallet_id,
      range: VALID_RANGES.has(range) ? range : 'month',
    });
    return res.json(summary);
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/journal/:id ──────────────────────────────────────────────────
async function getJournal(req, res) {
  try {
    const entry = await getJournalEntry(req.user.id, req.params.id);
    if (!entry) throw new NotFoundError('Journal entry not found');
    return res.json({ entry });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { listJournal, getJournal, weeklyPatterns, topKeywords };
