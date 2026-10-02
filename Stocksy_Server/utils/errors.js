// utils/errors.js
class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}
class InsufficientFundsError extends Error {
  constructor(message) { super(message); this.name = 'InsufficientFundsError'; }
}
class MarketClosedError extends Error {
  /**
   * @param {string} [message] defaults to a message built from nextOpen if provided
   * @param {{isoDate:string,time:string,iso:string,dateLabel:string,timeLabel:string}} [nextOpen]
   * @param {{type:string,label:string}} [reason]
   */
  constructor(message, nextOpen = null, reason = null) {
    super(
      message ||
        (nextOpen
          ? `Market is closed. Orders will be executed when market opens on ${nextOpen.dateLabel} at ${nextOpen.timeLabel}.`
          : 'Market is currently closed')
    );
    this.name = 'MarketClosedError';
    this.nextOpen = nextOpen;
    this.reason = reason;
  }
}
class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; }
}
class UnauthorizedError extends Error {
  constructor(message) { super(message || 'Not authorized'); this.name = 'UnauthorizedError'; }
}
class ForbiddenError extends Error {
  constructor(message) { super(message || 'Forbidden'); this.name = 'ForbiddenError'; }
}
class SessionExpiredError extends Error {
  constructor() { super('Your session has expired'); this.name = 'SessionExpiredError'; }
}

/**
 * Central mapping from a thrown error → the standard API error contract:
 *   { message, code, severity }
 *
 * Every controller should route its catch block through this instead of
 * hand-writing res.status(...).json({ message: error.message }) — that
 * pattern leaks raw internal error text (Postgres constraint names, stack
 * fragments) straight to the client, and gives the frontend nothing
 * machine-readable to branch on besides parsing English sentences.
 *
 * Unknown/unclassified errors deliberately do NOT forward error.message
 * to the client — only the safe generic text. The real message still goes
 * to the server log via the caller, for debugging.
 */
function mapErrorToResponse(err) {
  if (err instanceof ValidationError)
    return { status: 400, body: { message: err.message, code: 'VALIDATION_ERROR', severity: 'error' } };

  if (err instanceof InsufficientFundsError)
    return { status: 422, body: { message: err.message, code: 'INSUFFICIENT_FUNDS', severity: 'error' } };

  if (err instanceof MarketClosedError)
    return {
      status: 422,
      body: {
        message: err.message,
        code: 'MARKET_CLOSED',
        severity: 'warning',
        reason: err.reason || null,
        nextOpen: err.nextOpen || null, // { isoDate, time, iso, dateLabel, timeLabel }
      },
    };

  if (err instanceof NotFoundError)
    return { status: 404, body: { message: err.message, code: 'NOT_FOUND', severity: 'error' } };

  if (err instanceof UnauthorizedError)
    return { status: 401, body: { message: err.message, code: 'UNAUTHORIZED', severity: 'error' } };

  if (err instanceof ForbiddenError)
    return { status: 403, body: { message: err.message, code: 'FORBIDDEN', severity: 'error' } };

  if (err instanceof SessionExpiredError)
    return { status: 401, body: { message: err.message, code: 'SESSION_EXPIRED', severity: 'error' } };

  // Unclassified — never forward err.message to the client here.
  return { status: 500, body: { message: 'Something went wrong. Please try again.', code: 'UNKNOWN_ERROR', severity: 'error' } };
}

/**
 * Drop-in replacement for the old `catch (err) { res.status(500).json(...) }`
 * pattern. Logs the real error server-side, sends the safe mapped response
 * to the client.
 */
function sendError(res, err, logger) {
  const { status, body } = mapErrorToResponse(err);
  if (logger) {
    logger.error(`[${body.code}] ${err.message}`);
  }
  return res.status(status).json(body);
}

module.exports = {
  ValidationError,
  InsufficientFundsError,
  MarketClosedError,
  NotFoundError,
  UnauthorizedError,
  SessionExpiredError,
  ForbiddenError,
  mapErrorToResponse,
  sendError,
};