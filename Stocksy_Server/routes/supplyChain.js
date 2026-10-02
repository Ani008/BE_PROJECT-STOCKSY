/**
 * routes/supplyChain.js
 * Mount in server.js:
 *   app.use('/api/supply-chain', require('./routes/supplyChain'));
 *
 * GET  /api/supply-chain/:symbol                   suppliers (left) + customers (right)
 * POST /api/supply-chain/changes                   ADMIN: enter a change, applied immediately
 * GET  /api/supply-chain/changes/company/:symbol   history of changes for a company
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { getSupplyChain } = require('../controllers/supplyChainController');
const { createChange, listForCompany } = require('../controllers/supplyChangeController');

// These MUST stay above '/:symbol' or "changes" is read as a stock symbol.
router.post('/changes', protect, requireAdmin, createChange);
router.get('/changes/company/:symbol', protect, listForCompany);

router.get('/:symbol', protect, getSupplyChain);

module.exports = router;