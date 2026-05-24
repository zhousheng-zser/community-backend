const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const ctrl = require('./controllers/merchant.controller');
const deliveryCtrl = require('../market/controllers/marketDelivery.controller');

router.use(authMiddleware);

// 7.1 仪表盘和店铺
router.get('/dashboard', ctrl.getDashboard);
router.get('/shop', ctrl.getShop);
router.patch('/shop', ctrl.updateShop);

// 7.2 商品管理
router.get('/goods', ctrl.getGoodsList);
router.post('/goods', ctrl.createGoods);
router.get('/goods/:id', ctrl.getGoodsDetail);
router.patch('/goods/:id', ctrl.updateGoods);
router.post('/goods/:id/restock', ctrl.restockGoods);
router.post('/goods/:id/shelf', ctrl.toggleShelf);

// 7.3 订单管理
router.get('/orders', ctrl.getOrders);
router.get('/shop/orders', ctrl.getOrders); // 兼容旧前端
router.get('/orders/:orderNo', ctrl.getOrderDetail);
router.post('/orders/:orderNo/action', ctrl.orderAction);
router.post('/orders/:orderNo/accept', (req, res, next) => { req.body = Object.assign({}, req.body, { action: 'accept' }); next(); }, ctrl.orderAction);
router.post('/orders/:orderNo/cancel', (req, res, next) => { req.body = Object.assign({}, req.body, { action: 'reject' }); next(); }, ctrl.orderAction);
router.post('/orders/:orderNo/ship', (req, res, next) => { req.body = Object.assign({}, req.body, { action: 'dispatch' }); next(); }, ctrl.orderAction);
router.post('/orders/:orderNo/complete-delivery', (req, res, next) => { req.body = Object.assign({}, req.body, { action: 'delivered' }); next(); }, ctrl.orderAction);
router.get('/orders/:orderNo/delivery/options', deliveryCtrl.merchantOptions);
router.post('/orders/:orderNo/delivery/launch', deliveryCtrl.merchantLaunch);
router.get('/orders/:orderNo/delivery/track', deliveryCtrl.merchantTrack);
router.get('/payments', ctrl.getPayments);
router.get('/balance', ctrl.getBalance);
router.post('/withdraw', ctrl.withdraw);

// 7.4 客户管理
router.get('/customers/list', ctrl.getCustomers);
router.get('/customers/:id/orders', ctrl.getCustomerOrders);
router.get('/customers/:id/stats', ctrl.getCustomerStats);

// 7.5 营销管理
router.get('/marketing/coupons', ctrl.getMarketingCoupons);
router.post('/marketing/coupons', ctrl.createMarketingCoupon);
router.post('/marketing/coupons/:id', ctrl.updateMarketingCoupon);
router.get('/marketing/stats', ctrl.getMarketingStats);

// 7.6 退款管理
router.get('/refunds/list', ctrl.getRefunds);
router.get('/refunds/:id', ctrl.getRefundDetail);
router.post('/refunds/:id/approve', ctrl.approveRefund);
router.post('/refunds/:id/reject', ctrl.rejectRefund);
router.get('/refunds/stats/summary', ctrl.getRefundStats);

module.exports = router;
