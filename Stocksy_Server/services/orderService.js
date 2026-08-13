/**
 * services/orderService.js
 * Production-grade order service
 * Merged version:
 * - Clean architecture from NEW file
 * - Advanced trading logic from OLD file
 */

const { pool } = require('../config/postgres');
const redisClient = require('./redisService');
const { getQueue } = require('./queueService');
const { getLeverage } = require('../config/leverage');
const marketCalendar = require('./marketCalendarService');

const {
  ValidationError,
  InsufficientFundsError,
  MarketClosedError,
  NotFoundError
} = require('../utils/errors');

const logger = require('../utils/logger');
const { calculateCharges } = require('../utils/feeCalculator');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const VALID_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL_M'];
const VALID_SIDES = ['BUY', 'SELL'];
const VALID_PRODUCT_TYPES = ['CNC', 'MIS'];

const SLIPPAGE_BPS = 5; // 0.05%

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function applySlippage(ltp, side) {
  // QA/test-mode bypass: set DISABLE_SLIPPAGE=true to get deterministic
  // fills that match pinned Redis LTPs exactly (see test plan v2).
  // Leave unset/false in prod/staging so real slippage simulation stays on.
  if (process.env.DISABLE_SLIPPAGE === 'true') {
    return ltp;
  }

  const bps = (Math.random() * SLIPPAGE_BPS) / 10000;
  return side === 'BUY'
    ? ltp * (1 + bps)
    : ltp * (1 - bps);
}

function calcBrokerage(tradeValue) {
  const flat = 20;
  const floor = 5; // matches Groww's real floor exactly
  const pct = tradeValue * 0.001; // 0.1% — matches Groww's published equity rate
  return Math.max(floor, Math.min(flat, pct));
}

async function getLivePrice(instrumentKey) {
  try {
    const raw = await redisClient.get(`stock:${instrumentKey}`);

    if (!raw) return null;

    const data = JSON.parse(raw);

    return parseFloat(data?.ltpc?.ltp ?? 0);
  } catch {
    return null;
  }
}

// Market-hours check now lives in marketCalendarService — it's weekend
// AND NSE/BSE-holiday aware (config/marketHolidays.js), and also computes
// the next-open date/time so MarketClosedError can tell the user exactly
// when their order would actually go through. Kept out of this file so
// both orderService and the /api/market/status endpoint share one
// source of truth instead of drifting out of sync.

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

function validateOrderInput({
  instrument_key,
  symbol,
  order_type,
  side,
  quantity,
  price,
  trigger_price,
  product_type
}) {
  if (!instrument_key) {
    throw new ValidationError('instrument_key is required');
  }

  if (!symbol) {
    throw new ValidationError('symbol is required');
  }

  if (!VALID_TYPES.includes(order_type)) {
    throw new ValidationError(
      `order_type must be one of ${VALID_TYPES.join(', ')}`
    );
  }

  if (!VALID_SIDES.includes(side)) {
    throw new ValidationError('side must be BUY or SELL');
  }

  if (!VALID_PRODUCT_TYPES.includes(product_type)) {
    throw new ValidationError('product_type must be CNC or MIS');
  }

  if (!quantity || quantity <= 0) {
    throw new ValidationError('quantity must be > 0');
  }

  if (
    ['LIMIT', 'SL'].includes(order_type) &&
    (!price || price <= 0)
  ) {
    throw new ValidationError(
      'price required for LIMIT/SL orders'
    );
  }

  if (
    ['SL', 'SL_M'].includes(order_type) &&
    (!trigger_price || trigger_price <= 0)
  ) {
    throw new ValidationError(
      'trigger_price required for SL orders'
    );
  }

  // For SL (not SL_M), the limit price and trigger price must define a
  // non-empty fill range, or the order could NEVER fill:
  // BUY  canFill = ltp >= trigger && ltp <= price  → needs price >= trigger
  // SELL canFill = ltp <= trigger && ltp >= price  → needs price <= trigger
  if (order_type === 'SL' && price != null && trigger_price != null) {
    if (side === 'BUY' && price < trigger_price) {
      throw new ValidationError(
        'For a BUY SL order, limit price must be >= trigger price'
      );
    }
    if (side === 'SELL' && price > trigger_price) {
      throw new ValidationError(
        'For a SELL SL order, limit price must be <= trigger price'
      );
    }
  }
}

// Real-broker SL semantics (matches Zerodha/Groww validation):
//   BUY SL/SL_M  → used to buy on a breakout / cover a short → trigger
//                  price must be ABOVE the current market price.
//   SELL SL/SL_M → used to protect a long / short on a breakdown →
//                  trigger price must be BELOW the current market price.
// A trigger price on the wrong side of LTP would fill instantly (defeats
// the purpose of a stop) or never fill at all — reject it up front rather
// than silently accepting a broken order that sits OPEN forever or fires
// immediately like a MARKET order in disguise.
function validateTriggerDirection(order_type, side, trigger_price, ltp) {
  if (!['SL', 'SL_M'].includes(order_type) || !ltp) return;

  if (side === 'BUY' && trigger_price <= ltp) {
    throw new ValidationError(
      `Trigger price (₹${trigger_price}) must be above the current price (₹${ltp}) for a BUY ${order_type} order`
    );
  }

  if (side === 'SELL' && trigger_price >= ltp) {
    throw new ValidationError(
      `Trigger price (₹${trigger_price}) must be below the current price (₹${ltp}) for a SELL ${order_type} order`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Place Order
// ─────────────────────────────────────────────────────────────

async function placeOrder(userId, walletId, payload) {
  const {
    instrument_key,
    symbol,
    name = '',
    order_type,
    side,
    quantity,
    price = null,
    trigger_price = null,
    product_type = 'CNC',
    metadata = {}
  } = payload;

  // 1. Validate input
  validateOrderInput({
    instrument_key,
    symbol,
    order_type,
    side,
    quantity,
    price,
    trigger_price,
    product_type
  });

  // 2. Market hours check — weekend + NSE/BSE holiday aware
  if (!marketCalendar.isMarketOpen()) {
    const reason = marketCalendar.getClosedReason();
    const nextOpen = marketCalendar.getNextMarketOpen();
    throw new MarketClosedError(null, nextOpen, reason);
  }

  // 3. Get live market price
  const ltp = await getLivePrice(instrument_key);

  // 3b. SL/SL_M trigger price must sit on the correct side of the current
  // price — see validateTriggerDirection for why. Only checked when we
  // actually have a live price to check against; if Redis has no LTP yet
  // getLivePrice() already returns null and the order gets rejected a few
  // lines below by the "Could not determine live price" check instead.
  validateTriggerDirection(order_type, side, trigger_price, ltp);

  const estimatedPrice =
    order_type === 'MARKET'
      ? (ltp ?? price ?? 0)
      : (price ?? ltp ?? 0);

  if (!estimatedPrice || estimatedPrice <= 0) {
    throw new ValidationError(
      'Could not determine live price'
    );
  }

  // Apply slippage for market orders
  const effectivePrice =
    order_type === 'MARKET'
      ? applySlippage(estimatedPrice, side)
      : estimatedPrice;

  const estimatedValue = effectivePrice * quantity;

  const brokerage = calcBrokerage(estimatedValue);

  // Reserve against the FULL realistic charge (brokerage + STT + exchange
  // txn charge + SEBI charges + stamp duty + GST), not just brokerage —
  // otherwise the balance check below can pass on funds that turn out to
  // be insufficient once the real charges are deducted at fill time.
  const totalCharges = calculateCharges(estimatedValue, side, product_type).totalCharges;

  // CNC = 1x always. MIS = 5x for Nifty 50, 2.5x for everything else.
  const leverage = getLeverage(symbol, product_type);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 4. Lock wallet row
    const walletRes = await client.query(
      `
      SELECT id, balance
      FROM wallets
      WHERE id = $1
      AND user_id = $2
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!walletRes.rows.length) {
      throw new ValidationError(
        'Wallet not found or does not belong to you'
      );
    }

    const wallet = walletRes.rows[0];

    // 5. Lock existing position (if any) — needed to work out how much of
    // this order is "covering" an opposite existing position (needs no
    // fresh margin, just releases what's already reserved) vs "opening/
    // extending" a position in this order's own direction (needs margin).
    //
    // This is also what makes intraday short selling work: a SELL with no
    // (or insufficient) long MIS holdings doesn't get rejected anymore —
    // the uncovered portion opens/extends a short position instead, same
    // as Zerodha/Groww. CNC (delivery) is intentionally left long-only:
    // real brokers don't let you deliver shares you don't own, so a CNC
    // SELL still requires full existing holdings.
    const posRes = await client.query(
      `
      SELECT id, quantity
      FROM positions
      WHERE wallet_id = $1
      AND instrument_key = $2
      AND product_type = $3
      FOR UPDATE
      `,
      [walletId, instrument_key, product_type]
    );

    const existingQty = posRes.rows.length
      ? parseFloat(posRes.rows[0].quantity)
      : 0;

    // Link resting orders (SL/SL_M/LIMIT) to the position they're closing,
    // so executionEngine can auto-cancel this order if that position gets
    // closed some other way first (manual exit, RMS force-close, 3:20pm
    // square-off) — see migration 012 for the full reasoning. Only linked
    // when this order is actually on the CLOSING side of an existing
    // position (long + SELL, or short + BUY); an order that opens a fresh
    // position has no position row yet to link to.
    let linkedPositionId = null;
    if (
      ['SL', 'SL_M', 'LIMIT'].includes(order_type) &&
      posRes.rows.length &&
      (
        (existingQty > 0 && side === 'SELL') ||
        (existingQty < 0 && side === 'BUY')
      )
    ) {
      linkedPositionId = posRes.rows[0].id;
    }

    // openQty = the portion of this order NOT offset by an opposite
    // existing position — i.e. the part that opens or extends a position
    // in this order's own direction, and therefore needs margin reserved.
    let openQty = 0;

    if (side === 'BUY') {
      // existingQty < 0 means there's a short to cover first.
      const coverQty = existingQty < 0 ? Math.min(-existingQty, quantity) : 0;
      openQty = quantity - coverQty;
    } else {
      // SELL
      if (product_type === 'CNC') {
        if (existingQty < quantity) {
          throw new ValidationError(
            `Insufficient ${product_type} holdings for ${symbol}`
          );
        }
        openQty = 0; // CNC SELL only ever closes a long — never opens a short
      } else {
        // existingQty > 0 means there's a long to close first; anything
        // beyond that opens/extends a short.
        const closeQty = existingQty > 0 ? Math.min(existingQty, quantity) : 0;
        openQty = quantity - closeQty;
      }
    }

    const marginRequired =
      openQty > 0
        ? (openQty * effectivePrice / leverage) + totalCharges
        : 0;

    // 6. Balance check — applies to BUY (opening/extending a long) and now
    // also to SELL when it opens/extends a short (MIS only), since going
    // short is functionally the same margin commitment as going long.
    if (
      marginRequired > 0 &&
      parseFloat(wallet.balance) < marginRequired
    ) {
      throw new InsufficientFundsError(
        `Insufficient funds. Required ₹${marginRequired.toFixed(2)}, available ₹${parseFloat(wallet.balance).toFixed(2)}`
      );
    }

    // 7. Reserve margin
    if (marginRequired > 0) {
      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [marginRequired, walletId]
      );

      const updatedWallet = await client.query(
        `
        SELECT balance
        FROM wallets
        WHERE id = $1
        `,
        [walletId]
      );

      await client.query(
        `
        INSERT INTO wallet_transactions
        (
          wallet_id,
          type,
          amount,
          balance_after,
          note
        )
        VALUES ($1, 'order_reserve', $2, $3, $4)
        `,
        [
          walletId,
          marginRequired,
          updatedWallet.rows[0].balance,
          `Reserve for ${side} ${symbol}`
        ]
      );
    }

    // 8. Create order
    const orderRes = await client.query(
      `
      INSERT INTO orders
      (
        user_id,
        wallet_id,
        instrument_key,
        symbol,
        name,
        order_type,
        side,
        quantity,
        price,
        trigger_price,
        status,
        margin_used,
        product_type,
        leverage_applied,
        metadata,
        position_id
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        'PENDING',$11,$12,$13,$14,$15
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        instrument_key,
        symbol,
        name || symbol,
        order_type,
        side,
        quantity,
        price,
        trigger_price,
        marginRequired,
        product_type,
        leverage,
        JSON.stringify(metadata),
        linkedPositionId
      ]
    );

    const order = orderRes.rows[0];

    // 9. Audit log
    await client.query(
      `
      INSERT INTO order_events
      (
        order_id,
        event,
        payload
      )
      VALUES ($1, 'PLACED', $2)
      `,
      [
        order.id,
        JSON.stringify({
          userId,
          walletId,
          quantity,
          price,
          order_type,
          side,
          ltp,
          effectivePrice,
          brokerage,
          totalCharges,
          marginRequired
        })
      ]
    );

    await client.query('COMMIT');

    // 10. Queue order
    const queue = getQueue('orders');

    await queue.add(
      'fill',
      {
        orderId: order.id,
        userId,
        walletId,
        instrumentKey: instrument_key,
        symbol,
        orderType: order_type,
        side,
        quantity,
        price,
        triggerPrice: trigger_price,
        marginUsed: marginRequired,
        productType: product_type,
        leverageApplied: leverage
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 1000,
        removeOnFail: 500
      }
    );

    logger.info(
      `Order placed: ${order.id} ${side} ${quantity} ${symbol}`
    );

    return order;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Cancel Order
// ─────────────────────────────────────────────────────────────

async function cancelOrder(userId, orderId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
      `
      SELECT *
      FROM orders
      WHERE id = $1
      AND user_id = $2
      FOR UPDATE
      `,
      [orderId, userId]
    );

    if (!res.rows.length) {
      throw new NotFoundError('Order not found');
    }

    const order = res.rows[0];

    if (!['PENDING', 'OPEN'].includes(order.status)) {
      throw new ValidationError(
        `Cannot cancel order with status ${order.status}`
      );
    }

    // Partial release logic — BUY orders that open/extend a long AND SELL
    // orders that open/extend a short both reserve margin at placement now,
    // so both need the same unfilled-portion refund on cancel.
    if (parseFloat(order.margin_used) > 0) {
      const filledQty = parseFloat(order.filled_qty || 0);

      const unfilledQty =
        parseFloat(order.quantity) - filledQty;

      const releaseAmount =
        (unfilledQty / parseFloat(order.quantity)) *
        parseFloat(order.margin_used);

      if (releaseAmount > 0) {
        await client.query(
          `
          UPDATE wallets
          SET balance = balance + $1,
              updated_at = NOW()
          WHERE id = $2
          `,
          [releaseAmount, order.wallet_id]
        );

        const walletRes = await client.query(
          `
          SELECT balance
          FROM wallets
          WHERE id = $1
          `,
          [order.wallet_id]
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
            'order_release',
            $2,
            $3,
            $4,
            $5
          )
          `,
          [
            order.wallet_id,
            releaseAmount,
            walletRes.rows[0].balance,
            orderId,
            `Cancel release for ${order.symbol}`
          ]
        );
      }
    }

    // Cancel order
    await client.query(
      `
      UPDATE orders
      SET status = 'CANCELLED',
          cancelled_at = NOW()
      WHERE id = $1
      `,
      [orderId]
    );

    // Event log
    await client.query(
      `
      INSERT INTO order_events
      (
        order_id,
        event,
        payload
      )
      VALUES ($1, 'CANCELLED', '{}')
      `,
      [orderId]
    );

    await client.query('COMMIT');

    logger.info(`Order cancelled: ${orderId}`);

    return {
      success: true,
      orderId
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Get Orders
// ─────────────────────────────────────────────────────────────

async function getOrders(
  userId,
  {
    walletId,
    status,
    limit = 20,
    offset = 0
  } = {}
) {
  let query = `
    SELECT
      o.*,
      w.name AS wallet_name
    FROM orders o
    JOIN wallets w
      ON w.id = o.wallet_id
    WHERE o.user_id = $1
  `;

  const params = [userId];

  let idx = 2;

  if (walletId) {
    query += ` AND o.wallet_id = $${idx++}`;
    params.push(walletId);
  }

  if (status) {
    query += ` AND o.status = $${idx++}`;
    params.push(status);
  }

  query += `
    ORDER BY o.placed_at DESC
    LIMIT $${idx++}
    OFFSET $${idx++}
  `;

  params.push(limit, offset);

  const { rows } = await pool.query(query, params);

  return rows;
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  placeOrder,
  cancelOrder,
  getOrders,
  getLivePrice,
  applySlippage,
  calcBrokerage
};