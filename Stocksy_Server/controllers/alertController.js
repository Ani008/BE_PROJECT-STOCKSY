const {
  createAlert,
  getAlertsByUser,
  cancelAlert,
} = require("../repositories/alertRepository");
const { getWalletsByUserId } = require("../repositories/walletRepository");
const { getLivePrice } = require("../services/orderService");
const sendAlertCreatedEmail = require("../utils/sendAlertCreatedEmail");
const { ValidationError, NotFoundError, sendError } = require("../utils/errors");
const logger = require("../utils/logger");

const VALID_ACTIONS = ["NOTIFY", "BUY", "SELL"];

// ── POST /api/alerts ──────────────────────────────────────────────────────────
async function createAlertHandler(req, res) {
  try {
    const userId = req.user.id;
    const {
      instrument_key,
      symbol,
      name,
      target_price,
      action = "NOTIFY",
      quantity,
      wallet_id,
    } = req.body;

    if (!instrument_key || !symbol || !target_price) {
      throw new ValidationError(
        "instrument_key, symbol and target_price are required",
      );
    }

    if (!VALID_ACTIONS.includes(action)) {
      throw new ValidationError("action must be NOTIFY, BUY or SELL");
    }

    const targetPrice = Number(target_price);
    if (!(targetPrice > 0)) {
      throw new ValidationError("target_price must be a positive number");
    }

    // BUY/SELL alerts place a real order once triggered — same extra
    // inputs a manual order needs, gathered up front instead of at
    // trigger time.
    let quantityNum = null;
    let productType = null;

    if (action !== "NOTIFY") {
      quantityNum = Number(quantity);
      if (!quantityNum || quantityNum <= 0) {
        throw new ValidationError("quantity is required for a Buy/Sell alert");
      }

      if (!wallet_id) {
        throw new ValidationError("wallet_id is required for a Buy/Sell alert");
      }

      const wallets = await getWalletsByUserId(userId);
      const ownsWallet = wallets.some((w) => w.id === wallet_id);
      if (!ownsWallet) {
        throw new ValidationError("Wallet not found or does not belong to you");
      }

      // GTT auto-orders are CNC (Delivery) only — a trigger can sit for
      // days/weeks, which doesn't fit MIS's same-day square-off rule.
      productType = "CNC";
    }

    const ltp = await getLivePrice(instrument_key);
    if (ltp == null) {
      throw new ValidationError(
        "Live price unavailable for this instrument right now — please try again in a moment.",
      );
    }

    if (targetPrice === ltp) {
      throw new ValidationError(
        "Target price matches the current price — pick a price above or below the current one.",
      );
    }

    // Direction is inferred from where the target sits relative to the
    // live price right now — the person only ever enters one number,
    // same UX Zerodha/Groww use for a simple (non-GTT) alert, extended
    // here to also decide when a GTT buy/sell should fire.
    const direction = targetPrice > ltp ? "ABOVE" : "BELOW";

    const alert = await createAlert({
      userId,
      instrumentKey: instrument_key,
      symbol,
      name: name || symbol,
      targetPrice,
      direction,
      action,
      quantity: quantityNum,
      walletId: action !== "NOTIFY" ? wallet_id : null,
      productType,
    });

    // Confirmation email — best-effort, same for NOTIFY and GTT alerts.
    sendAlertCreatedEmail({
      email: req.user.email,
      name: req.user.full_name,
      symbol,
      targetPrice,
      direction,
      action,
      quantity: quantityNum,
    }).catch((err) => logger.error(`[ALERTS] Confirmation email failed: ${err.message}`));

    return res.status(201).json({
      message:
        action === "NOTIFY"
          ? "Price alert created. You'll get an email when it's triggered."
          : `${action === "BUY" ? "Buy" : "Sell"} GTT created. It'll place the order automatically once triggered.`,
      alert,
    });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/alerts ───────────────────────────────────────────────────────────
async function listAlertsHandler(req, res) {
  try {
    const alerts = await getAlertsByUser(req.user.id);
    return res.json({ alerts });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── DELETE /api/alerts/:id ────────────────────────────────────────────────────
async function cancelAlertHandler(req, res) {
  try {
    const cancelled = await cancelAlert({ alertId: req.params.id, userId: req.user.id });

    if (!cancelled) {
      throw new NotFoundError("Alert not found or already inactive");
    }

    return res.json({ message: "Alert cancelled", alert: cancelled });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = {
  createAlertHandler,
  listAlertsHandler,
  cancelAlertHandler,
};