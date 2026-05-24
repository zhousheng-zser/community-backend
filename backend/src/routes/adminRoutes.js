const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminStatsController = require('../controllers/adminStatsController');
const adminMarketController = require('../controllers/adminMarketController');
const adminJdBenefitController = require('../controllers/adminJdBenefitController');
const adminRefundController = require('../controllers/adminRefundController');
const adminSettlementController = require('../controllers/adminSettlementController');
const adminMerchantAccountController = require('../controllers/adminMerchantAccountController');
const adminRiskController = require('../controllers/adminRiskController');
const adminOpsController = require('../controllers/adminOpsController');
const adminDispatchController = require('../controllers/adminDispatchController');
const adminCommunityOpsController = require('../controllers/adminCommunityOpsController');
const adminPddBenefitController = require('../controllers/adminPddBenefitController');
const adminMessageController = require('../controllers/adminMessageController');
const adminUserController = require('../controllers/adminUserController');
const adminSystemController = require('../controllers/adminSystemController');
const adminLocalGoodsHomeController = require('../controllers/adminLocalGoodsHomeController');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const adminHomeDisplayController = require('../controllers/adminHomeDisplayController');
const adminServiceHomeController = require('../controllers/adminServiceHomeController');


router.use(adminAuthMiddleware);

router.get('/stats/overview', adminStatsController.overview);
router.get('/users', adminUserController.listUsers);
router.get('/users/:id', adminUserController.getUser);
router.get('/system/health', adminSystemController.health);
router.get('/messages/overview', adminMessageController.overview);
router.post('/messages/broadcast', adminMessageController.broadcast);
router.get('/worker-applications', adminController.getWorkerApplications);
router.put('/worker-applications/:id', adminController.updateWorkerApplication);
router.get('/service-provider-applications', adminMarketController.listServiceProviderApplications);
router.put('/service-provider-applications/:id', adminMarketController.updateServiceProviderApplication);
router.post('/service-provider-portal-accounts', adminMarketController.createServiceProviderPortalAccount);
router.get('/dispatch-queue', adminDispatchController.dispatchQueue);
router.get('/housekeeping/workers', adminDispatchController.listAssignableWorkers);
router.get('/dispatch/workers', adminDispatchController.listAssignableWorkers);
router.get('/service-orders', adminDispatchController.listServiceOrders);
router.post('/service-orders/:id/assign', adminDispatchController.assignServiceOrder);
router.get('/neighbor-assist/orders', adminDispatchController.listNeighborAssistOrders);
router.post('/neighbor-assist/orders/:id/assign', adminDispatchController.assignNeighborAssistOrder);

router.get('/market-orders', adminMarketController.listOrders);
router.get('/market-orders/:orderNo', adminMarketController.getOrderDetail);
router.get('/order-fulfillment', adminMarketController.listOrderFulfillment);
router.post('/market-orders/:orderNo/actions', adminMarketController.applyOrderAction);
router.get('/market-payments', adminMarketController.listPayments);
router.get('/refunds', adminRefundController.list);
router.get('/refunds/export/csv', adminRefundController.exportCsv);
router.get('/refunds/:id', adminRefundController.detail);
router.post('/refunds/apply', adminRefundController.apply);
router.post('/refunds/:id/review', adminRefundController.review);
router.post('/refunds/:id/execute', adminRefundController.execute);
router.get('/reconcile/summary', adminSettlementController.reconcileSummary);
router.get('/settlements', adminSettlementController.listSettlementBills);
router.post('/settlements/generate', adminSettlementController.generateSettlement);
router.get('/settlements/export/csv', adminSettlementController.exportSettlementCsv);
router.get('/market-shops', adminMarketController.listShops);
router.post('/market-shops', adminMarketController.createShop);
router.get('/market-shops/:id', adminMarketController.getShop);
router.put('/market-shops/:id', adminMarketController.updateShop);
router.delete('/market-shops/:id', adminMarketController.deleteShopCascade);
router.get('/market-goods', adminMarketController.listGoods);
router.post('/market-goods', adminMarketController.createGood);
router.put('/market-goods/:id', adminMarketController.updateGood);
router.post('/market-goods/batch-update', adminMarketController.batchUpdateGoods);
router.get('/market-goods/low-stock', adminMarketController.lowStockGoods);
router.get('/market-applications', adminMarketController.listMarketApplications);
router.put('/market-applications/:id', adminMarketController.updateMarketApplication);
router.get('/market-shop-reviews', adminMarketController.listReviews);
router.delete('/market-shop-reviews/:id', adminMarketController.deleteReview);
router.get('/merchant-accounts', adminMerchantAccountController.list);
router.post('/merchant-accounts', adminMerchantAccountController.create);
router.put('/merchant-accounts/:id', adminMerchantAccountController.update);
router.post('/merchant-accounts/:id/reset-password', adminMerchantAccountController.resetPassword);
router.get('/complaint-tickets', adminRiskController.listComplaints);
router.post('/complaint-tickets', adminRiskController.createComplaint);
router.put('/complaint-tickets/:id', adminRiskController.resolveComplaint);
router.get('/approval-records', adminRiskController.listApprovalRecords);
router.get('/operation-logs', adminRiskController.listOperationLogs);
router.get('/coupon-templates', adminOpsController.listCouponTemplates);
router.post('/coupon-templates', adminOpsController.createCouponTemplate);
router.post('/coupon-issues/issue', adminOpsController.issueCoupon);
router.get('/coupon-issues', adminOpsController.listCouponIssues);
router.get('/activities', adminOpsController.listActivities);
router.post('/activities', adminOpsController.createActivity);
router.get('/reports', adminOpsController.dataReport);
router.get('/jd-benefit-goods', adminJdBenefitController.list);
router.post('/jd-benefit-goods', adminJdBenefitController.create);
router.put('/jd-benefit-goods/:id', adminJdBenefitController.update);
router.delete('/jd-benefit-goods/:id', adminJdBenefitController.destroy);

router.get('/pdd-benefit-goods', adminPddBenefitController.list);
router.post('/pdd-benefit-goods', adminPddBenefitController.create);
router.put('/pdd-benefit-goods/:id', adminPddBenefitController.update);
router.delete('/pdd-benefit-goods/:id', adminPddBenefitController.destroy);

router.get('/community-featured-goods', adminCommunityOpsController.listCommunityFeatured);
router.post('/community-featured-goods', adminCommunityOpsController.createCommunityFeatured);
router.put('/community-featured-goods/:id', adminCommunityOpsController.updateCommunityFeatured);
router.delete('/community-featured-goods/:id', adminCommunityOpsController.deleteCommunityFeatured);
router.get('/benefit-alliance-config', adminCommunityOpsController.getBenefitAllianceConfig);
router.put('/benefit-alliance-config', adminCommunityOpsController.upsertBenefitAllianceConfig);
router.get('/local-goods-home/ui-assets', adminLocalGoodsHomeController.listUiAssets);
router.put('/local-goods-home/ui-assets', adminLocalGoodsHomeController.updateUiAssets);
router.get('/local-goods-home/definitions', adminLocalGoodsHomeController.listDefinitions);
router.get('/local-goods-home/items', adminLocalGoodsHomeController.listItems);
router.get('/local-goods-home/goods/search', adminLocalGoodsHomeController.searchGoods);
router.post('/local-goods-home/items', adminLocalGoodsHomeController.createItem);
router.put('/local-goods-home/items/:id', adminLocalGoodsHomeController.updateItem);
router.delete('/local-goods-home/items/:id', adminLocalGoodsHomeController.deleteItem);


// ---- 直约服务商管理 ----
router.get('/service-providers', adminMarketController.listServiceProviders);
router.post('/service-providers', adminMarketController.createServiceProvider);
router.get('/service-providers/:id', adminMarketController.getServiceProvider);
router.put('/service-providers/:id', adminMarketController.updateServiceProvider);
router.get('/service-providers/:id/services', adminMarketController.listSpServices);
router.get('/sp-services', adminMarketController.listAllSpServices);
router.post('/service-providers/:id/services', adminMarketController.createSpService);
router.put('/service-providers/:id/services/:sid', adminMarketController.updateSpService);
router.delete('/service-providers/:id/services/:sid', adminMarketController.deleteSpService);
router.get('/sp-orders', adminMarketController.listSpOrders);


// ---- 首页展示管理 ----
router.get('/home-display/items', adminHomeDisplayController.listItems);
router.post('/home-display/items', adminHomeDisplayController.createItem);
router.put('/home-display/items/:id', adminHomeDisplayController.updateItem);
router.delete('/home-display/items/:id', adminHomeDisplayController.deleteItem);
router.get('/home-display/search/workers', adminHomeDisplayController.searchWorkers);
router.get('/home-display/search/services', adminHomeDisplayController.searchServices);
router.get('/home-display/search/service-providers', adminHomeDisplayController.searchServiceProviders);

// ---- 首页服务模块（九宫格 / 分组页）----
router.get('/service-home/modules', adminServiceHomeController.listModules);
router.post('/service-home/modules', adminServiceHomeController.createModule);
router.put('/service-home/modules/:id', adminServiceHomeController.updateModule);
router.delete('/service-home/modules/:id', adminServiceHomeController.deleteModule);
router.get('/service-home/categories', adminServiceHomeController.listCategories);
router.post('/service-home/categories', adminServiceHomeController.createCategory);
router.put('/service-home/categories/:id', adminServiceHomeController.updateCategory);
router.delete('/service-home/categories/:id', adminServiceHomeController.deleteCategory);
router.get('/service-home/services', adminServiceHomeController.listServices);
router.post('/service-home/services', adminServiceHomeController.createService);
router.put('/service-home/services/:id', adminServiceHomeController.updateService);
router.delete('/service-home/services/:id', adminServiceHomeController.deleteService);

module.exports = router;
