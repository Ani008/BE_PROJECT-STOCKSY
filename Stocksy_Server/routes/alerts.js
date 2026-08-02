/**
 * routes/alerts.js
 * Mount in server.js: app.use('/api/alerts', require('./routes/alerts'));
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createAlertHandler,
  listAlertsHandler,
  cancelAlertHandler,
} = require("../controllers/alertController");

// POST   /api/alerts       — create a price alert
// GET    /api/alerts       — list the logged-in user's alerts
// DELETE /api/alerts/:id   — cancel an active alert
router.post("/", protect, createAlertHandler);
router.get("/", protect, listAlertsHandler);
router.delete("/:id", protect, cancelAlertHandler);

module.exports = router;