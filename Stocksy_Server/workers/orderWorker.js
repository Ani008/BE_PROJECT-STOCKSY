// workers/orderWorker.js
require("dotenv").config({ quiet: true }); // 1. load env vars FIRST
require("../utils/devLogger"); // 2. THEN apply the guard

const { getQueue } = require("../services/queueService");
const { pool } = require("../config/postgres");
const { executeOrder } = require("../services/executionEngine");
const { scheduleSquareOff } = require("../services/squareOffService");
const { startRms } = require("../services/rmsService");
const logger = require("../utils/logger");

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const CONCURRENCY = parseInt(process.env.ORDER_WORKER_CONCURRENCY ?? "5");

const LIMIT_ORDER_CHECK_INTERVAL_MS = parseInt(
  process.env.LIMIT_ORDER_CHECK_INTERVAL_MS ?? "1000",
);

// Delay before retrying a resting order after an unexpected error
// (missing LTP, Redis blip, DB blip...). Slightly longer than the normal
// 1s poll so a persistent problem doesn't spam the logs.
const ERROR_RETRY_INTERVAL_MS = parseInt(
  process.env.RESTING_ORDER_ERROR_RETRY_MS ?? "2000",
);

// How often we cross-check the DB against the queue to rescue orphaned
// resting orders (order still OPEN in DB but no job left in the queue).
const RECONCILE_INTERVAL_MS = parseInt(
  process.env.RESTING_ORDER_RECONCILE_MS ?? "30000",
);

// Order types that sit in the book waiting for a price condition.
// These must NEVER be abandoned while their DB status is PENDING/OPEN.
const RESTING_TYPES = ["LIMIT", "SL", "SL_M"];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function requeue(queue, jobData, delay) {
  return queue.add("fill", jobData, {
    delay,
    attempts: 3,
    // Unique retry ID
    jobId: `retry:${jobData.orderId}:${Date.now()}`,
  });
}

// Is this order still waiting to be filled? Fails SAFE: if the DB check
// itself errors, we assume it's still live so a stop-loss is never dropped
// just because of a transient DB problem.
async function isOrderStillLive(orderId) {
  try {
    const { rows } = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId],
    );
    if (!rows.length) return false;
    return ["PENDING", "OPEN"].includes(rows[0].status);
  } catch (e) {
    logger.warn(`isOrderStillLive check failed for ${orderId}: ${e.message}`);
    return true;
  }
}

// Rebuild the exact job payload orderService.placeOrder() enqueues,
// from an orders row.
function jobDataFromRow(row) {
  return {
    orderId: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    instrumentKey: row.instrument_key,
    symbol: row.symbol,
    orderType: row.order_type,
    side: row.side,
    quantity: parseFloat(row.quantity),
    price: row.price != null ? parseFloat(row.price) : null,
    triggerPrice:
      row.trigger_price != null ? parseFloat(row.trigger_price) : null,
    marginUsed: parseFloat(row.margin_used || 0),
    productType: row.product_type,
    leverageApplied: parseFloat(row.leverage_applied || 1),
  };
}

// ─────────────────────────────────────────────────────────────
// Reconciler — self-healing safety net
// ─────────────────────────────────────────────────────────────
//
// The DB is the source of truth. If a resting order is PENDING/OPEN in
// the DB but has no job waiting/delayed/active in the queue, nothing is
// watching its trigger price any more — it will never fill. That can
// happen after a worker crash, a Redis flush, or a job that exhausted its
// retries. This finds such orders and re-queues them.
//
// An order must be missing on TWO consecutive passes before we rescue it,
// because between one poll finishing and the next being queued there is a
// brief moment where a healthy order has no job.

async function reconcileRestingOrders(queue, suspects) {
  const { rows } = await pool.query(
    `
    SELECT
      id, user_id, wallet_id, instrument_key, symbol, order_type, side,
      quantity, price, trigger_price, margin_used, product_type,
      leverage_applied
    FROM orders
    WHERE status IN ('PENDING', 'OPEN')
    AND order_type = ANY($1)
    `,
    [RESTING_TYPES],
  );

  if (!rows.length) {
    suspects.clear();
    return;
  }

  const [waiting, delayed, active] = await Promise.all([
    queue.getWaiting(),
    queue.getDelayed(),
    queue.getActive(),
  ]);

  const queued = new Set(
    [...waiting, ...delayed, ...active]
      .map((j) => j?.data?.orderId)
      .filter(Boolean),
  );

  const openIds = new Set(rows.map((r) => r.id));

  // Forget suspects that are no longer open
  for (const id of suspects.keys()) {
    if (!openIds.has(id)) suspects.delete(id);
  }

  for (const row of rows) {
    if (queued.has(row.id)) {
      suspects.delete(row.id);
      continue;
    }

    if (!suspects.has(row.id)) {
      // First time missing — might just be mid-requeue. Check again next pass.
      suspects.set(row.id, Date.now());
      continue;
    }

    // Missing on two consecutive passes → genuinely orphaned. Rescue it.
    suspects.delete(row.id);

    await requeue(queue, jobDataFromRow(row), 0);

    logger.warn(
      `[reconcile] Re-queued orphaned ${row.order_type} order ${row.id} (${row.side} ${row.symbol})`,
    );
  }
}

function startReconciler(queue) {
  const suspects = new Map();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileRestingOrders(queue, suspects);
    } catch (e) {
      logger.error(`[reconcile] failed: ${e.message}`);
    } finally {
      running = false;
    }
  };

  // First pass shortly after boot, then on an interval.
  setTimeout(tick, 5000);
  setInterval(tick, RECONCILE_INTERVAL_MS);
}

// ─────────────────────────────────────────────────────────────
// Start Worker
// ─────────────────────────────────────────────────────────────

function startOrderWorker() {
  // Create / fetch queue
  const queue = getQueue("orders");

  // ───────────────────────────────────────────────────────────
  // Process Jobs
  // ───────────────────────────────────────────────────────────

  queue.process(
    "fill",

    CONCURRENCY,

    async (job) => {
      const { orderId, symbol, side, quantity, orderType } = job.data;
      console.log("[WORKER RECEIVED]", job.id, job.data);

      logger.info(
        `Processing job ${job.id} | ${side} ${quantity} ${symbol} | order=${orderId}`,
      );

      const isResting = RESTING_TYPES.includes(orderType);

      try {
        // Execute order
        const result = await executeOrder(job.data);

        // ─────────────────────────────────────────────────────
        // LIMIT / SL orders remain OPEN
        // Requeue for next tick
        // ─────────────────────────────────────────────────────

        if (result?.status === "OPEN") {
          logger.debug(`Requeueing OPEN order ${orderId}`);

          await requeue(queue, job.data, LIMIT_ORDER_CHECK_INTERVAL_MS);

          return {
            status: "REQUEUED",
          };
        }

        logger.info(`Order completed ${orderId}`);

        return result;
      } catch (err) {
        // ─────────────────────────────────────────────────────
        // Resting orders (SL / SL_M / LIMIT) must survive errors.
        //
        // Previously any thrown error (most commonly NO_LTP, i.e. the
        // price wasn't readable for a moment) used Bull's 3-attempt
        // retry. After ~6s of failures the job was marked failed and
        // dropped — while the order stayed OPEN in the DB with nothing
        // watching it. That is a stop-loss that silently never fires.
        //
        // Now: if the order is still live in the DB, keep watching it.
        // If executeOrder already rejected/filled/cancelled it, let the
        // error propagate as before.
        // ─────────────────────────────────────────────────────

        if (isResting && (await isOrderStillLive(orderId))) {
          logger.warn(
            `Resting ${orderType} order ${orderId} (${symbol}) hit "${err.message}" — still live, retrying in ${ERROR_RETRY_INTERVAL_MS}ms`,
          );

          await requeue(queue, job.data, ERROR_RETRY_INTERVAL_MS);

          return {
            status: "REQUEUED_AFTER_ERROR",
          };
        }

        if (err.message === "NO_LTP") {
          logger.warn(
            `No LTP for ${symbol} | retry attempt ${job.attemptsMade + 1}`,
          );

          throw err;
        }

        logger.error(`Order execution failed [${orderId}] ${err.message}`);

        throw err;
      }
    },
  );

  // ───────────────────────────────────────────────────────────
  // Queue Event Hooks
  // ───────────────────────────────────────────────────────────

  queue.on("completed", (job) => {
    logger.debug(`Worker completed job ${job.id}`);
  });

  queue.on("failed", (job, err) => {
    logger.error(`Worker failed job ${job?.id}: ${err.message}`);
  });

  queue.on("stalled", (job) => {
    logger.warn(`Worker stalled job ${job?.id}`);
  });

  logger.info(`Order worker started | concurrency=${CONCURRENCY}`);

  // Rescue any resting order that lost its job (crash, Redis flush,
  // exhausted retries). Also runs once shortly after every restart.
  startReconciler(queue);

  // MIS positions get force-closed here too — same process, since
  // this is where all order execution already lives.
  scheduleSquareOff();

  // Continuous margin monitoring — force-closes a losing MIS position
  // the moment it eats too far into its own margin, instead of waiting
  // for the 3:20pm square-off cron. See services/rmsService.js.
  startRms();

  return queue;
}

// ─────────────────────────────────────────────────────────────
// Standalone Mode
// Allows:
// node workers/orderWorker.js
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  // Ensure DB initialized
  require("../config/postgres");

  // Ensure Redis initialized
  require("../services/redisService");

  startOrderWorker();

  logger.info("Order worker running as standalone process");
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  startOrderWorker,
};