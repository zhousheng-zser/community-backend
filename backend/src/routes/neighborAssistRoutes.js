const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/neighborAssistController');

router.use(authMiddleware);
router.post('/orders', ctrl.create);
router.get('/orders/my', ctrl.myList);
router.get('/orders/pool', ctrl.pool);
router.get('/orders/community-pool', ctrl.communityPool);
router.get('/orders/:id', ctrl.detail);
router.post('/orders/:id/pay', ctrl.mockPay);
router.post('/orders/:id/grab', ctrl.grab);
router.post('/orders/:id/community-grab', ctrl.communityGrab);
router.post('/orders/:id/cancel', ctrl.cancel);
router.post('/orders/:id/accept', ctrl.accept);
router.post('/orders/:id/check-in', ctrl.checkIn);
router.post('/orders/:id/reject', ctrl.reject);
router.post('/orders/:id/complete', ctrl.complete);
router.post('/orders/:id/confirm', ctrl.confirm);

module.exports = router;
