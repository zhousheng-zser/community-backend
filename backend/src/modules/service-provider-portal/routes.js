const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const ctrl = require('./controllers/serviceProvider.controller');
const applicationController = require('../../controllers/applicationController');

router.use(authMiddleware);

// 入驻申请（小程序 C 端；须登录）
router.post('/apply', applicationController.serviceProviderApply);
router.get('/application/me', applicationController.getServiceProviderApplicationMe);

// 8.1 个人信息
router.get('/me', ctrl.getMe);
router.patch('/profile', ctrl.updateProfile);

// 8.2 仪表盘
router.get('/dashboard', ctrl.getDashboard);

// 8.3 服务管理
router.get('/categories', ctrl.getCategories);
router.get('/services', ctrl.getServices);
router.post('/services', ctrl.createService);
router.get('/services/:id', ctrl.getServiceDetail);
router.patch('/services/:id', ctrl.updateService);

// 8.4 订单管理
router.get('/orders', ctrl.getOrders);
router.get('/orders/:id', ctrl.getOrderDetail);
router.post('/orders/:id/accept', ctrl.acceptOrder);
router.post('/orders/:id/check-in', ctrl.checkIn);
router.post('/orders/:id/evidence', ctrl.uploadEvidence);
router.post('/orders/:id/complete', ctrl.completeOrder);

// 8.5 技工管理
router.get('/workers/list', ctrl.getWorkers);
router.get('/workers/:id', ctrl.getWorkerDetail);
router.post('/workers/:id/status', ctrl.updateWorkerStatus);
router.get('/workers/:id/stats', ctrl.getWorkerStats);

// 8.6 财务管理
router.get('/finance/income/summary', ctrl.getIncomeSummary);
router.get('/finance/income/list', ctrl.getIncomeList);
router.get('/finance/income/daily', ctrl.getDailyIncome);
router.get('/finance/balance', ctrl.getBalance);

module.exports = router;
