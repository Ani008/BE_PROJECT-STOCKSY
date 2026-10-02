/**
 * routes/supplyChain.js
 * Mount in server.js:
 *   app.use('/api/supply-chain', require('./routes/supplyChain'));
 *
 * GET /api/supply-chain/:symbol — suppliers (left) + customers (right) of a stock
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getSupplyChain } = require('../controllers/supplyChainController');

router.get('/:symbol', getSupplyChain);

module.exports = router;