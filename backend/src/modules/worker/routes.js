const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const ctrl = require('./controllers/worker.controller');

router.use(authMiddleware);

// 入驻申请
router.post('/apply', ctrl.apply);
router.get('/application/me', ctrl.getMyApplication);
router.get('/profile/me', ctrl.getMyProfile);
router.patch('/profile/me', ctrl.updateMyProfile);
router.get('/applications', ctrl.getApplications);
router.post('/applications/:id/review', ctrl.reviewApplication);

// 服务订单（由主后端实现）
router.get('/service-orders', ctrl.getOrders);
router.get('/service-orders/:id', ctrl.getOrderDetail);
router.post('/service-orders/:id/accept', ctrl.acceptOrder);
router.post('/service-orders/:id/reject', ctrl.rejectOrder);
router.post('/service-orders/:id/check-in', ctrl.checkIn);
router.post('/service-orders/:id/evidence', ctrl.uploadEvidence);
router.post('/service-orders/:id/complete', ctrl.completeOrder);

// 服务管理
router.get('/services', ctrl.getMyServices);
router.post('/services', ctrl.createService);
router.patch('/services/:id', ctrl.updateService);
router.post('/services/:id/delete', ctrl.deleteService);

module.exports = router;
