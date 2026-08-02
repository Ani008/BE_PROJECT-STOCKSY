const {
  getRevenueSummary,
  getMonthlyRevenue,
  getDailyRevenue,
  getRevenueBySymbol,
  getRevenueLedger,
} = require('../services/revenueService');
const { sendError } = require('../utils/errors');
const logger = require('../utils/logger');

// ── GET /api/revenue/summary ─────────────────────────────────────────────────
async function getSummary(req, res) {
  try {
    const summary = await getRevenueSummary();
    return res.json({ summary });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/revenue/monthly?limit=12 ────────────────────────────────────────
async function getMonthly(req, res) {
  try {
    const { limit = 12 } = req.query;
    const months = await getMonthlyRevenue({ limit: +limit });
    return res.json({ months });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/revenue/daily?limit=30 ──────────────────────────────────────────
async function getDaily(req, res) {
  try {
    const { limit = 30 } = req.query;
    const days = await getDailyRevenue({ limit: +limit });
    return res.json({ days });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/revenue/by-symbol?limit=10 ──────────────────────────────────────
async function getBySymbol(req, res) {
  try {
    const { limit = 10 } = req.query;
    const symbols = await getRevenueBySymbol({ limit: +limit });
    return res.json({ symbols });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/revenue/ledger?limit=50&offset=0&from=&to= ──────────────────────
async function getLedger(req, res) {
  try {
    const { limit = 50, offset = 0, from, to } = req.query;
    const entries = await getRevenueLedger({ limit: +limit, offset: +offset, from, to });
    return res.json({ entries });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getSummary, getMonthly, getDaily, getBySymbol, getLedger };