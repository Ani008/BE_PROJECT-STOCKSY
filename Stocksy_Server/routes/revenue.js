/**
 * routes/revenue.js
 * Platform revenue endpoints — mount in server.js:
 *   app.use('/api/revenue', require('./routes/revenue'));
 *
 * TODO before shipping this beyond your own testing: `protect` only checks
 * that *someone* is logged in — it doesn't check *who*. This data is
 * platform-wide (every user's trades), so any logged-in user can currently
 * see total company revenue. The app has no role/admin concept yet
 * (see migrations/001_create_users.sql — no `role` column), so either
 * add one and swap `protect` for an `adminOnly` middleware here, or for
 * now just check `req.user.id` against your own user id inside each
 * handler before this goes anywhere near production.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getSummary,
  getMonthly,
  getDaily,
  getBySymbol,
  getLedger,
} = require('../controllers/revenueController');

// GET /api/revenue/summary    — headline card: all-time / this month / today
// GET /api/revenue/monthly    — month-by-month trend
// GET /api/revenue/daily      — day-by-day trend
// GET /api/revenue/by-symbol  — which stocks earn the most brokerage
// GET /api/revenue/ledger     — raw paginated ledger
router.get('/summary',    protect, getSummary);
router.get('/monthly',    protect, getMonthly);
router.get('/daily',      protect, getDaily);
router.get('/by-symbol',  protect, getBySymbol);
router.get('/ledger',     protect, getLedger);

module.exports = router;