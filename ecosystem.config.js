// STOCKSY/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "stocksy-api",
      script: "server.js",
      cwd: "./Stocksy_Server",
      env: { NODE_ENV: "production", PORT: 5050 }
    },
    {
      name: "stocksy-order-worker",
      script: "workers/orderWorker.js",
      cwd: "./Stocksy_Server",
      env: { NODE_ENV: "production" }
    },
    {
      name: "stocksy-ws-client",
      script: "websocket_client.py",
      cwd: "./backend_py",
      interpreter: "python",
      env: { DEBUG_LOGS: "false" }
    },
    {
      name: "stocksy-historical-fetcher",
      script: "historical_fetcher.py",
      cwd: "./backend_py",
      interpreter: "python",
      env: { DEBUG_LOGS: "false" }
    },
    {
      name: "stocksy-fundamentals-scheduler",
      script: "fundamentals.py",
      cwd: "./backend_py",
      interpreter: "python",
      env: { DEBUG_LOGS: "false", RUN_ONCE: "false" }
    }
  ]
};