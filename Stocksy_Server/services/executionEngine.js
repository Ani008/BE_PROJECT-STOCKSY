/**
 * services/executionEngine.js
 * Production-grade paper trading execution engine
 *
 * Merged version:
 * - Advanced execution logic from OLD file
 * - Better rejection handling from NEW file
 * - Better limit/SL execution flow from OLD
 * - Better wallet settlement + trade handling
 * - Redis live pricing
 * - Real-time websocket notifications
 * - Atomic PostgreSQL transactions
 */

const { pool } = require("../config/postgres");

const redisClient = require("./redisService");
const { invalidateTransactionsCache } = require("../utils/transactionsCache");

const {
  applySlippage,
  calcBrokerage,
  getLivePrice,
} = require("./orderService");

const { notifyClient } = require("./websocketService");
const { getLeverage } = require("../config/leverage");

const logger = require("../utils/logger");

// ─────────────────────────────────────────────────────────────
// Execute Order
// ─────────────────────────────────────────────────────────────

async function executeOrder(jobData) {
  const {
    orderId,
    userId,
    walletId,
    instrumentKey,
    symbol,
    orderType,
    side,
    quantity,
    price,
    triggerPrice,
    marginUsed,
    productType = "CNC",
    leverageApplied = 1,
  } = jobData;

  // ───────────────────────────────────────────────────────────
  // 1. Fetch Live Market Price
  // ───────────────────────────────────────────────────────────
  console.log("[EXECUTION START]", orderId);
  const ltp = await getLivePrice(instrumentKey);

  if (!ltp) {
    logger.warn(`No LTP available for ${instrumentKey}`);

    throw new Error("NO_LTP");
  }
  console.log("[LTP]", instrumentKey, ltp);

  // ───────────────────────────────────────────────────────────
  // 2. Order Eligibility Check
  // ───────────────────────────────────────────────────────────

  let canFill = false;

  let fillPrice = 0;

  switch (orderType) {
    case "MARKET":
      canFill = true;

      fillPrice = applySlippage(ltp, side);

      break;

    case "LIMIT":
      if (side === "BUY") {
        canFill = ltp <= price;
      }

      if (side === "SELL") {
        canFill = ltp >= price;
      }

      fillPrice = parseFloat(price);

      break;

    case "SL":
      if (side === "BUY") {
        canFill = ltp >= triggerPrice && ltp <= price;
      }

      if (side === "SELL") {
        canFill = ltp <= triggerPrice && ltp >= price;
      }

      fillPrice = parseFloat(price);

      break;

    case "SL_M":
      if (side === "BUY") {
        canFill = ltp >= triggerPrice;
      }

      if (side === "SELL") {
        canFill = ltp <= triggerPrice;
      }

      fillPrice = applySlippage(ltp, side);

      break;
  }

  // ───────────────────────────────────────────────────────────
  // Order remains OPEN
  // ───────────────────────────────────────────────────────────

  if (!canFill) {
    await pool.query(
      `
      UPDATE orders
      SET status = 'OPEN'
      WHERE id = $1
      AND status = 'PENDING'
      `,
      [orderId],
    );

    return {
      status: "OPEN",
      reason: "Price condition not met",
      ltp,
      fillPrice,
    };
  }

  // ───────────────────────────────────────────────────────────
  // 3. Trade Calculations
  // ───────────────────────────────────────────────────────────

  fillPrice = parseFloat(fillPrice.toFixed(4));

  const qty = parseFloat(quantity);

  const tradeValue = fillPrice * qty;

  const brokerage = calcBrokerage(tradeValue);

  const totalCost =
    side === "BUY" ? tradeValue + brokerage : tradeValue - brokerage;

  // ───────────────────────────────────────────────────────────
  // 4. Begin Transaction
  // ───────────────────────────────────────────────────────────

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock order row
    const {
      rows: [order],
    } = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
      [orderId],
    );

    if (!order) {
      throw new Error("Order not found");
    }

    if (!["PENDING", "OPEN"].includes(order.status)) {
      logger.warn(`Order ${orderId} already ${order.status}`);

      await client.query("ROLLBACK");

      return {
        status: order.status,
      };
    }

    // ─────────────────────────────────────────────────────────
    // 5. Mark FILLED
    // ─────────────────────────────────────────────────────────

    await client.query(
      `
      UPDATE orders
      SET
        status = 'FILLED',
        filled_qty = $1,
        avg_fill_price = $2,
        total_value = $3,
        filled_at = NOW()
      WHERE id = $4
      `,
      [qty, fillPrice, tradeValue, orderId],
    );

    // ─────────────────────────────────────────────────────────
    // 6. Position Handling
    // ─────────────────────────────────────────────────────────

    console.log("[CREATING POSITION]", symbol, qty);
    let realisedPnl = 0;

    let positionId = null;

    // Real wallet impact of this fill — margin debited (BUY) or margin +
    // P&L credited (SELL). For CNC (leverage=1) this equals the full
    // trade value, same as before. For MIS/leveraged trades it's the
    // actual cash that moved, which is what the transaction ledger and
    // the transactions screen should show — not the full stock value.
    let walletDelta = 0;

    // ─────────────────────────────────────────────────────────
    // BUY
    // ─────────────────────────────────────────────────────────

    if (side === "BUY") {
      const {
        rows: [pos],
      } = await client.query(
        `
          INSERT INTO positions
          (
            user_id,
            wallet_id,
            instrument_key,
            symbol,
            name,
            quantity,
            avg_cost,
            product_type
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8
          )

          ON CONFLICT
          (wallet_id, instrument_key, product_type)

          DO UPDATE SET

            quantity =
              positions.quantity +
              EXCLUDED.quantity,

            avg_cost =
              (
                positions.quantity *
                positions.avg_cost

                +

                EXCLUDED.quantity *
                EXCLUDED.avg_cost
              )
              /
              (
                positions.quantity +
                EXCLUDED.quantity
              ),

            updated_at = NOW()

          RETURNING id
          `,
        [
          userId,
          walletId,
          instrumentKey,
          symbol,
          order.name || symbol,
          qty,
          fillPrice,
          productType,
        ],
      );

      positionId = pos.id;

      // Margin adjustment — recompute what the margin SHOULD be at the
      // actual fill price (using the same leverage the order was placed
      // with), and refund/charge only the difference from what was
      // reserved at placement time. This is leverage-aware: for CNC
      // (leverage=1) this reduces to the original `marginUsed - totalCost`
      // behavior exactly. For MIS it correctly keeps only the margin
      // portion reserved instead of settling the full trade value.
      const actualMarginRequired =
        (tradeValue / leverageApplied) + brokerage;

      walletDelta = actualMarginRequired;

      const refund = parseFloat(marginUsed) - actualMarginRequired;

      if (refund !== 0) {
        await client.query(
          `
          UPDATE wallets
          SET
            balance = balance + $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [refund, walletId],
        );
      }

    }
    

    // ─────────────────────────────────────────────────────────
    // SELL
    // ─────────────────────────────────────────────────────────
    else {
      const {
        rows: [pos],
      } = await client.query(
        `
          SELECT *
          FROM positions
          WHERE wallet_id = $1
          AND instrument_key = $2
          AND product_type = $3
          FOR UPDATE
          `,
        [walletId, instrumentKey, productType],
      );

      if (!pos) {
        await rejectOrderClient(
          client,
          order,
          `No ${productType} position available for ${symbol}`,
        );

        await client.query("COMMIT");

        return;
      }

      const avgCost = parseFloat(pos.avg_cost);

      const oldQty = parseFloat(pos.quantity);

      if (qty > oldQty) {
        await rejectOrderClient(client, order, `Insufficient quantity`);

        await client.query("COMMIT");

        return;
      }

      realisedPnl = (fillPrice - avgCost) * qty - brokerage;

      // Credit = margin portion being released + realised P&L —
      // NOT the full sale value. For CNC (leverage=1) this collapses
      // to exactly the old `totalCost` behavior (full value back).
      // For MIS, only the margin actually reserved at buy time gets
      // released, plus/minus whatever was won or lost — crediting
      // full sale value here would hand back money that was never
      // taken from the wallet in the first place.
      const positionLeverage = getLeverage(symbol, productType);
      const marginToRelease = (avgCost * qty) / positionLeverage;
      const walletCredit = marginToRelease + realisedPnl;

      walletDelta = walletCredit;

      const newQty = oldQty - qty;

      if (newQty <= 0) {
        await client.query(
          `
          UPDATE positions
          SET
            quantity = 0,
            avg_cost = 0,
            realised_pnl =
              realised_pnl + $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [realisedPnl, pos.id],
        );
      } else {
        await client.query(
          `
          UPDATE positions
          SET
            quantity = $1,
            realised_pnl =
              realised_pnl + $2,
            updated_at = NOW()
          WHERE id = $3
          `,
          [newQty, realisedPnl, pos.id],
        );
      }

      positionId = pos.id;

      // Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET
          balance = balance + $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [walletCredit, walletId],
      );
    }

    // ─────────────────────────────────────────────────────────
    // 7. Trade Record
    // ─────────────────────────────────────────────────────────

    const {
      rows: [insertedTrade],
    } = await client.query(
      `
      INSERT INTO trades
      (
        order_id,
        position_id,
        user_id,
        wallet_id,
        instrument_key,
        symbol,
        side,
        quantity,
        price,
        brokerage,
        total_value,
        realised_pnl,
        executed_at
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,
        $12,NOW()
      )
      RETURNING id
      `,
      [
        orderId,
        positionId,
        userId,
        walletId,
        instrumentKey,
        symbol,
        side,
        qty,
        fillPrice,
        brokerage,
        tradeValue,
        side === "SELL" ? realisedPnl : null,
      ],
    );

    // ─────────────────────────────────────────────────────────
    // 7b. Platform Revenue Ledger
    // ─────────────────────────────────────────────────────────
    // The brokerage line above is the ONLY thing Stocksy actually earns
    // on this trade — STT, exchange charges, SEBI charges, stamp duty
    // and GST (shown to the user on the charges breakdown sheet) are all
    // statutory pass-throughs to the government/exchange/regulator, not
    // platform revenue, so they are deliberately NOT recorded here.
    // Written in the same transaction as the trade so revenue and
    // trades can never drift out of sync.

    await client.query(
      `
      INSERT INTO platform_revenue
      (
        trade_id,
        order_id,
        user_id,
        wallet_id,
        instrument_key,
        symbol,
        side,
        product_type,
        trade_value,
        brokerage_amount,
        earned_at
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,NOW()
      )
      `,
      [
        insertedTrade.id,
        orderId,
        userId,
        walletId,
        instrumentKey,
        symbol,
        side,
        productType,
        tradeValue,
        brokerage,
      ],
    );

    // ─────────────────────────────────────────────────────────
    // 8. Wallet Ledger Entry
    // ─────────────────────────────────────────────────────────

    const {
      rows: [walletAfter],
    } = await client.query(
      `
      SELECT balance
      FROM wallets
      WHERE id = $1
      `,
      [walletId],
    );

    await client.query(
      `
      INSERT INTO wallet_transactions
      (
        wallet_id,
        type,
        amount,
        balance_after,
        ref_order_id,
        note
      )
      VALUES
      (
        $1,
        'order_fill',
        $2,
        $3,
        $4,
        $5
      )
      `,
      [
        walletId,
        Math.abs(walletDelta),
        walletAfter.balance,
        orderId,
        `${side} ${qty} ${symbol} @ ₹${fillPrice.toFixed(2)}`,
      ],
    );

    // ─────────────────────────────────────────────────────────
    // 9. Order Event
    // ─────────────────────────────────────────────────────────

    await client.query(
      `
      INSERT INTO order_events
      (
        order_id,
        event,
        payload
      )
      VALUES
      (
        $1,
        'FILLED',
        $2
      )
      `,
      [
        orderId,

        JSON.stringify({
          fillPrice,
          quantity: qty,
          tradeValue,
          brokerage,
          realisedPnl,
          ltp,
        }),
      ],
    );

    await client.query("COMMIT");

    // Transaction is durably committed now — safe to drop the stale
    // cached feed so the next read picks up this new stock_buy/stock_sell row.
    await invalidateTransactionsCache(userId);

    // ─────────────────────────────────────────────────────────
    // 10. Redis Cache
    // ─────────────────────────────────────────────────────────

    const pnlKey = `pnl:${userId}:${walletId}:${instrumentKey}`;

    await redisClient.setEx(
      pnlKey,
      300,
      JSON.stringify({
        symbol,
        realisedPnl,
        fillPrice,
        side,
        quantity: qty,
        ts: Date.now(),
      }),
    );

    // ─────────────────────────────────────────────────────────
    // 11. Websocket Notify
    // ─────────────────────────────────────────────────────────

    notifyClient(userId, {
      type: "ORDER_FILLED",
      orderId,
      symbol,
      side,
      quantity: qty,
      fillPrice: parseFloat(fillPrice.toFixed(2)),
      tradeValue: parseFloat(tradeValue.toFixed(2)),
      brokerage: parseFloat(brokerage.toFixed(4)),
      realisedPnl: side === "SELL" ? parseFloat(realisedPnl.toFixed(2)) : null,
      walletBalance: parseFloat(walletAfter.balance),
      ts: Date.now(),
    });

    logger.info(
      `Order FILLED: ${orderId} ${side} ${qty} ${symbol} @ ₹${fillPrice}`,
    );

    return {
      status: "FILLED",
      fillPrice,
      tradeValue,
      realisedPnl,
    };
  } catch (err) {
    await client.query("ROLLBACK");

    logger.error(`Execution failed for ${orderId}: ${err.message}`);

    await rejectOrder(orderId, walletId, userId, side, marginUsed, err.message);

    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Reject Order
// ─────────────────────────────────────────────────────────────

async function rejectOrder(
  orderId,
  walletId,
  userId,
  side,
  marginUsed,
  reason,
) {
  try {
    await pool.query(
      `
      UPDATE orders
      SET
        status = 'REJECTED',
        rejection_reason = $1
      WHERE id = $2
      `,
      [reason, orderId],
    );

    await pool.query(
      `
      INSERT INTO order_events
      (
        order_id,
        event,
        payload
      )
      VALUES
      (
        $1,
        'REJECTED',
        $2
      )
      `,
      [orderId, JSON.stringify({ reason })],
    );

    // Refund reserved margin
    if (side === "BUY" && parseFloat(marginUsed) > 0) {
      await pool.query(
        `
        UPDATE wallets
        SET
          balance = balance + $1
        WHERE id = $2
        `,
        [marginUsed, walletId],
      );
    }

    notifyClient(userId, {
      type: "ORDER_REJECTED",
      orderId,
      reason,
    });
  } catch (e) {
    logger.error(`rejectOrder failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Reject Order Inside Existing Transaction
// ─────────────────────────────────────────────────────────────

async function rejectOrderClient(client, order, reason) {
  await client.query(
    `
    UPDATE orders
    SET
      status = 'REJECTED',
      rejection_reason = $1
    WHERE id = $2
    `,
    [reason, order.id],
  );

  await client.query(
    `
    INSERT INTO order_events
    (
      order_id,
      event,
      payload
    )
    VALUES
    (
      $1,
      'REJECTED',
      $2
    )
    `,
    [order.id, JSON.stringify({ reason })],
  );

  if (order.side === "BUY" && parseFloat(order.margin_used) > 0) {
    await client.query(
      `
      UPDATE wallets
      SET
        balance = balance + $1
      WHERE id = $2
      `,
      [order.margin_used, order.wallet_id],
    );
  }

  notifyClient(order.user_id, {
    type: "ORDER_REJECTED",
    orderId: order.id,
    reason,
  });
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  executeOrder,
};