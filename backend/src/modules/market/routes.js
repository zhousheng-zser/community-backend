const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const ctrl = require('./controllers/market.controller');
const deliveryCtrl = require('./controllers/marketDelivery.controller');

// 6.1 商家入驻
router.post('/apply', authMiddleware, ctrl.apply);

// 6.2 店铺和商品
router.get('/search', ctrl.search);
router.get('/shops', ctrl.getShops);
router.get('/shops/:shopId', ctrl.getShopDetail);
router.get('/shops/:shopId/goods', ctrl.getShopGoods);
router.get('/shops/:shopId/categories', ctrl.getShopCategories);
router.get('/shop/goods', ctrl.getShopGoodsCompat); // 兼容前端 fallback 调用
router.get('/goods/:goodsId', ctrl.getGoodsDetail);
router.get('/shops/:shopId/contact', ctrl.getShopContact);

// 6.3 购物车
router.get('/cart/summary', authMiddleware, ctrl.getCartSummary);
router.get('/cart', authMiddleware, ctrl.getCart);
router.post('/cart/items', authMiddleware, ctrl.addCartItem);
router.put('/cart/items/:itemId', authMiddleware, ctrl.updateCartItem);
router.delete('/cart/items/:itemId', authMiddleware, ctrl.deleteCartItem);
router.delete('/cart', authMiddleware, ctrl.clearCart);

// 6.4 订单管理
router.post('/orders/preview', authMiddleware, ctrl.previewOrder);
router.post('/orders', authMiddleware, ctrl.createOrder);
router.post('/order/create', authMiddleware, ctrl.createOrder); // 兼容旧前端
router.get('/orders', authMiddleware, ctrl.getMyOrders);
router.get('/orders/my', authMiddleware, ctrl.getMyOrders); // 兼容旧前端
router.get('/orders/:orderNo', authMiddleware, ctrl.getOrderDetail);
router.post('/orders/:orderNo/cancel', authMiddleware, ctrl.cancelOrder);
router.delete('/orders/:orderNo', authMiddleware, ctrl.deleteOrder);
router.post('/orders/:orderNo/buy-again', authMiddleware, ctrl.buyAgain);
router.get('/orders/:orderNo/logistics', authMiddleware, ctrl.getLogistics);
router.get('/orders/:orderNo/delivery/track', authMiddleware, deliveryCtrl.buyerTrack);
router.post('/delivery/webhook/meituan', deliveryCtrl.webhookMeituan);
router.post('/delivery/webhook/eleme', deliveryCtrl.webhookEleme);

// 6.5 支付
router.post('/payments/create', authMiddleware, ctrl.createPayment);
router.get('/payments/status', authMiddleware, ctrl.getPaymentStatus);
router.post('/payments/mock-success', authMiddleware, ctrl.mockPaymentSuccess);

// 6.6 收货与退款
router.post('/orders/:orderNo/confirm-receipt', authMiddleware, ctrl.confirmReceipt);
router.post('/orders/:orderNo/refund', authMiddleware, ctrl.applyRefund);
router.get('/orders/:orderNo/refund', authMiddleware, ctrl.getRefundDetail);
router.post('/orders/:orderNo/refund/cancel', authMiddleware, ctrl.cancelRefund);

// 6.7 管理后台
router.get('/admin/shops', authMiddleware, ctrl.getAdminShopList);
router.post('/admin/shops/:id/review', authMiddleware, ctrl.reviewShop);

module.exports = router;
