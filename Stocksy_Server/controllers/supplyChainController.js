/**
 * controllers/supplyChainController.js
 * Stock Graph (supply chain) — returns the suppliers (left) and customers
 * (right) of one stock.
 *
 *   GET /api/supply-chain/:symbol
 *
 * LEFT  side = supply_links rows where customer_id = this company
 * RIGHT side = supply_links rows where supplier_id = this company
 * Only is_published = TRUE rows are returned.
 */

const { pool } = require('../config/postgres');
const INSTRUMENTS = require('../config/instruments');
const { NotFoundError, ValidationError, sendError } = require('../utils/errors');
const logger = require('../utils/logger');

// A company is "tappable" in the app only if its nse_symbol exists in
// config/instruments.js. Built once at startup — instruments.js is static.
const TAPPABLE_SYMBOLS = new Set(
  Object.values(INSTRUMENTS).map((i) => i.symbol)
);

const CONFIDENCE_ORDER = `CASE l.confidence WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`;

// Shape one DB row into what the mobile app needs for a graph box.
function toNode(row) {
  return {
    name: row.name,
    symbol: row.nse_symbol,                        // null for unlisted/govt/foreign
    companyType: row.company_type,                 // listed | unlisted | government | foreign
    item: row.item,                                // label under the name, e.g. 'Thermal coal'
    confidence: row.confidence,                    // HIGH | MEDIUM | LOW
    sourceUrl: row.source_url,
    tappable: !!row.nse_symbol && TAPPABLE_SYMBOLS.has(row.nse_symbol),
  };
}

async function buildSupplyChain(symbol, dbClient = pool) {
  if (!symbol || !/^[A-Z0-9&-]{1,30}$/.test(symbol)) {
    throw new ValidationError('Invalid stock symbol');
  }

  // 1. the centre company
  const centreRes = await dbClient.query(
    `SELECT id, name, nse_symbol, company_type
       FROM companies
      WHERE nse_symbol = $1`,
    [symbol]
  );
  const centre = centreRes.rows[0];
  if (!centre) {
    throw new NotFoundError('No supply chain data for this stock');
  }

  // 2. both sides in parallel
  const [suppliersRes, customersRes] = await Promise.all([
    // LEFT: who supplies to this company
    dbClient.query(
      `SELECT c.name, c.nse_symbol, c.company_type,
              l.item, l.confidence, l.source_url
         FROM supply_links l
         JOIN companies c ON c.id = l.supplier_id
        WHERE l.customer_id = $1 AND l.is_published = TRUE
        ORDER BY ${CONFIDENCE_ORDER}, c.name`,
      [centre.id]
    ),
    // RIGHT: who this company supplies to
    dbClient.query(
      `SELECT c.name, c.nse_symbol, c.company_type,
              l.item, l.confidence, l.source_url
         FROM supply_links l
         JOIN companies c ON c.id = l.customer_id
        WHERE l.supplier_id = $1 AND l.is_published = TRUE
        ORDER BY ${CONFIDENCE_ORDER}, c.name`,
      [centre.id]
    ),
  ]);

  return {
    company: {
      name: centre.name,
      symbol: centre.nse_symbol,
      companyType: centre.company_type,
    },
    suppliers: suppliersRes.rows.map(toNode),   // LEFT
    customers: customersRes.rows.map(toNode),   // RIGHT
  };
}

async function getSupplyChain(req, res) {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    const data = await buildSupplyChain(symbol, pool);
    return res.json(data);
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getSupplyChain, buildSupplyChain };