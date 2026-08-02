// services/websocketService.js
//
// ══════════════════════════════════════════════════════════════════════════════
// ROOT CAUSE OF "prices not updating" BUG — READ THIS FIRST
// ══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM 1 — redisClient.keys('stock:*') is O(N) and BLOCKS Redis.
//   On every 1-second interval, calling KEYS scans ALL keys in the DB.
//   This is slow and can lag behind real data. Use a hardcoded key list instead.
//
// PROBLEM 2 — Individual redisClient.get() calls inside a loop are sequential.
//   47 instruments × 1 get() each = 47 round-trips to Redis Cloud before
//   you can send even one message. With cloud Redis latency (~20-50ms each),
//   that's 1-2 seconds just reading. By the time you send, data is already stale.
//   FIX: Use mGet() — one round-trip for all 47 keys simultaneously.
//
// PROBLEM 3 — If any single get() throws, the entire interval silently dies
//   because the error isn't caught at the interval level.
//
// PROBLEM 4 — The 1000ms push interval is measured from the START of the
//   previous interval, not from when it finishes. If Redis reads take 800ms,
//   you're effectively pushing every 1800ms, not 1000ms.
//
// ══════════════════════════════════════════════════════════════════════════════

const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { URL } = require("url");
const connectedClients = new Map();
const INSTRUMENTS = require("../config/instruments");

// ── Flexible import — handles all 3 common export shapes ────────────────────
// Shape A: module.exports = client          → require() returns client directly
// Shape B: module.exports = { redisClient } → named export
// Shape C: module.exports = { client }      → named export
const _redisImport = require("./redisService");
const redisClient =
  _redisImport.redisClient || // shape B
  _redisImport.client || // shape C
  _redisImport; // shape A (default export)

// All instrument keys — must match exactly what Python saves as stock:{key}
const INSTRUMENT_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
  "NSE_INDEX|Nifty Fin Service",
  "NSE_EQ|INE040A01034",
  "NSE_EQ|INE090A01021",
  "NSE_EQ|INE062A01020",
  "NSE_EQ|INE238A01034",
  "NSE_EQ|INE296A01032",
  "NSE_EQ|INE237A01036",
  "NSE_EQ|INE795G01014",
  "NSE_EQ|INE918I01026",
  "NSE_EQ|INE467B01029",
  "NSE_EQ|INE009A01021",
  "NSE_EQ|INE075A01022",
  "NSE_EQ|INE860A01027",
  "NSE_EQ|INE669C01036",
  "NSE_EQ|INE214T01019",
  "NSE_EQ|INE002A01018",
  "NSE_EQ|INE213A01029",
  "NSE_EQ|INE029A01011",
  "NSE_EQ|INE752E01010",
  "NSE_EQ|INE733E01010",
  "NSE_EQ|INE585B01010",
  "NSE_EQ|INE1TAE01010",
  "NSE_EQ|INE917I01010",
  "NSE_EQ|INE066A01021",
  "NSE_EQ|INE158A01026",
  "NSE_EQ|INE030A01027",
  "NSE_EQ|INE154A01025",
  "NSE_EQ|INE239A01024",
  "NSE_EQ|INE016A01026",
  "NSE_EQ|INE216A01030",
  "NSE_EQ|INE044A01036",
  "NSE_EQ|INE089A01031",
  "NSE_EQ|INE059A01026",
  "NSE_EQ|INE361B01024",
  "NSE_EQ|INE081A01020",
  "NSE_EQ|INE038A01020",
  "NSE_EQ|INE019A01038",
  "NSE_EQ|INE522F01014",
  "NSE_EQ|INE397D01024",
  "NSE_EQ|INE742F01042",
  "NSE_EQ|INE364U01010",
  "NSE_EQ|INE481G01011",
  "NSE_EQ|INE018A01030",
  "NSE_EQ|INE047A01021",
  "NSE_EQ|INE423A01024",
  "NSE_EQ|INE1NPP01017",

  "NSE_EQ|INE205A01025",
  "NSE_EQ|INE263A01024",
  "NSE_EQ|INE053F01010",
  "NSE_EQ|INE040H01021",
];

// Pre-build the Redis keys array once — no string building on every tick
const REDIS_KEYS = INSTRUMENT_KEYS.map((k) => `stock:${k}`);

// Push interval in ms
const PUSH_INTERVAL_MS = 800; // slightly under 1s so app always feels live

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server });
    console.log('WebSocket server ready');

    wss.on('connection', (ws, req) => {
        console.log('React Native client connected');

        // ── Identify the connection, if possible ──────────────────────────
        // The live-price feed itself is intentionally public (no auth
        // required just to watch prices) — but WITHOUT registering the
        // socket by userId here, notifyClient() has nothing to send to,
        // which silently breaks ORDER_FILLED / ORDER_REJECTED / RMS
        // square-off notifications. The frontend appends its JWT as
        // ?token=... on the WS URL (see useMarketData.js); if it's
        // missing or invalid we still serve the price feed, we just
        // can't push per-user notifications to this connection.
        let userId = null;
        try {
            const { searchParams } = new URL(req.url, 'http://localhost');
            const token = searchParams.get('token');
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                userId = String(decoded.id);
                connectedClients.set(userId, ws);
                console.log(`[WS] Registered client for user ${userId}`);
            }
        } catch (err) {
            console.log('[WS] Token missing/invalid — serving price feed only:', err.message);
        }

        const interval = setInterval(async () => {
            try {
                // ── ONE round trip for all stock prices ───────────────────────
                const values = await redisClient.mGet(REDIS_KEYS);

                // ── ONE round trip for all live indicators ────────────────────
                const liveKeys = INSTRUMENT_KEYS.map(k => `stock_live:${k}`);
                const liveValues = await redisClient.mGet(liveKeys);

                // ── ONE round trip for all timestamps ─────────────────────────
                const tsKeys = INSTRUMENT_KEYS.map(k => `stock_ts:${k}`);
                const tsValues = await redisClient.mGet(tsKeys);

                // Check if we have any data at all
                const hasData = values.some(v => v !== null);
                if (!hasData) {
                    ws.send(JSON.stringify({
                        error: 'No data in Redis. Run python websocket_client.py first.'
                    }));
                    return;
                }

                const stockData = {};

                INSTRUMENT_KEYS.forEach((instrumentKey, i) => {
                    const raw = values[i];
                    if (!raw) return; // instrument not yet in Redis, skip

                    const meta = INSTRUMENTS[instrumentKey];
                    const feedData = JSON.parse(raw);
                    const isLive = liveValues[i] !== null; // key exists = market open
                    const lastUpdated = tsValues[i] ? parseFloat(tsValues[i]) : null;

                    stockData[instrumentKey] = {
                        ...feedData,
                        symbol:      meta?.symbol  || instrumentKey,
                        name:        meta?.name    || instrumentKey,
                        sector:      meta?.sector  || 'Unknown',
                        isLive,
                        lastUpdated,
                    };
                });

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'MARKET_DATA',
                        timestamp: Date.now(),
                        data: stockData,
                    }));
                }

            } catch (err) {
                console.error('WebSocket interval error:', err);
            }
        }, PUSH_INTERVAL_MS);

        ws.on('close', () => {
            console.log('Client disconnected');
            clearInterval(interval);
            if (userId && connectedClients.get(userId) === ws) {
                connectedClients.delete(userId);
            }
        });

        ws.on('error', (err) => {
            console.error('WebSocket error:', err);
            clearInterval(interval);
            if (userId && connectedClients.get(userId) === ws) {
                connectedClients.delete(userId);
            }
        });
    });

    return wss;
}


function notifyClient(userId, payload) {
  const client = connectedClients.get(String(userId));

  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}
module.exports = {
  initWebSocket,
  notifyClient,
};
