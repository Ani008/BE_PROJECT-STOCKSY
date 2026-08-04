const { getTransactions: getTransactionsRepo } = require('../repositories/transactionRepository');
const {
  getCachedTransactions,
  setCachedTransactions,
} = require('../utils/transactionsCache');
const { sendError } = require('../utils/errors');
const logger = require('../utils/logger');

// Which side of the ledger each ACCOUNT-transfer type sits on. This is
// only safe for wallet_created/wallet_deleted, which always move money
// the same way. It must NOT be extended to stock_buy/stock_sell — a SELL
// can be a debit (opening a short) or a credit (closing a long), and a
// BUY can be a debit (opening a long) or a credit (covering a short).
// Those rows carry their own `direction`, set at fill time in
// executionEngine.js from what actually happened to the wallet.
const DEBIT_TYPES = new Set(['wallet_created']);
const CREDIT_TYPES = new Set(['wallet_deleted']);

const TITLES = {
  wallet_created: 'Wallet Created',
  wallet_deleted: 'Wallet Deleted',
  stock_buy: 'Stock Purchased',
  stock_sell: 'Stock Sold',
};

const getTransactions = async (req, res) => {
  try {
    const financialUser = req.user;

    if (!financialUser) {
      return res.status(404).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        severity: 'error',
      });
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 200)
      : 50;

    // ── Cache-aside: try Redis first ──────────────────────────────────
    const cached = await getCachedTransactions(financialUser.id, limit);
    if (cached) {
      return res.status(200).json({ transactions: cached });
    }

    const rows = await getTransactionsRepo(financialUser.id, limit);

    const transactions = rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: TITLES[row.type] || row.type,
      direction: row.direction
        ? row.direction
        : (DEBIT_TYPES.has(row.type) ? 'debit' : 'credit'),
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      walletName: row.wallet_name,
      symbol: row.symbol,
      note: row.note,
      createdAt: row.created_at,
    }));

    // Populate the cache for the next request in the next 60s.
    await setCachedTransactions(financialUser.id, limit, transactions);

    res.status(200).json({ transactions });
  } catch (error) {
    logger.error(`[GET TRANSACTIONS] ${error.message}`);
    return sendError(res, error, logger);
  }
};

module.exports = { getTransactions };