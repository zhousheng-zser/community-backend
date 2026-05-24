const express = require('express');
const router = express.Router();
const applicationController = require('../controllers/applicationController');
const authMiddleware = require('../middlewares/authMiddleware');
const workerPortalController = require('../controllers/workerPortalController');

router.post('/apply', authMiddleware, applicationController.workerApply);
router.get('/application/me', authMiddleware, applicationController.getWorkerApplicationMe);

const workerCtrl = require('../modules/worker/controllers/worker.controller');
router.get('/profile/me', authMiddleware, workerCtrl.getMyProfile);
router.patch('/profile/me', authMiddleware, workerCtrl.updateMyProfile);

router.get('/service-orders', authMiddleware, workerPortalController.listOrders);
router.get('/service-orders/:id', authMiddleware, workerPortalController.getOrder);
router.post('/service-orders/:id/accept', authMiddleware, workerPortalController.accept);
router.post('/service-orders/:id/reject', authMiddleware, workerPortalController.reject);
router.post('/service-orders/:id/check-in', authMiddleware, workerPortalController.checkIn);
router.post('/service-orders/:id/evidence', authMiddleware, workerPortalController.evidence);
router.post('/service-orders/:id/addon-request', authMiddleware, workerPortalController.addonRequest);
router.post('/service-orders/:id/complete', authMiddleware, workerPortalController.complete);

// 技工服务管理（我的服务）
router.get('/services', authMiddleware, workerCtrl.getMyServices);
router.post('/services', authMiddleware, workerCtrl.createService);
router.patch('/services/:id', authMiddleware, workerCtrl.updateService);
router.post('/services/:id/delete', authMiddleware, workerCtrl.deleteService);

module.exports = router;
