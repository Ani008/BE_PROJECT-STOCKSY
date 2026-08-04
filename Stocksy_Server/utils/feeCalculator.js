/**
 * utils/feeCalculator.js
 *
 * Single source of truth for the FULL realistic charge breakdown on a
 * trade fill — brokerage + every statutory pass-through (STT, exchange
 * transaction charges, SEBI turnover fee, stamp duty, GST).
 *
 * This intentionally mirrors src/components/ChargesBreakDownModel.js
 * (frontend) line-for-line, so what the user is shown pre-trade and
 * what actually gets recorded post-fill never drift apart. If you
 * change a rate here, change it there too (or better — have the
 * frontend eventually just call an API that uses this module).
 *
 * IMPORTANT — this only CALCULATES the breakdown. It does not decide
 * what the wallet is debited for. See executionEngine.js: today only
 * `brokerage` is debited from the wallet (existing product decision,
 * matches the "not wired into wallet debits" note in the charges
 * sheet). This module exists so the full breakdown can be *persisted*
 * for a realistic revenue/charges picture even while that debit
 * decision is unchanged. If you decide to start debiting the full
 * total from the wallet too, that's a separate, deliberate change —
 * do it in orderService.js's margin check + executionEngine.js's
 * settlement math, not silently here.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * @param {number} tradeValue  quantity * fill price (turnover for this fill)
 * @param {"BUY"|"SELL"} side
 * @param {"CNC"|"MIS"} productType  CNC = Delivery, MIS = Intraday
 */
function calculateCharges(tradeValue, side, productType) {
  const value = tradeValue > 0 ? tradeValue : 0;

  // Brokerage — lower of ₹20 or 0.1% of trade value, floored at ₹5.
  // Matches Groww's published equity rate and observed real floor exactly.
  const brokerage = value > 0 ? Math.max(5, Math.min(20, value * 0.001)) : 0;

  // STT — Delivery: 0.1% both legs. Intraday: 0.025% on the sell leg only.
  const stt =
    productType === 'CNC'
      ? value * 0.001
      : side === 'SELL'
      ? value * 0.00025
      : 0;

  // Exchange transaction charges (NSE equity, approx.)
  const exchangeTxnCharge = value * 0.0000297;

  // SEBI turnover fee — ₹10 per crore
  const sebiCharges = value * 0.0000010;

  // Stamp duty — buyer-side only, 0.015%
  const stampDuty = side === 'BUY' ? value * 0.00015 : 0;

  // GST — 18% on (brokerage + exchange transaction charges)
  const gst = (brokerage + exchangeTxnCharge) * 0.18;

  const totalCharges = brokerage + stt + exchangeTxnCharge + sebiCharges + stampDuty + gst;

  return {
    brokerage: round4(brokerage),
    stt: round4(stt),
    exchangeTxnCharge: round4(exchangeTxnCharge),
    sebiCharges: round4(sebiCharges),
    stampDuty: round4(stampDuty),
    gst: round4(gst),
    totalCharges: round2(totalCharges),
  };
}

module.exports = { calculateCharges };