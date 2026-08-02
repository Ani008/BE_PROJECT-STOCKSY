// workers/orderWorker.js — top of file
require("dotenv").config({ quiet: true });   // 1. load env vars FIRST
require("../utils/devLogger");                 // 2. THEN apply the guard
const { getQueue } = require("../services/queueService");
// ...rest unchanged

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
      const { orderId, symbol, side, quantity } = job.data;
      console.log("[WORKER RECEIVED]", job.id, job.data);

      logger.info(
        `Processing job ${job.id} | ${side} ${quantity} ${symbol} | order=${orderId}`,
      );

      try {
        // Execute order
        const result = await executeOrder(job.data);

        // ─────────────────────────────────────────────────────
        // LIMIT / SL orders remain OPEN
        // Requeue for next tick
        // ─────────────────────────────────────────────────────

        if (result?.status === "OPEN") {
          logger.debug(`Requeueing OPEN order ${orderId}`);

          await queue.add(
            "fill",

            job.data,

            {
              delay: LIMIT_ORDER_CHECK_INTERVAL_MS,

              attempts: 3,

              // Unique retry ID
              jobId: `retry:${orderId}:${Date.now()}`,
            },
          );

          return {
            status: "REQUEUED",
          };
        }

        logger.info(`Order completed ${orderId}`);

        return result;
      } catch (err) {
        // ─────────────────────────────────────────────────────
        // Market data temporarily unavailable
        // Let Bull retry automatically
        // ─────────────────────────────────────────────────────

        if (err.message === "NO_LTP") {
          logger.warn(
            `No LTP for ${symbol} | retry attempt ${job.attemptsMade + 1}`,
          );

          throw err;
        }

        // ─────────────────────────────────────────────────────
        // Other execution errors
        // ─────────────────────────────────────────────────────

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