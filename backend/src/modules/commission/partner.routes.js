/**
 * Partner Routes
 * GET  /partner/me          - My partner info
 * GET  /partner/my-downlines - My downlines
 * POST /partner/apply       - Apply for role
 * POST /partner/refresh-chain - Re-resolve chain
 */
const express = require('express');
const router = express.Router();
const ctrl = require('./controllers/partner.controller');
const authMiddleware = require('../../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/me', ctrl.getMe);
router.get('/application/me', ctrl.getApplicationMe);
router.get('/my-downlines', ctrl.getMyDownlines);
router.post('/apply', ctrl.apply);
router.post('/refresh-chain', ctrl.refreshChain);

module.exports = router;
