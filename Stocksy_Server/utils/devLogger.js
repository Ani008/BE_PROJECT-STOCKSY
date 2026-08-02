// utils/devLogger.js
// Import this FIRST, before any other require — silences console.log/debug
// unless explicitly enabled. console.error/warn stay ON always, so real
// errors are still visible in `pm2 logs` even in production.
const DEBUG = process.env.DEBUG_LOGS === 'true' || process.env.NODE_ENV !== 'production';

if (!DEBUG) {
  console.log = () => {};
  console.debug = () => {};
}