const { pool } = require("../config/postgres");

/**
 * deleteAccount — permanently deletes a user's account, no matter how
 * many open holdings or how much wallet balance they currently have.
 *
 * Runs as a single DB transaction:
 *   1. Lock the user row.
 *   2. Snapshot account stats (wallets, balance, open positions, order/
 *      trade counts) — this is what gets written to the permanent
 *      `account_deletions` audit record.
 *   3. Write that audit record. It has no FK to `users`, so it survives
 *      step 4 untouched.
 *   4. DELETE the user row. Every ON DELETE CASCADE FK (wallets,
 *      positions, orders, trades, wallet_transactions,
 *      account_transactions, order_events) wipes automatically —
 *      holdings and wallet balance are erased right along with it,
 *      regardless of their size.
 *
 * If anything fails partway through, the whole thing rolls back —
 * either the account is fully gone with a matching audit record, or
 * nothing changed at all.
 */
const deleteAccount = async (userId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId],
    );

    const user = userResult.rows[0];

    if (!user) {
      throw new Error("Account not found");
    }

    const walletStats = await client.query(
      `
      SELECT COUNT(*)::int AS wallet_count,
             COALESCE(SUM(balance), 0) AS total_balance
      FROM wallets
      WHERE user_id = $1
      `,
      [userId],
    );

    const positionStats = await client.query(
      `
      SELECT COUNT(*)::int AS open_positions
      FROM positions
      WHERE user_id = $1
      AND quantity != 0
      `,
      [userId],
    );

    const orderStats = await client.query(
      `
      SELECT COUNT(*)::int AS order_count
      FROM orders
      WHERE user_id = $1
      `,
      [userId],
    );

    const tradeStats = await client.query(
      `
      SELECT COUNT(*)::int AS trade_count
      FROM trades
      WHERE user_id = $1
      `,
      [userId],
    );

    const walletsClosed = walletStats.rows[0].wallet_count;
    const totalWalletBalance = Number(walletStats.rows[0].total_balance);
    const openPositions = positionStats.rows[0].open_positions;
    const orderCount = orderStats.rows[0].order_count;
    const tradeCount = tradeStats.rows[0].trade_count;

    await client.query(
      `
      INSERT INTO account_deletions (
        original_user_id,
        full_name,
        username,
        email,
        provider,
        final_demo_balance,
        wallets_closed,
        total_wallet_balance_debited,
        open_positions_closed,
        total_orders_placed,
        total_trades_executed,
        account_created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        user.id,
        user.full_name,
        user.username,
        user.email,
        user.provider,
        user.demo_balance,
        walletsClosed,
        totalWalletBalance,
        openPositions,
        orderCount,
        tradeCount,
        user.created_at,
      ],
    );

    // Cascades away wallets, positions, orders, trades,
    // wallet_transactions, account_transactions, order_events.
    await client.query(
      `
      DELETE FROM users
      WHERE id = $1
      `,
      [userId],
    );

    await client.query("COMMIT");

    return {
      walletsClosed,
      totalWalletBalance,
      openPositions,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { deleteAccount };