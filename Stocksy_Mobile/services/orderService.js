import api from "./api";

export async function placeOrder(payload) {
  const response = await api.post("/orders", payload);
  return response.data;
}

/**
 * Cancel an OPEN/PENDING order (e.g. a resting stop-loss). Cancelling a
 * FILLED order is a no-op on the backend — this is only meaningful for
 * orders that haven't triggered/filled yet.
 * DELETE /api/orders/:id
 */
export async function cancelOrder(orderId) {
  const response = await api.delete(`/orders/${orderId}`);
  return response.data;
}

/**
 * Fetch the logged-in user's open positions and wallet balances.
 * GET /api/orders/portfolio
 * Returns: { positions: Array, wallets: Array }
 */
export async function fetchPortfolio() {
  const response = await api.get("/portfolio");
  return response.data;
}

/**
 * Fetch every order the user has ever placed (not just fills/transactions),
 * newest first. Backs the Profile > Orders screen, and — filtered to
 * status='OPEN' — the "which of my positions have a stop-loss set" lookup
 * on the Positions tab.
 * GET /api/orders
 * Each row includes `product_type`: 'CNC' (delivery) | 'MIS' (intraday) —
 * same split used for Delivery/Intraday on the Dashboard's asset card.
 *
 * @param {number} [limit=100]
 * @param {object} [opts]
 * @param {'OPEN'|'PENDING'|'FILLED'|'CANCELLED'|'REJECTED'} [opts.status]
 */
export async function fetchOrders(limit = 100, { status } = {}) {
  const response = await api.get("/orders", {
    params: { limit, ...(status ? { status } : {}) },
  });
  return response.data.orders;
}