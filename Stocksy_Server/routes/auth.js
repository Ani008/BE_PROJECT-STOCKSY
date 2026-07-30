const express = require('express');
const router = express.Router();
const { signupUser, loginUser, logoutUser } = require('../controllers/auth');
const { deleteAccountHandler } = require('../controllers/accountController');
const { authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

router.post('/signup', authLimiter, signupUser);
router.post('/login', authLimiter, loginUser);
router.post('/logout', logoutUser);
router.delete('/account', protect, authLimiter, deleteAccountHandler);

module.exports = router;