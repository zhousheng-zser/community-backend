require('dotenv').config({
    path: require('path').resolve(__dirname, '..', '.env'),
    override: true,
    quiet: true
});
// E2E 子进程等场景：行内传入的监听端口不要被 .env 里 PORT 覆盖掉
if (process.env.E2E_API_PORT) {
    process.env.PORT = process.env.E2E_API_PORT;
    // .env 中 override 会固定 HTTP_PORT/HTTPS_PORT；E2E 需与 E2E_CHILD_PORT 一致
    process.env.HTTP_PORT = process.env.E2E_API_PORT;
    const hp = parseInt(process.env.E2E_API_PORT, 10);
    if (Number.isFinite(hp)) {
        process.env.HTTPS_PORT = String(hp + 100);
    }
}
// E2E：强制走本地 mock 微信登录（避免无效 code 调微信接口）
if (process.env.E2E_CLEAR_WX_SECRET === '1') {
    process.env.WX_APPSECRET = '';
}
const express = require('express');
const cors = require('cors');

const app = express();
/** 与 admin Vite 代理默认 VITE_PROXY_TARGET=3001 一致，避免只起前端时 ECONNREFUSED */
const PORT = parseInt(process.env.PORT, 10) || 3001;

// 中间件
app.use(cors());
// 微信支付 V3 回调验签需要原始 JSON 字符串；且不能被后续 express.json() 覆盖 req.body
app.use(
    '/api/v1/market/pay/callback',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
        const buf = req.body;
        req.rawBodyForWechat = buf && buf.length ? buf.toString('utf8') : '';
        try {
            req.body = req.rawBodyForWechat ? JSON.parse(req.rawBodyForWechat) : {};
        } catch (e) {
            req.body = {};
        }
        next();
    }
);
app.use((req, res, next) => {
    if (req.path === '/api/v1/market/pay/callback') return next();
    express.json()(req, res, next);
}); // 其余路由解析 application/json

// 请求日志中间件
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
    next();
});

// 静态文件目录映射到项目内 data/uploads/images 目录（兼容 Linux 部署）
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads', 'images')));
app.get('/img/placeholders/:name', (req, res) => {
    // 测试环境兜底占位图，避免前端引用历史占位路径时报 500
    const onePxPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zx1cAAAAASUVORK5CYII=';
    const imageBuffer = Buffer.from(onePxPng, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(imageBuffer);
});

// 基础测试路由
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Community Mini-Program API!' });
});

const authRoutes = require('./routes/authRoutes');
const postRoutes = require('./routes/postRoutes');
const coreDataRoutes = require('./routes/coreDataRoutes');
const userRoutes = require('./routes/userRoutes');

// -------------------
// 路由挂载
// -------------------
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/core', coreDataRoutes);
app.use('/api/v1/geo', require('./routes/geoRoutes'));
app.use('/api/v1/service-orders', require('./routes/serviceOrderRoutes'));
app.use('/api/v1/service-cart', require('./routes/serviceCartRoutes'));
app.use('/api/v1/neighbor-assist', require('./routes/neighborAssistRoutes'));
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/messages', require('./routes/messageRoutes'));
app.use('/api/v1/worker', require('./routes/workerRoutes'));
app.use('/api/v1/steward', require('./modules/steward/routes'));

const workerPortalLoginController = require('./controllers/workerPortalLoginController');
const merchantPortalController = require('./controllers/merchantPortalController');
const serviceProviderPortalController = require('./controllers/serviceProviderPortalController');
const merchantPortalRoutes = require('./routes/merchantPortalRoutes');
const serviceProviderPortalRoutes = require('./routes/serviceProviderPortalRoutes');
app.post('/api/v1/worker-portal/login', workerPortalLoginController.login);
app.post('/api/v1/merchant-portal/login', merchantPortalController.login);
app.post('/api/v1/service-provider-portal/login', serviceProviderPortalController.login);
app.use('/api/v1/service-provider-portal', serviceProviderPortalRoutes);
app.use('/api/v1/service-provider-portal/workers', require('./routes/serviceProviderWorkerRoutes'));
app.use('/api/v1/service-provider-portal/finance', require('./routes/serviceProviderFinanceRoutes'));
app.use('/api/v1/market/merchant', merchantPortalRoutes);
app.use('/api/v1/market/shop', merchantPortalRoutes);
// 商家订单/配送（modules/merchant）；254 线上由 merchantPortalRoutes 一并提供
app.use('/api/v1/market/merchant', require('./modules/merchant/routes'));
app.use('/api/v1/market/merchant/customers', require('./routes/merchantCustomerRoutes'));
app.use('/api/v1/market/merchant/marketing', require('./routes/merchantMarketingRoutes'));
app.use('/api/v1/market/merchant/refunds', require('./routes/merchantRefundRoutes'));
// 服务商路由：同时挂载到 /service-provider（兼容旧路径）和 /service-provider-portal
// 使用门户路由（含 /me, /dashboard, /orders 等完整功能）
app.use('/api/v1/service-provider', serviceProviderPortalRoutes);
app.use('/api/v1/market', require('./routes/marketRoutes'));
app.use('/api/v1/activities', require('./routes/activityRoutes'));
app.use('/api/v1/feedback', require('./routes/feedbackRoutes'));
app.use('/api/v1/admin', require('./routes/adminRoutes'));
app.use('/api/v1/admin/communities', require('./routes/adminCommunityRoutes'));
app.use('/api/v1/admin/announcements', require('./routes/adminAnnouncementRoutes'));
app.use('/api/v1/local-goods-home', require('./routes/localGoodsHomeRoutes'));
// New modules: chat, coupons, benefit-coin, promoter, mini-programs
app.use('/api/v1/chat', require('./routes/chatRoutes'));
app.use('/api/v1/coupons', require('./routes/couponRoutes'));
const couponCtrl = require('./modules/coupon/controllers/coupon.controller');
const authMiddleware = require('./middlewares/authMiddleware');
app.get('/api/v1/wx/user/coupon/:id', authMiddleware, couponCtrl.getMyCouponsLegacy);
app.use('/api/v1/benefit-coin', require('./routes/benefitCoinRoutes'));
app.use('/api/v1/promoter', require('./routes/promoterRoutes'));
app.use('/api/v1/commission', require('./modules/commission/commission.routes'));
app.use('/api/v1/partner', require('./modules/commission/partner.routes'));
app.use('/api/v1/mini-programs', require('./routes/miniProgramRoutes'));

require('./mountBenefitAlliance')(app);

// ===================
// User Profile Mock Routes
// 为了匹配前端直接写死的接口名而临时添加
// ===================
const userController = require('./controllers/userController');
app.get('/api/v1/acount/info', userController.getAccountInfo);
// wx/user/coupon 已在上方注册 getMyCouponsLegacy（带鉴权），勿重复注册空 stub

// 图片上传：入驻单图 ≤200KB；通用 /upload 可达 10MB
const { uploadMarketImage, uploadApplicationImage, getImageMeta } = require('./utils/marketUpload');
function handleUpload(req, res) {
    const { width, height } = getImageMeta(req.file.path);
    return res.json({
        code: 0,
        msg: 'ok',
        data: {
            url: `/uploads/${req.file.filename}`,
            size: req.file.size,
            mime_type: req.file.mimetype,
            width,
            height,
            max_bytes: Number(res.getHeader('X-Upload-Max-Bytes')) || null
        }
    });
}
app.post('/api/v1/upload/application', uploadApplicationImage, handleUpload);
app.post('/upload/application', uploadApplicationImage, handleUpload);
app.post('/api/v1/upload', uploadMarketImage, handleUpload);
app.post('/upload', uploadMarketImage, handleUpload);


const https = require('https');
const fs = require('fs');

const sslDir = path.join(__dirname, '..', 'ssl');
const hasSsl = fs.existsSync(path.join(sslDir, 'key.pem')) && fs.existsSync(path.join(sslDir, 'cert.pem'));
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 3001;
const HTTP_PORT = parseInt(process.env.HTTP_PORT, 10) || 3002;

if (hasSsl) {
    const httpsOptions = {
        key: fs.readFileSync(path.join(sslDir, 'key.pem')),
        cert: fs.readFileSync(path.join(sslDir, 'cert.pem'))
    };
    https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
        console.log(`HTTPS Server is running on https://localhost:${HTTPS_PORT}`);
    });
}

app.listen(HTTP_PORT, () => {
    console.log(`Server is running on http://localhost:${HTTP_PORT}`);
});


// 首页展示公开接口
app.get('/api/v1/home-display/items', require('./controllers/adminHomeDisplayController').getPublicHomeItems);
