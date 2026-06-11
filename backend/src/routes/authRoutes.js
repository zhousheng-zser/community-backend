const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// 注册/短信验证码/重置密码
router.post('/sms/send', authController.sendSmsCode);
router.post('/register', authController.register);
router.post('/password_reset', authController.passwordReset);

// POST /api/v1/auth/login — 微信已注册直接登录
router.post('/login', authController.login);

// POST /api/v1/auth/login_sms — 手机号 + 验证码
router.post('/login_sms', authController.loginSms);

// POST /api/v1/auth/login_password — 手机号 + 密码
router.post('/login_password', authController.loginPassword);
router.post('/login_sms', authController.loginSms);

// POST /api/v1/auth/bind_wx — 已登录用户更新微信 openid（换 AppID 后）
router.post('/bind_wx', authMiddleware, authController.bindWx);

// POST /api/v1/auth/logout
router.post('/logout', authMiddleware, authController.logout);

// POST /api/v1/auth/admin/login — 管理后台（JWT 与小程序用户隔离：payload.admin === true）
router.post('/admin/login', authController.adminLogin);

// 兼容性接口 (被原小程序代码误拼为 api/wx/getkey)
router.get('/wx/getkey/:code', (req, res) => {
    // 转发给 login 处理提取 openid 和 session_key
    // 这里简单返回 mock 数据或者调用 login
    req.body = { code: req.params.code };
    return authController.login(req, res);
});


module.exports = router;
