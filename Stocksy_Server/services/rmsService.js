/**
 * services/rmsService.js
 *
 * Lightweight Risk Management System (RMS).
 *
 * Real brokers don't wait until the 3:20pm square-off cron to close a
 * losing intraday position — they watch margin utilization continuously
 * throughout the day and force-close (or margin-call) the moment an open
 * loss eats too far into the margin backing that position. Without this,
 * a short (or leveraged long) that moves hard against you just sits there
 * accumulating loss beyond what your wallet can actually cover, and the
 * only backstop is the end-of-day cron — by which point you could already
 * be underwater.
 *
 * This is a simplified version of that:
 *
 *   1. Poll every open MIS position across every user (not literally on
 *      every price tick — that would mean re-running this per instrument
 *      per 800ms WebSocket push, hammering Postgres for no real benefit.
 *      A short poll interval, default 5s, is frequent enough to react
 *      fast without adding real load).
 *   2. Pull live prices for every one of those positions in a single
 *      Redis mGet — same batching pattern websocketService.js already
 *      uses, for the same reason (N sequential round-trips would make
 *      the whole check lag behind real prices).
 *   3. For each position, compute unrealised P&L and the margin blocking
 *      it — same formulas positionService/executionEngine already use,
 *      so this can't silently drift from what the rest of the OMS thinks
 *      a position is worth.
 *   4. If the loss has eaten past MAINTENANCE_THRESHOLD (default 80%) of
 *      the margin blocking that position, force-close it through the
 *      exact same placeOrder() → queue → executionEngine pipeline
 *      squareOffService already uses for the 3:20pm cron — same
 *      brokerage, same wallet accounting, same trade record as a manual
 *      exit, just triggered by risk instead of by the clock.
 *
 * KNOWN LIMITATIONS — this is deliberately simple, not a real RMS:
 *   - No cross-margining. Each position is evaluated against its own
 *     blocked margin in isolation, not against total account equity.
 *     A real broker nets your whole book together.
 *   - No margin-call / top-up grace window. Real brokers usually give
 *     you a chance to add funds before force-closing; this goes straight
 *     to force-close once the threshold is breached.
 *   - No partial de-risking. Real RMS often trims part of a position
 *     first; this always closes the position in full.
 *   - The forced MARKET order itself is subject to the same slippage/
 *     fill logic as any other order — in a genuinely fast-moving or
 *     illiquid instrument, the fill price (and therefore the final
 *     loss) can still land past the threshold that triggered it.
 *   - If the loss is severe enough that covering it would take the
 *     wallet negative, execution still rolls back at the DB's
 *     CHECK(balance >= 0) constraint (see executionEngine's rejectOrder
 *     path) — RMS does not (yet) allow the wallet to go negative to
 *     force a close through. That gap is a separate, larger piece of
 *     work (real brokers do let your account go negative and chase
 *     recovery afterward).
 */

const { pool } = require("../config/postgres");
const redisClient = require("./redisService");
const { placeOrder } = require("./orderService");
const { getLeverage } = require("../config/leverage");
const marketCalendar = require("./marketCalendarService");
const { notifyClient } = require("./websocketService");
const logger = require("../utils/logger");

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const RMS_CHECK_INTERVAL_MS = parseInt(
  process.env.RMS_CHECK_INTERVAL_MS || "5000",
  10,
);

// Fraction of blocked margin a position is allowed to lose before RMS
// force-closes it. 0.80 means: once the open loss on a position reaches
// 80% of the margin reserved for it, close it now rather than let it run
// toward (or past) fully wiping that margin out.
const MAINTENANCE_THRESHOLD = parseFloat(
  process.env.RMS_MAINTENANCE_THRESHOLD || "0.80",
);

// ─────────────────────────────────────────────────────────────
// In-flight guard
// ─────────────────────────────────────────────────────────────
//
// placeOrder() only PLACES an order — the actual fill happens
// asynchronously via the queue/worker. Without this guard, the next
// 5-second poll would see the position still open (order hasn't filled
// yet) and fire ANOTHER force-close order on top of the first one.
// Track positions we've already triggered a close for and skip them
// until either the position clears (qty hits 0, handled naturally since
// it stops showing up in the query) or a short cooldown passes.

const inFlight = new Set();

function positionKey(walletId, instrumentKey, productType) {
  return `${walletId}:${instrumentKey}:${productType}`;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function getLivePricesFor(instrumentKeys) {
  if (!instrumentKeys.length) return {};

  const redisKeys = instrumentKeys.map((k) => `stock:${k}`);
  const values = await redisClient.mGet(redisKeys);

  const prices = {};
  redisKeys.forEach((key, i) => {
    try {
      const parsed = values[i] ? JSON.parse(values[i]) : null;
      prices[key] = parsed?.ltpc?.ltp ? parseFloat(parsed.ltpc.ltp) : null;
    } catch {
      prices[key] = null;
    }
  });

  return prices;
}

// ─────────────────────────────────────────────────────────────
// Core check — exported standalone too, so it can be unit tested or
// triggered manually without waiting for the interval.
// ─────────────────────────────────────────────────────────────

async function runRmsCheck() {
  // Nothing can fill outside market hours anyway, and there's no point
  // burning a DB query every 5s while the market's closed.
  if (!marketCalendar.isMarketOpen()) {
    return { checked: 0, closed: 0 };
  }

  const { rows: positions } = await pool.query(
    `
    SELECT id, user_id, wallet_id, instrument_key, symbol, name,
           quantity, avg_cost, product_type
    FROM positions
    WHERE product_type = 'MIS' AND quantity != 0
    `,
  );

  if (!positions.length) {
    return { checked: 0, closed: 0 };
  }

  const uniqueInstrumentKeys = [
    ...new Set(positions.map((p) => p.instrument_key)),
  ];
  const prices = await getLivePricesFor(uniqueInstrumentKeys);

  let closed = 0;

  for (const pos of positions) {
    const key = positionKey(pos.wallet_id, pos.instrument_key, pos.product_type);

    if (inFlight.has(key)) continue; // already being closed — don't double-fire

    const ltp = prices[`stock:${pos.instrument_key}`];
    if (!ltp) continue; // no live price yet, can't evaluate

    const qty = parseFloat(pos.quantity);
    const avgCost = parseFloat(pos.avg_cost);
    const leverage = getLeverage(pos.symbol, pos.product_type);

    const marginBlocked = (Math.abs(qty) * avgCost) / leverage;
    if (marginBlocked <= 0) continue;

    // Sign-correct for both long (qty > 0) and short (qty < 0) — same
    // formula used everywhere else in the OMS (positionService,
    // executionEngine). A short profits when price falls below entry,
    // which this formula already reflects via qty's sign.
    const unrealisedPnl = (ltp - avgCost) * qty;

    if (unrealisedPnl >= 0) continue; // in profit or flat, nothing to do

    const lossRatio = Math.abs(unrealisedPnl) / marginBlocked;

    if (lossRatio < MAINTENANCE_THRESHOLD) continue;

    inFlight.add(key);
    closed += 1;

    logger.warn(
      `[RMS] Force-closing ${pos.symbol} (${pos.product_type}) for user ${pos.user_id} — ` +
        `loss ₹${Math.abs(unrealisedPnl).toFixed(2)} is ${(lossRatio * 100).toFixed(1)}% of ` +
        `₹${marginBlocked.toFixed(2)} margin blocked (threshold ${(MAINTENANCE_THRESHOLD * 100).toFixed(0)}%)`,
    );

    // Fire-and-forget deliberately — one bad/edge-case position (e.g.
    // stale price, wallet already near zero) must not block the loop
    // from evaluating the rest. Errors are logged, not thrown.
    placeOrder(pos.user_id, pos.wallet_id, {
      instrument_key: pos.instrument_key,
      symbol: pos.symbol,
      name: pos.name,
      order_type: "MARKET",
      side: qty > 0 ? "SELL" : "BUY", // close a long by selling, cover a short by buying
      quantity: Math.abs(qty),
      product_type: "MIS",
      metadata: {
        reason: "RMS_AUTO_SQUARE_OFF",
        lossRatio: parseFloat(lossRatio.toFixed(4)),
      },
    })
      .then(() => {
        notifyClient(pos.user_id, {
          type: "RMS_SQUARE_OFF",
          symbol: pos.symbol,
          instrumentKey: pos.instrument_key,
          productType: pos.product_type,
          reason: "MAINTENANCE_MARGIN_BREACHED",
          lossRatio: parseFloat(lossRatio.toFixed(4)),
          ts: Date.now(),
        });
      })
      .catch((err) => {
        logger.error(
          `[RMS] Force-close failed for ${pos.symbol} (user ${pos.user_id}): ${err.message}`,
        );
      })
      .finally(() => {
        // Hold the guard a little past one poll interval so the fill has
        // time to actually land (placeOrder only queues it, the worker
        // fills it asynchronously) before this position is eligible to
        // be re-evaluated.
        setTimeout(() => inFlight.delete(key), RMS_CHECK_INTERVAL_MS);
      });
  }

  return { checked: positions.length, closed };
}

// ─────────────────────────────────────────────────────────────
// Interval control
// ─────────────────────────────────────────────────────────────

let intervalHandle = null;

function startRms() {
  if (intervalHandle) return; // already running

  intervalHandle = setInterval(() => {
    runRmsCheck().catch((err) =>
      logger.error(`[RMS] Check crashed: ${err.message}`),
    );
  }, RMS_CHECK_INTERVAL_MS);

  logger.info(
    `[RMS] Started — checking every ${RMS_CHECK_INTERVAL_MS}ms, ` +
      `force-close threshold ${(MAINTENANCE_THRESHOLD * 100).toFixed(0)}% of blocked margin`,
  );
}

function stopRms() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startRms,
  stopRms,
  runRmsCheck,
  MAINTENANCE_THRESHOLD,
  RMS_CHECK_INTERVAL_MS,
};
