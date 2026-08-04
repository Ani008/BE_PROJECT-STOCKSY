require("dotenv").config({ quiet: true }); // 1. load env vars FIRST
require("./utils/devLogger"); // 2. THEN apply the guard, now NODE_ENV is actually populated
const { connectRedis } = require("./config/redis");
connectRedis();

const express = require("express");
const cors = require("cors");
const http = require("http");
require("./config/postgres");
const { initWebSocket } = require("./services/websocketService");
const { scheduleAlertWatcher } = require("./services/alertWatcherService");
const { generalLimiter } = require("./middleware/rateLimiter");

const app = express();
app.set('trust proxy', 1); //for server production server 

const server = http.createServer(app);

//On Production use this cors policy - 
const allowedOrigins = [
  "https://api.stocksy.online", 
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); 
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
  }),
);

//app.use(cors()); // For development, allow all origins. In production, restrict to your frontend domain.
app.use(express.json({ limit: "5mb" }));

// Global rate-limit safety net — applied before routing so it protects
// every endpoint, including ones added later without remembering to
// rate-limit them individually. Sensitive routes (auth, OTP, orders) add
// their own tighter limiter on top of this one.
app.use(generalLimiter);

// 🔍 DEBUG: Log every incoming request so you can see if the server is even
//    receiving calls from the app. If you hit signup and see nothing here,
//    the problem is 100% the API_BASE_URL in your .env / api.js.
app.use((req, res, next) => {
  console.log(`\n📨 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log("   Headers:", JSON.stringify(req.headers, null, 2));
  if (Object.keys(req.body || {}).length) {
    console.log("   Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

const { client: redisClient } = require('./config/redis'); // adjust to however redis.js exports its client
const { pool } = require("./config/postgres"); // adjust to however postgres.js exports its pool

app.get("/health", async (req, res) => {
  const health = {
    status: "ok",
    redis: "unknown",
    postgres: "unknown",
    timestamp: new Date().toISOString(),
  };
  try {
    await redisClient.ping();
    health.redis = "ok";
  } catch (e) {
    health.redis = "down";
    health.status = "degraded";
  }
  try {
    await pool.query("SELECT 1");
    health.postgres = "ok";
  } catch (e) {
    health.postgres = "down";
    health.status = "degraded";
  }
  res.status(health.status === "ok" ? 200 : 503).json(health);
});
// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/auth/google", require("./routes/googleAuth"));
app.use("/api/auth/forgot-password", require("./routes/forgotPasswordRoutes"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/historical", require("./routes/historical"));
app.use("/api/fundamentals", require("./routes/fundamentals"));
app.use("/api/leverage", require("./routes/leverage"));
app.use("/api/market", require("./routes/market"));
app.use("/api/debug", require("./routes/debug"));
app.use("/api/revenue", require("./routes/revenue"));
app.use("/api", require("./routes/orders"));
app.use("/api/alerts", require("./routes/alerts"));

// ─── Health check — hit this first from the app to confirm connectivity ───────
// From the app: fetch('http://<YOUR_LAN_IP>:5000/health').then(r => r.text()).then(console.log)

// ─── Services ─────────────────────────────────────────────────────────────────
initWebSocket(server);
scheduleAlertWatcher(); // starts the every-minute GTT/price-alert cron job

// ─── 404 — unmatched routes ────────────────────────────────────────────────────
// Without this, an unmatched route falls through to Express's default HTML
// 404 page, which breaks JSON parsing on the frontend entirely.
app.use((req, res) => {
  res.status(404).json({
    message: "Not found",
    code: "NOT_FOUND",
    severity: "error",
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// Last line of defense — anything that slipped past a controller's own
// try/catch lands here. Uses the same contract as everywhere else so the
// frontend never has to special-case "the one response shape that's different."
const { mapErrorToResponse } = require("./utils/errors");

app.use((err, req, res, next) => {
  console.error("[ERROR HANDLER]", err.stack);
  const { status, body } = mapErrorToResponse(err);
  res.status(status).json(body);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5050;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🔌 WebSocket enabled on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log("\n⚠️  For React Native on a REAL DEVICE or Android emulator:");
  console.log("   Use your LAN IP in .env — NOT localhost!");
  console.log("   Find it with: ipconfig (Windows) or ifconfig (Mac/Linux)");
  console.log("   Example: API_BASE_URL=http://192.168.1.42:5000/api\n");
});