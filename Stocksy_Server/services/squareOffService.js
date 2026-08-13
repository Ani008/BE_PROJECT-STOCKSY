/**
 * services/squareOffService.js
 *
 * Force-closes every open MIS (intraday) position at ~3:20pm IST,
 * before market close — this is what makes MIS actually "intraday"
 * rather than just "delivery with a cheaper margin requirement."
 *
 * Runs 10 minutes before the 3:30pm close to leave buffer for
 * execution — same reasoning real brokers use.
 *
 * Reuses placeOrder() rather than writing separate DB logic here,
 * so square-off orders go through the exact same path as a manual
 * sell: same brokerage calc, same wallet crediting, same trade
 * record, same NO_LTP retry safety net in the worker queue.
 *
 * Also runs the DAY-order expiry sweep (see cancelStaleRestingOrders
 * below) in the same cron tick — any resting SL/SL_M/LIMIT order that
 * never triggered today gets cancelled here, CNC and MIS alike, same as
 * a real exchange does at close.
 *
 * KNOWN LIMITATION: this does not check the NSE/BSE trading holiday
 * calendar. On a holiday the cron will still fire, but since no MIS
 * positions could have been opened that day either, this should be
 * a no-op in practice (positions query returns empty). Worth adding
 * a holiday check later if that assumption ever proves wrong.
 */

const cron = require("node-cron");
const { pool } = require("../config/postgres");
const { placeOrder, cancelOrder } = require("./orderService");
const logger = require("../utils/logger");

const SQUARE_OFF_CRON = process.env.SQUARE_OFF_CRON || "20 15 * * 1-5"; // 3:20pm IST, Mon-Fri
const TIMEZONE = "Asia/Kolkata";

async function runSquareOff() {
  logger.info("[SQUARE-OFF] Starting MIS auto square-off run");

  // quantity > 0 is an open long (needs a SELL to close). quantity < 0 is
  // an open short (needs a BUY to cover) — short positions are just as
  // much "intraday" as longs and MUST be forced flat before close too,
  // otherwise a user could carry short exposure overnight for free.
  const { rows: positions } = await pool.query(
    `SELECT id, user_id, wallet_id, instrument_key, symbol, name, quantity
     FROM positions
     WHERE product_type = 'MIS' AND quantity != 0`
  );

  if (positions.length === 0) {
    logger.info("[SQUARE-OFF] No open MIS positions found — nothing to do");
    return { squared: 0, failed: 0 };
  }

  logger.info(`[SQUARE-OFF] Found ${positions.length} open MIS position(s)`);

  let squared = 0;
  let failed = 0;

  // Sequential, not Promise.all — deliberately. These hit the same
  // execution pipeline as live user orders; we don't want a square-off
  // burst competing for DB connections with real traffic at the same
  // moment every single trading day.
  for (const pos of positions) {
    try {
      const qty = parseFloat(pos.quantity);
      const isShort = qty < 0;

      await placeOrder(pos.user_id, pos.wallet_id, {
        instrument_key: pos.instrument_key,
        symbol: pos.symbol,
        name: pos.name,
        order_type: "MARKET",
        side: isShort ? "BUY" : "SELL",
        quantity: Math.abs(qty),
        product_type: "MIS",
        metadata: { reason: "AUTO_SQUARE_OFF" },
      });

      squared += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        `[SQUARE-OFF] Failed for position ${pos.id} (${pos.symbol}, wallet ${pos.wallet_id}): ${err.message}`
      );
      // Deliberately swallow and continue — one broken position
      // (e.g. NO_LTP, a stale wallet) must not block the rest of
      // the day's square-offs.
    }
  }

  logger.info(
    `[SQUARE-OFF] Complete: ${squared} squared off, ${failed} failed`
  );

  // ── Day-order expiry sweep ────────────────────────────────────────
  // Real exchanges treat SL/SL_M/LIMIT orders as DAY orders — cancelled
  // automatically at market close if untriggered, for BOTH CNC and MIS
  // (this is different from GTT, which is a broker-side feature that
  // deliberately persists across days — see migration 007). So this
  // sweep is NOT scoped to product_type = 'MIS' like the square-off loop
  // above; a CNC stop-loss that never triggered today expires too.
  //
  // executionEngine already auto-cancels a resting SL/SL_M/LIMIT order
  // the instant the position it's linked to (order.position_id) fills
  // flat — that covers the MIS square-off closes above via the exact
  // same placeOrder()→executeOrder() pipeline. This sweep is the
  // belt-and-braces backstop for whatever that hook can't catch: orders
  // placed before migration 012 with no position_id, a position that was
  // never linked, or a fill still mid-flight in the queue when this cron
  // fires. Without it, a stale SL order would (a) sit in the
  // orderWorker's 1s requeue loop forever — burning a Bull job every
  // second indefinitely — and (b) could fire days later against whatever
  // new position happens to occupy that instrument/wallet slot next,
  // exactly the bug this whole migration exists to prevent.
  const staleCancelled = await cancelStaleRestingOrders();

  return { squared, failed, staleCancelled };
}

async function cancelStaleRestingOrders() {
  const { rows: staleOrders } = await pool.query(
    `
    SELECT id, user_id, symbol, product_type
    FROM orders
    WHERE order_type IN ('SL', 'SL_M', 'LIMIT')
    AND status IN ('PENDING', 'OPEN')
    `,
  );

  if (staleOrders.length === 0) {
    return 0;
  }

  logger.info(`[SQUARE-OFF] Sweeping ${staleOrders.length} stale DAY order(s) (SL/SL_M/LIMIT, CNC+MIS)`);

  let cancelled = 0;

  for (const order of staleOrders) {
    try {
      await cancelOrder(order.user_id, order.id);
      cancelled += 1;
    } catch (err) {
      logger.error(
        `[SQUARE-OFF] Failed to cancel stale order ${order.id} (${order.symbol}/${order.product_type}): ${err.message}`,
      );
      // Same reasoning as the position loop above — one bad order
      // shouldn't block the rest of the sweep.
    }
  }

  return cancelled;
}

function scheduleSquareOff() {
  cron.schedule(
    SQUARE_OFF_CRON,
    () => {
      runSquareOff().catch((err) =>
        logger.error(`[SQUARE-OFF] Job crashed: ${err.message}`)
      );
    },
    { timezone: TIMEZONE }
  );

  logger.info(
    `[SQUARE-OFF] Scheduled: "${SQUARE_OFF_CRON}" (${TIMEZONE})`
  );
}

module.exports = { runSquareOff, scheduleSquareOff, cancelStaleRestingOrders };