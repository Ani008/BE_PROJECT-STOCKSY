import api from "./api";

// ── Create ───────────────────────────────────────────────────────────────────
export const createAlert = async ({
  instrumentKey,
  symbol,
  name,
  targetPrice,
  action = "NOTIFY",
  quantity,
  walletId,
}) => {
  const response = await api.post("/alerts", {
    instrument_key: instrumentKey,
    symbol,
    name,
    target_price: targetPrice,
    action,
    quantity,
    wallet_id: walletId,
  });
  return response.data;
};

// ── List ─────────────────────────────────────────────────────────────────────
export const getAlerts = async () => {
  const response = await api.get("/alerts");
  return response.data.alerts;
};

// ── Cancel ───────────────────────────────────────────────────────────────────
export const cancelAlert = async (alertId) => {
  const response = await api.delete(`/alerts/${alertId}`);
  return response.data;
};

const alertService = { createAlert, getAlerts, cancelAlert };
export default alertService;