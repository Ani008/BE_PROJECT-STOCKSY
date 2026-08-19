/**
 * routes/journal.js
 * Trade Journal routes — mount in server.js:
 *   app.use('/api/journal', require('./routes/journal'));
 *
 * GET /api/journal            — list journal entries (newest first)
 * GET /api/journal/patterns   — weekly pattern aggregation (rule frequency + avg P&L)
 * GET /api/journal/:id        — single journal entry (full card)
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { listJournal, getJournal, weeklyPatterns, topKeywords } = require('../controllers/journalController');

router.get('/patterns', protect, weeklyPatterns); // before /:id — must not be shadowed
router.get('/keywords', protect, topKeywords);     // before /:id — must not be shadowed
router.get('/', protect, listJournal);
router.get('/:id', protect, getJournal);

module.exports = router;
