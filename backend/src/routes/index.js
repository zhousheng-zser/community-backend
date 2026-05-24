/**
 * 路由统一挂载入口
 *
 * 所有业务模块路由在此集中注册，统一前缀为 /api/v1。
 * 新增模块时只需引入对应模块的 routes.js 并在下方 router.use() 中注册即可。
 */
const express = require('express');
const router = express.Router();

// ── 认证 ──────────────────────────────────────────────────────────────────
const authRoutes = require('../modules/auth/routes');

// ── 用户 ──────────────────────────────────────────────────────────────────
const userRoutes = require('../modules/user/routes');

// ── 核心功能 ──────────────────────────────────────────────────────────────
const coreRoutes = require('../modules/core/routes');
const coreDataRoutes = require('./coreDataRoutes');
const adminServiceHomeRoutes = require('./adminServiceHome.routes');

// ── 首页 ─────────────────────────────────────────────────────────────────
// const homeRoutes = require('../modules/home/routes');

// ── 本地集市 ─────────────────────────────────────────────────────────────
const marketRoutes = require('../modules/market/routes');

// ── 本地商城 ─────────────────────────────────────────────────────────────
// const shopRoutes = require('../modules/shop/routes');

// ── 惠民卡 / 福利联盟 ───────────────────────────────────────────────────
const benefitCardRoutes = require('../modules/benefit-card/routes');
const benefitAllianceRoutes = require('../modules/benefit-card/alliance.routes');
const benefitAllianceAdminRoutes = require('../modules/benefit-card/admin.routes');

// ── 优惠券 ───────────────────────────────────────────────────────────────
const couponRoutes = require('../modules/coupon/routes');

// ── 聊天 / 群聊 ──────────────────────────────────────────────────────────
const chatRoutes = require('../modules/chat/routes');

// ── 佣金 / 合伙人 / 推广员 ───────────────────────────────────────────────
const commissionRoutes = require('../modules/commission/commission.routes');
const partnerRoutes = require('../modules/commission/partner.routes');
const promoterRoutes = require('../modules/promoter/routes');

// ── 小程序配置 ───────────────────────────────────────────────────────────
const miniProgramRoutes = require('../modules/mini-program/routes');

// ── 邻里帮帮 ─────────────────────────────────────────────────────────────
const neighborAssistRoutes = require('../modules/neighbor-assist/routes');

// ── 技工工作台 ───────────────────────────────────────────────────────────
const workerRoutes = require('../modules/worker/routes');

// ── 小区管家 ───────────────────────────────────────────────────────────────
const stewardRoutes = require('../modules/steward/routes');

// ── 商家后台 ─────────────────────────────────────────────────────────────
const merchantRoutes = require('../modules/merchant/routes');

// ── 服务商后台 ───────────────────────────────────────────────────────────
const serviceProviderRoutes = require('../modules/service-provider-portal/routes');

// ── 骑手端（预留） ───────────────────────────────────────────────────────
// const riderRoutes = require('../modules/rider/routes');

// ── 社区 ─────────────────────────────────────────────────────────────────
const communityRoutes = require('../modules/community/routes');

// ── 服务订单（线上见 src/routes/serviceOrderRoutes.js + controllers/serviceOrderController.js）
const serviceOrderRoutes = require('../modules/service-order/routes');

// ── 消息通知 ─────────────────────────────────────────────────────────────
const messageRoutes = require('../modules/message/routes');

// ── 挂载 ─────────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/core', coreDataRoutes);
router.use('/core', coreRoutes);
// router.use('/home', homeRoutes);
router.use('/market', marketRoutes);
// router.use('/shop', shopRoutes);
router.use('/benefit-coin', benefitCardRoutes);
router.use('/benefit-alliance', benefitAllianceRoutes);
router.use('/admin', benefitAllianceAdminRoutes);
router.use('/admin', adminServiceHomeRoutes);
const adminDispatchRoutes = require('../modules/service-order/adminDispatch.routes');
// 九州派单（到家）：线上 adminRoutes 亦挂载 assign；本地用 adminDispatch 子路由
router.use('/admin', adminDispatchRoutes);
router.use('/coupons', couponRoutes);
const couponCtrl = require('../modules/coupon/controllers/coupon.controller');
const authMiddleware = require('../middlewares/authMiddleware');
router.get('/wx/user/coupon/:id', authMiddleware, couponCtrl.getMyCouponsLegacy);
router.use('/chat', chatRoutes);
router.use('/commission', commissionRoutes);
router.use('/partner', partnerRoutes);
router.use('/promoter', promoterRoutes);
router.use('/mini-programs', miniProgramRoutes);
router.use('/neighbor-assist', neighborAssistRoutes);
router.use('/worker', workerRoutes);
router.use('/steward', stewardRoutes);
router.use('/merchant', merchantRoutes);
router.use('/service-provider', serviceProviderRoutes);
router.use('/service-provider-portal', serviceProviderRoutes); // 兼容旧路径
router.use('/community', communityRoutes);
router.use('/service-order', serviceOrderRoutes);
router.use('/service-orders', serviceOrderRoutes); // 兼容前端复数路径
router.use('/service-cart', require('./serviceCartRoutes'));
router.use('/message', messageRoutes);
router.use('/messages', messageRoutes); // 兼容前端复数路径

// ── 文件上传（独立端点） ─────────────────────────────────────────────────
// 注：上传端点通常需要 multipart 解析，此处保留结构，
// 实际使用时需引入 multer 或对应 upload 中间件。
// router.post('/upload', authMiddleware, upload.single('file'), uploadHandler);

module.exports = router;
