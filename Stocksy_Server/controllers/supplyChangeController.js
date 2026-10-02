/**
 * controllers/supplyChangeController.js
 * Admin enters "company X changed a supplier/customer" -> it is applied to
 * supply_links IMMEDIATELY (no pending, no approval) and logged in
 * supply_change_reports as history.
 *
 *   POST /api/supply-chain/changes                  (admin only)
 *   GET  /api/supply-chain/changes/company/:symbol  (any logged-in user)
 */

const { pool } = require('../config/postgres');
const { NotFoundError, ValidationError, sendError } = require('../utils/errors');
const { buildSupplyChain } = require('./supplyChainController');
const logger = require('../utils/logger');

const SIDES = ['SUPPLIER', 'CUSTOMER'];
const TYPES = ['REPLACED', 'ADDED', 'REMOVED'];
const COMPANY_TYPES = ['listed', 'unlisted', 'government', 'foreign'];
const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'];
const SYMBOL_RE = /^[A-Z0-9&-]{1,30}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Find a company by NSE symbol or by name (case-insensitive). Returns id or null.
async function findCompany(db, nameOrSymbol) {
  if (!nameOrSymbol) return null;
  const { rows } = await db.query(
    `SELECT id FROM companies
      WHERE nse_symbol = UPPER($1) OR LOWER(name) = LOWER($1)
      LIMIT 1`,
    [nameOrSymbol]
  );
  return rows[0]?.id ?? null;
}

// Find the NEW party, or create it if it does not exist yet.
async function findOrCreateCompany(db, name, symbol, type) {
  const existing = (symbol && (await findCompany(db, symbol))) || (await findCompany(db, name));
  if (existing) return existing;

  if (type === 'listed' && !symbol) {
    throw new ValidationError('newPartySymbol is required when newPartyType is "listed"');
  }
  const { rows } = await db.query(
    `INSERT INTO companies (name, nse_symbol, company_type)
     VALUES ($1, $2, $3) RETURNING id`,
    [name, symbol || null, type]
  );
  return rows[0].id;
}

// POST /changes -------------------------------------------------------------
async function createChange(req, res) {
  let client;
  try {
    const b = req.body || {};

    const symbol = str(b.companySymbol).toUpperCase();
    const relationSide = str(b.relationSide).toUpperCase();
    const changeType = str(b.changeType).toUpperCase();
    const oldName = str(b.oldParty);
    const newName = str(b.newParty);
    const newSymbol = str(b.newPartySymbol).toUpperCase() || null;
    const newType = str(b.newPartyType).toLowerCase() || 'unlisted';
    const item = str(b.item);
    const reason = str(b.reason) || null;
    const sourceUrl = str(b.sourceUrl) || null;
    const effectiveDate = str(b.effectiveDate) || null;
    const confidence = str(b.confidence).toUpperCase() || 'HIGH';

    if (!SYMBOL_RE.test(symbol)) throw new ValidationError('Invalid company symbol');
    if (!SIDES.includes(relationSide)) throw new ValidationError('relationSide must be SUPPLIER or CUSTOMER');
    if (!TYPES.includes(changeType)) throw new ValidationError('changeType must be REPLACED, ADDED or REMOVED');
    if (!item || item.length > 120) throw new ValidationError('item is required (max 120 characters)');
    if (oldName.length > 200 || newName.length > 200) throw new ValidationError('Company name is too long');
    if (changeType !== 'ADDED' && !oldName) throw new ValidationError('oldParty is required for this change type');
    if (changeType !== 'REMOVED' && !newName) throw new ValidationError('newParty is required for this change type');
    if (changeType === 'REPLACED' && oldName.toLowerCase() === newName.toLowerCase()) {
      throw new ValidationError('oldParty and newParty cannot be the same');
    }
    if (newSymbol && !SYMBOL_RE.test(newSymbol)) throw new ValidationError('Invalid newPartySymbol');
    if (!COMPANY_TYPES.includes(newType)) throw new ValidationError('newPartyType must be listed, unlisted, government or foreign');
    if (!CONFIDENCES.includes(confidence)) throw new ValidationError('confidence must be HIGH, MEDIUM or LOW');
    if (reason && reason.length > 2000) throw new ValidationError('reason is too long');
    if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) throw new ValidationError('sourceUrl must be an http(s) URL');
    if (effectiveDate && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || isNaN(Date.parse(effectiveDate)))) {
      throw new ValidationError('effectiveDate must be YYYY-MM-DD');
    }

    // One transaction: either the whole change is applied, or nothing is.
    client = await pool.connect();
    await client.query('BEGIN');

    const companyId = await findCompany(client, symbol);
    if (!companyId) throw new NotFoundError('Company not found');

    // old party must already exist (we are removing a real link)
    let oldId = null;
    if (changeType !== 'ADDED') {
      oldId = await findCompany(client, oldName);
      if (!oldId) throw new NotFoundError(`"${oldName}" not found in companies`);
    }
    // new party is created automatically if it is not in the DB yet
    let newId = null;
    if (changeType !== 'REMOVED') {
      newId = await findOrCreateCompany(client, newName, newSymbol, newType);
    }
    if (oldId === companyId || newId === companyId) {
      throw new ValidationError('A company cannot supply itself');
    }

    // Direction of the arrow:
    //   SUPPLIER change -> arrow is  party -> company
    //   CUSTOMER change -> arrow is  company -> party
    const arrow = (partyId) =>
      relationSide === 'SUPPLIER'
        ? { supplier: partyId, customer: companyId }
        : { supplier: companyId, customer: partyId };

    // 1. remove the old link
    if (oldId) {
      const a = arrow(oldId);
      const del = await client.query(
        `DELETE FROM supply_links
          WHERE supplier_id = $1 AND customer_id = $2 AND LOWER(item) = LOWER($3)`,
        [a.supplier, a.customer, item]
      );
      if (del.rowCount === 0) {
        throw new NotFoundError(`No existing "${item}" link with "${oldName}" to remove`);
      }
    }

    // 2. add the new link (published straight away)
    if (newId) {
      const a = arrow(newId);
      await client.query(
        `INSERT INTO supply_links
           (supplier_id, customer_id, item, source_url, confidence, is_published)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (supplier_id, customer_id, item)
         DO UPDATE SET source_url = EXCLUDED.source_url,
                       confidence = EXCLUDED.confidence,
                       is_published = TRUE`,
        [a.supplier, a.customer, item, sourceUrl, confidence]
      );
    }

    // 3. history log
    const log = await client.query(
      `INSERT INTO supply_change_reports
         (company_id, submitted_by, relation_side, change_type,
          old_party_name, old_party_id, new_party_name, new_party_id,
          item, reason, source_url, effective_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at`,
      [
        companyId, req.user.id, relationSide, changeType,
        oldId ? oldName : null, oldId, newId ? newName : null, newId,
        item, reason, sourceUrl, effectiveDate,
      ]
    );

    // read the fresh graph inside the same transaction, then commit
    const graph = await buildSupplyChain(symbol, client);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Supply chain updated',
      change: {
        id: log.rows[0].id,
        changeType, relationSide, item,
        oldParty: oldId ? oldName : null,
        newParty: newId ? newName : null,
        reason, sourceUrl, effectiveDate,
        createdAt: log.rows[0].created_at,
      },
      graph, // { company, suppliers, customers } — already updated
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return sendError(res, err, logger);
  } finally {
    if (client) client.release();
  }
}

// GET /changes/company/:symbol ----------------------------------------------
// History of changes for one company, newest first.
async function listForCompany(req, res) {
  try {
    const symbol = str(req.params.symbol).toUpperCase();
    if (!SYMBOL_RE.test(symbol)) throw new ValidationError('Invalid stock symbol');

    const { rows } = await pool.query(
      `SELECT r.id, r.relation_side, r.change_type, r.old_party_name, r.new_party_name,
              r.item, r.reason, r.source_url, r.effective_date, r.created_at
         FROM supply_change_reports r
         JOIN companies c ON c.id = r.company_id
        WHERE c.nse_symbol = $1
        ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC, r.created_at DESC
        LIMIT 100`,
      [symbol]
    );

    return res.json({
      changes: rows.map((r) => ({
        id: r.id,
        relationSide: r.relation_side,
        changeType: r.change_type,
        oldParty: r.old_party_name,
        newParty: r.new_party_name,
        item: r.item,
        reason: r.reason,
        sourceUrl: r.source_url,
        effectiveDate: r.effective_date,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { createChange, listForCompany };