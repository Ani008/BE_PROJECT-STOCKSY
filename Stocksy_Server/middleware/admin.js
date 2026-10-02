// middleware/admin.js — use AFTER `protect`
const { pool } = require('../config/postgres');
const { sendError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

const requireAdmin = async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || rows[0].is_admin !== true) {
      throw new ForbiddenError('Admin access required');
    }
    next();
  } catch (err) {
    return sendError(res, err, logger);
  }
};

module.exports = { requireAdmin };