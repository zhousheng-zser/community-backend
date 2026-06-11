const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { resolveOpenidFromCode } = require('../utils/wxOpenid');
const { verifyPassword, verifySmsCode, applyPasswordFields } = require('../utils/authPassword');

function issueUserToken(user) {
  return jwt.sign(
    {
      id: String(user.id),
      openid: user.openid || null,
      token_version: user.token_version || 0
    },
    process.env.JWT_SECRET || 'default_secret',
    { expiresIn: '7d' }
  );
}

function formatUserPayload(user) {
  return {
    id: String(user.id),
    phone: user.phone || '',
    nickname: user.nickname || '',
    avatar_url: user.avatar_url || '',
    openid: user.openid || ''
  };
}

function jsonOk(res, { msg, token, user, data, status = 200 }) {
  return res.status(status).json({
    code: 0,
    msg: msg || 'ok',
    message: msg || 'ok',
    token,
    user,
    data: data != null ? data : { token }
  });
}

function jsonErr(res, status, msg) {
  return res.status(status).json({ code: status, msg, message: msg, data: null, token: null });
}

/** POST /api/v1/auth/login — 微信已注册则登录，未注册则失败 */
exports.login = async (req, res) => {
  try {
    const { code, nickname, avatar_url, phone, sms_code } = req.body || {};
    if (!code) {
      return jsonErr(res, 400, '缺少 code 参数');
    }

    const openid = await resolveOpenidFromCode(code);
    let user = await User.findOne({ where: { openid } });

    if (!user && phone && sms_code) {
      if (!verifySmsCode(sms_code)) {
        return jsonErr(res, 400, '验证码错误');
      }
      const phoneStr = String(phone).trim();
      user = await User.findOne({ where: { phone: phoneStr } });
      if (!user) {
        return jsonErr(res, 404, '该手机号未注册');
      }
      const occupied = await User.findOne({ where: { openid } });
      if (occupied && String(occupied.id) !== String(user.id)) {
        return jsonErr(res, 409, '该微信已绑定其他账号');
      }
      user.openid = openid;
      await user.save();
    }

    if (!user) {
      return jsonErr(res, 404, '该微信尚未注册，请先完成手机号注册并绑定微信');
    }

    if (nickname || avatar_url) {
      if (nickname) user.nickname = nickname;
      if (avatar_url) user.avatar_url = avatar_url;
      await user.save();
    }

    const token = issueUserToken(user);
    return jsonOk(res, { msg: '登录成功', token, user: formatUserPayload(user) });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ code: 400, error: error.message, details: error.details });
    }
    console.error('Login Error:', error);
    return jsonErr(res, 500, '服务器内部错误');
  }
};

/** POST /api/v1/auth/login_sms — 手机号 + 验证码（不要求绑定当前微信） */
exports.loginSms = async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) {
      return jsonErr(res, 400, '缺少 phone/code');
    }
    if (!verifySmsCode(code)) {
      return jsonErr(res, 400, '验证码错误');
    }

    const phoneStr = String(phone).trim();
    const user = await User.findOne({ where: { phone: phoneStr } });
    if (!user) {
      return jsonErr(res, 401, '该手机号未注册，请先完成注册');
    }

    const token = issueUserToken(user);
    return jsonOk(res, { msg: '登录成功', token, user: formatUserPayload(user) });
  } catch (e) {
    console.error('loginSms error:', e);
    return jsonErr(res, 500, '登录失败');
  }
};

/** POST /api/v1/auth/login_password — 手机号 + 密码 */
exports.loginPassword = async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      return jsonErr(res, 400, '缺少 phone/password');
    }

    const user = await User.findOne({ where: { phone: String(phone) } });
    if (!user || !verifyPassword(user, password)) {
      return jsonErr(res, 401, '账号或密码错误');
    }

    const token = issueUserToken(user);
    return jsonOk(res, { msg: '登录成功', token, user: formatUserPayload(user) });
  } catch (e) {
    console.error('loginPassword error:', e);
    return jsonErr(res, 500, '登录失败');
  }
};

/** POST /api/v1/auth/register — 手机+验证码+密码，绑定当前微信 */
exports.register = async (req, res) => {
  try {
    const {
      phone,
      password,
      sms_code,
      code: legacySmsCode,
      wx_code,
      wxCode,
      address,
      lat,
      lng,
      nickname,
      avatar_url
    } = req.body || {};
    const smsCode = sms_code != null ? sms_code : legacySmsCode;
    const wechatCode = wx_code || wxCode;
    if (!phone || !smsCode || !password || !wechatCode) {
      return jsonErr(res, 400, '缺少 phone/sms_code/password 或微信 wx_code');
    }
    if (!verifySmsCode(smsCode)) {
      return jsonErr(res, 400, '验证码错误');
    }

    const phoneStr = String(phone).trim();
    const existingPhone = await User.findOne({ where: { phone: phoneStr } });
    if (existingPhone) {
      return jsonErr(res, 409, '该手机号已被绑定，请更换手机号或直接登录');
    }

    const openid = await resolveOpenidFromCode(wechatCode);
    const existingOpenid = await User.findOne({ where: { openid } });
    if (existingOpenid) {
      return jsonErr(res, 409, '当前微信已注册，请直接微信登录');
    }

    const user = User.build({
      openid,
      phone: phoneStr,
      nickname: nickname || `用户${phoneStr.slice(-4)}`,
      avatar_url: avatar_url || '',
      address: address || null
    });
    applyPasswordFields(user, password);
    await user.save();

    const token = issueUserToken(user);
    return jsonOk(res, {
      msg: '注册成功',
      token,
      user: formatUserPayload(user),
      data: { id: String(user.id), phone: user.phone, lat: lat ?? null, lng: lng ?? null }
    });
  } catch (e) {
    if (e.status === 400) {
      return jsonErr(res, 400, e.message);
    }
    console.error('register error:', e);
    return jsonErr(res, 500, '注册失败');
  }
};

/** POST /api/v1/auth/bind_wx — 已登录用户绑定/更新当前微信 openid（换 AppID 后使用） */
exports.bindWx = async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return jsonErr(res, 400, '缺少 code 参数');
    }
    const userId = String(req.user && req.user.id);
    if (!userId) {
      return jsonErr(res, 401, '请先登录');
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return jsonErr(res, 404, '用户不存在');
    }

    const openid = await resolveOpenidFromCode(code);
    const existing = await User.findOne({ where: { openid } });
    if (existing && String(existing.id) !== userId) {
      return jsonErr(res, 409, '该微信已绑定其他账号');
    }

    const oldOpenid = user.openid;
    user.openid = openid;
    await user.save();

    return jsonOk(res, {
      msg: '微信绑定成功',
      user: formatUserPayload(user),
      data: { old_openid: oldOpenid || null, openid }
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ code: 400, error: error.message, details: error.details });
    }
    console.error('bindWx error:', error);
    return jsonErr(res, 500, '绑定失败');
  }
};

/** POST /api/v1/auth/sms/send */
exports.sendSmsCode = async (req, res) => {
  try {
    const { phone, type } = req.body || {};
    if (!phone) return jsonErr(res, 400, '缺少 phone');
    const allow = ['register', 'forget_password', 'login'];
    const t = allow.includes(type) ? type : 'register';
    return res.json({
      code: 0,
      msg: '发送成功',
      data: {
        phone: String(phone),
        type: t,
        code: '024680',
        expires_in: 300
      }
    });
  } catch (e) {
    console.error('sendSmsCode error:', e);
    return jsonErr(res, 500, '发送验证码失败');
  }
};

/** POST /api/v1/auth/password_reset */
exports.passwordReset = async (req, res) => {
  try {
    const { phone, code, new_password } = req.body || {};
    if (!phone || !code || !new_password) {
      return jsonErr(res, 400, '缺少 phone/code/new_password');
    }
    if (!verifySmsCode(code)) {
      return jsonErr(res, 400, '验证码错误');
    }
    const user = await User.findOne({ where: { phone: String(phone) } });
    if (!user) return jsonErr(res, 404, '用户不存在');

    applyPasswordFields(user, new_password);
    user.token_version = Number(user.token_version || 0) + 1;
    await user.save();

    return res.json({ code: 0, msg: '重置成功', data: null });
  } catch (e) {
    console.error('passwordReset error:', e);
    return jsonErr(res, 500, '重置失败');
  }
};

/** POST /api/v1/auth/logout */
exports.logout = async (req, res) => {
  try {
    const { resolveUserId } = require('../utils/resolveUserId');
    const userId = resolveUserId(req.user && req.user.id);
    if (!userId) {
      return jsonErr(res, 401, '未登录');
    }
    const user = await User.findByPk(userId);
    if (!user) {
      return jsonErr(res, 404, '用户不存在');
    }
    user.token_version = Number(user.token_version || 0) + 1;
    await user.save();
    return res.json({ code: 0, msg: 'ok', data: { token_version: user.token_version } });
  } catch (e) {
    console.error('Logout Error:', e);
    return jsonErr(res, 500, '服务器内部错误');
  }
};

/** POST /api/v1/auth/admin/login — 逻辑不变 */
exports.adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME || 'wsxCDE';
    const adminPass = String(process.env.ADMIN_PASSWORD || '').trim();

    const isProduction = process.env.NODE_ENV === 'production';
    const forcePassword = process.env.ADMIN_FORCE_PASSWORD === '1';
    const skipPassword =
      process.env.DEBUG_ADMIN_LOGIN === '1' || (!isProduction && !forcePassword);

    if (skipPassword) {
      const u =
        username && typeof username === 'string' && String(username).trim()
          ? String(username).trim()
          : adminUser;
      if (!isProduction) {
        console.warn('[admin/login] 开发模式：已跳过密码校验');
      }
      const token = jwt.sign(
        { sub: u, admin: true },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );
      return res.json({ message: '登录成功', data: { token, username: u } });
    }

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: '缺少用户名' });
    }
    if (password === undefined || password === null || String(password) === '') {
      return res.status(400).json({ error: '请输入密码' });
    }
    if (username !== adminUser) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    if (!adminPass) {
      return res.status(503).json({ error: '服务端未配置 ADMIN_PASSWORD' });
    }
    if (String(password) !== adminPass) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const token = jwt.sign(
      { sub: username, admin: true },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '1d' }
    );
    res.json({ message: '登录成功', data: { token, username } });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
