const { pool } = require("../config/postgres");

// ── Create ───────────────────────────────────────────────────────────────────
const createAlert = async ({
  userId,
  instrumentKey,
  symbol,
  name,
  targetPrice,
  direction,
  action = "NOTIFY",
  quantity = null,
  walletId = null,
  productType = null,
}) => {
  const result = await pool.query(
    `
    INSERT INTO price_alerts (
      user_id, instrument_key, symbol, name, target_price, direction,
      action, quantity, wallet_id, product_type
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
    `,
    [userId, instrumentKey, symbol, name, targetPrice, direction, action, quantity, walletId, productType],
  );

  return result.rows[0];
};

// ── List (for the logged-in user's Alerts screen) ──────────────────────────
const getAlertsByUser = async (userId) => {
  const result = await pool.query(
    `
    SELECT *
    FROM price_alerts
    WHERE user_id = $1
    ORDER BY
      CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
      created_at DESC
    `,
    [userId],
  );

  return result.rows;
};

// ── Cancel (only the owner, only while still ACTIVE) ────────────────────────
const cancelAlert = async ({ alertId, userId }) => {
  const result = await pool.query(
    `
    UPDATE price_alerts
    SET status = 'CANCELLED'
    WHERE id = $1
    AND user_id = $2
    AND status = 'ACTIVE'
    RETURNING *
    `,
    [alertId, userId],
  );

  return result.rows[0];
};

// ── Watcher queries ──────────────────────────────────────────────────────────

// Every still-active alert, joined with the owner's email/name so the
// watcher can send the "target reached" email without a second query per row.
const getActiveAlertsWithOwner = async () => {
  const result = await pool.query(
    `
    SELECT a.*, u.email, u.full_name
    FROM price_alerts a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'ACTIVE'
    `,
  );

  return result.rows;
};

const markTriggered = async ({ alertId, triggeredPrice }) => {
  const result = await pool.query(
    `
    UPDATE price_alerts
    SET status = 'TRIGGERED',
        triggered_at = NOW(),
        triggered_price = $1
    WHERE id = $2
    AND status = 'ACTIVE'
    RETURNING *
    `,
    [triggeredPrice, alertId],
  );

  return result.rows[0];
};

// BUY/SELL alert successfully placed a real order — links back to it via
// resulting_order_id so the Alerts screen can jump straight to it.
const markExecuted = async ({ alertId, triggeredPrice, orderId }) => {
  const result = await pool.query(
    `
    UPDATE price_alerts
    SET status = 'EXECUTED',
        triggered_at = NOW(),
        triggered_price = $1,
        resulting_order_id = $2
    WHERE id = $3
    AND status = 'ACTIVE'
    RETURNING *
    `,
    [triggeredPrice, orderId, alertId],
  );

  return result.rows[0];
};

// BUY/SELL alert triggered but placeOrder() rejected it (insufficient
// funds/holdings, etc.) — fails once and stops, per the chosen behavior;
// no automatic retry.
const markFailed = async ({ alertId, triggeredPrice, reason }) => {
  const result = await pool.query(
    `
    UPDATE price_alerts
    SET status = 'FAILED',
        triggered_at = NOW(),
        triggered_price = $1,
        fail_reason = $2
    WHERE id = $3
    AND status = 'ACTIVE'
    RETURNING *
    `,
    [triggeredPrice, reason, alertId],
  );

  return result.rows[0];
};

module.exports = {
  createAlert,
  getAlertsByUser,
  cancelAlert,
  getActiveAlertsWithOwner,
  markTriggered,
  markExecuted,
  markFailed,
};