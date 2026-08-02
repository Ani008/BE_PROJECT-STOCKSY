/**
 * services/alertWatcherService.js
 *
 * Polls every ACTIVE price alert against the live LTP in Redis (same
 * `stock:${instrumentKey}` key the order engine reads from).
 *
 * Two kinds of alert, one watcher:
 *   - NOTIFY  — notify-only. Marks TRIGGERED and emails the owner. Never
 *               places an order.
 *   - BUY/SELL (GTT) — once triggered, places a real CNC order through
 *               the exact same placeOrder() pipeline a manual order uses
 *               (same brokerage calc, same wallet debit, same trade
 *               record, shows up in Order History like any other order).
 *               Only runs while the market is open — if the target is
 *               hit outside market hours, the alert is left ACTIVE and
 *               re-checked next tick rather than failing it outright.
 *               If placeOrder() rejects it (insufficient funds/holdings,
 *               etc.), the alert fails once, gets marked FAILED, and the
 *               owner is emailed — no automatic retry.
 *
 * Runs every minute, every day — cheap even with zero alerts (empty
 * query short-circuits before touching Redis at all).
 */

const cron = require("node-cron");
const redisClient = require("./redisService");
const marketCalendar = require("./marketCalendarService");
const { placeOrder } = require("./orderService");
const {
  getActiveAlertsWithOwner,
  markTriggered,
  markExecuted,
  markFailed,
} = require("../repositories/alertRepository");
const sendAlertTriggeredEmail = require("../utils/sendAlertTriggeredEmail");
const sendAlertExecutedEmail = require("../utils/sendAlertExecutedEmail");
const sendAlertFailedEmail = require("../utils/sendAlertFailedEmail");
const logger = require("../utils/logger");

const ALERT_WATCH_CRON = process.env.ALERT_WATCH_CRON || "* * * * *"; // every minute
const TIMEZONE = "Asia/Kolkata";

async function getLtp(instrumentKey) {
  try {
    const raw = await redisClient.get(`stock:${instrumentKey}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const ltp = parseFloat(data?.ltpc?.ltp ?? 0);
    return ltp > 0 ? ltp : null;
  } catch {
    return null;
  }
}

async function handleNotify(alert, ltp) {
  const updated = await markTriggered({ alertId: alert.id, triggeredPrice: ltp });
  if (!updated) return; // another tick already handled it

  await sendAlertTriggeredEmail({
    email: alert.email,
    name: alert.full_name,
    symbol: alert.symbol,
    targetPrice: alert.target_price,
    triggeredPrice: ltp,
    direction: alert.direction,
  });

  logger.info(`[ALERTS] Notified ${alert.id} (${alert.symbol}) @ ${ltp}`);
}

async function handleGtt(alert, ltp) {
  // Target reached outside market hours — wait, don't fail. placeOrder()
  // would reject it with MarketClosedError anyway, but that's not the
  // person's fault, so this shouldn't burn their one shot at execution.
  if (!marketCalendar.isMarketOpen()) return;

  try {
    const order = await placeOrder(alert.user_id, alert.wallet_id, {
      instrument_key: alert.instrument_key,
      symbol: alert.symbol,
      name: alert.name,
      order_type: "MARKET",
      side: alert.action, // 'BUY' | 'SELL'
      quantity: Number(alert.quantity),
      product_type: "CNC",
      metadata: { source: "GTT", alert_id: alert.id },
    });

    const updated = await markExecuted({
      alertId: alert.id,
      triggeredPrice: ltp,
      orderId: order.id,
    });
    if (!updated) return; // another tick already handled it

    await sendAlertExecutedEmail({
      email: alert.email,
      name: alert.full_name,
      symbol: alert.symbol,
      action: alert.action,
      quantity: alert.quantity,
      targetPrice: alert.target_price,
      executedPrice: order.price ?? ltp,
      orderId: order.id,
    });

    logger.info(`[ALERTS] GTT executed ${alert.id} (${alert.symbol}) ${alert.action} @ ${ltp}`);
  } catch (err) {
    const updated = await markFailed({
      alertId: alert.id,
      triggeredPrice: ltp,
      reason: err.message,
    });
    if (!updated) return;

    await sendAlertFailedEmail({
      email: alert.email,
      name: alert.full_name,
      symbol: alert.symbol,
      action: alert.action,
      quantity: alert.quantity,
      targetPrice: alert.target_price,
      reason: err.message,
    });

    logger.warn(`[ALERTS] GTT failed ${alert.id} (${alert.symbol}): ${err.message}`);
  }
}

async function checkAlerts() {
  const alerts = await getActiveAlertsWithOwner();

  if (!alerts.length) return;

  for (const alert of alerts) {
    try {
      const ltp = await getLtp(alert.instrument_key);
      if (ltp == null) continue;

      const target = Number(alert.target_price);
      const crossed =
        alert.direction === "ABOVE" ? ltp >= target : ltp <= target;

      if (!crossed) continue;

      if (alert.action === "NOTIFY") {
        await handleNotify(alert, ltp);
      } else {
        await handleGtt(alert, ltp);
      }
    } catch (err) {
      logger.error(`[ALERTS] Failed processing alert ${alert.id}: ${err.message}`);
      // Keep going — one bad alert/email shouldn't block the rest of the batch.
    }
  }
}

function scheduleAlertWatcher() {
  cron.schedule(
    ALERT_WATCH_CRON,
    () => {
      checkAlerts().catch((err) => logger.error(`[ALERTS] Watcher crashed: ${err.message}`));
    },
    { timezone: TIMEZONE },
  );

  logger.info(`[ALERTS] Price alert watcher scheduled (${ALERT_WATCH_CRON}, ${TIMEZONE})`);
}

module.exports = { scheduleAlertWatcher, checkAlerts };