const { pool } = require("../config/postgres");

/**
 * Returns a unified, newest-first feed of everything that has moved
 * money for this user:
 *   - wallet_created  (always debit  — demo balance -> sub-wallet)
 *   - wallet_deleted  (always credit — sub-wallet -> demo balance, refund)
 *   - stock_buy / stock_sell (label only — direction is NOT implied by
 *     this label; a SELL that opens a short is a debit, a BUY that covers
 *     a short is a credit. Direction comes from wallet_transactions.direction,
 *     which executionEngine.js sets explicitly at fill time based on what
 *     actually happened to the wallet — not guessed from order side here.)
 *
 * Buy/sell rows come from wallet_transactions where type = 'order_fill',
 * joined to orders to know the side (BUY/SELL, for the label/icon only)
 * and symbol.
 */
const getTransactions = async (userId, limit = 50) => {
  const result = await pool.query(
    `
    SELECT * FROM (
      SELECT
        at.id,
        at.type::text                AS type,
        at.amount,
        NULL::text                    AS direction,
        at.balance_after,
        at.wallet_name,
        NULL::text                    AS symbol,
        at.note,
        at.created_at
      FROM account_transactions at
      WHERE at.user_id = $1

      UNION ALL

      SELECT
        wt.id,
        CASE WHEN o.side = 'BUY' THEN 'stock_buy' ELSE 'stock_sell' END AS type,
        wt.amount,
        wt.direction                  AS direction,
        wt.balance_after,
        w.name                        AS wallet_name,
        o.symbol                      AS symbol,
        wt.note,
        wt.created_at
      FROM wallet_transactions wt
      JOIN orders o   ON o.id = wt.ref_order_id
      JOIN wallets w  ON w.id = wt.wallet_id
      WHERE wt.type = 'order_fill'
        AND o.user_id = $1
    ) combined
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [userId, limit],
  );

  return result.rows;
};

module.exports = { getTransactions };