const crypto = require('crypto');
const {
  MarketOrder,
  MarketPayTransaction,
  User
} = require('../models');
const wechat = require('../utils/wechatPayV3');
const { applyServiceOrderStatusAfterPayment } = require('../utils/serviceOrderPaidTransition');
const orderPoints = require('../services/orderPoints.service');
let commissionService = null;
try {
  commissionService = require('../modules/commission/services/commission.service');
} catch (e) { /* optional */ }

function ok(data) {
  return { code: 0, msg: 'ok', data };
}

function bizError(res, code, msg) {
  return res.status(200).json({ code, msg, data: null });
}

function getUserId(req) {
  return req.user && req.user.id != null ? String(req.user.id) : null;
}

async function applyMarketOrderPaidSideEffects(order) {
  try {
    await orderPoints.grantPointsOnOrderPaid(MarketOrder, order, null);
  } catch (pe) {
    console.warn('[market/points]', pe.message);
  }
  if (!commissionService) return;
  try {
    const payAmount = Number(order.payable_amount || order.pay_amount || order.total_amount || order.amount || 0);
    const pool = Number(order.platform_fee_amount || 0);
    if (payAmount > 0 && pool > 0) {
      await commissionService.distributeCommission(order.order_no, 'market', payAmount, order.user_id, pool);
    } else if (payAmount > 0) {
      await commissionService.distributeCommission(order.order_no, 'market', payAmount, order.user_id);
    }
  } catch (ce) {
    console.warn('[market/commission]', ce.message);
  }
}

/**
 * 支付成功落库（回调 / V3 查单补偿共用，幂等）
 * @param {object} tx MarketPayTransaction
 * @param {object} payData 微信 plain 或查单结果（trade_state, transaction_id, success_time, out_trade_no）
 * @param {{ source?: string, notifyRaw?: object }} opts
 */
async function applyMarketPaySuccess(tx, payData, opts = {}) {
  const { source = 'callback', notifyRaw = null } = opts;
  const tradeState = payData && payData.trade_state;

  if (notifyRaw) {
    tx.notify_raw = notifyRaw;
    tx.notify_count = (tx.notify_count || 0) + 1;
    tx.last_notify_at = new Date();
  }

  if (tx.pay_status === 'success') {
    if (notifyRaw) await tx.save();
    return { applied: false, idempotent: true };
  }

  if (tradeState && tradeState !== 'SUCCESS') {
    tx.pay_status = 'failed';
    if (notifyRaw) await tx.save();
    return { applied: false, failed: true };
  }

  if (tradeState !== 'SUCCESS') {
    return { applied: false };
  }

  tx.pay_status = 'success';
  tx.transaction_id = payData.transaction_id || null;
  tx.paid_at = payData.success_time ? new Date(payData.success_time) : new Date();
  await tx.save();

  if (tx.order_no && tx.order_no.startsWith('SO')) {
    const { ServiceOrder } = require('../models');
    const order = await ServiceOrder.findOne({ where: { order_no: tx.order_no } });
    if (order && order.pay_status !== 'paid') {
      order.pay_status = 'paid';
      applyServiceOrderStatusAfterPayment(order);
      await order.save();
    }
    return { applied: true, orderType: 'service' };
  }

  const order = await MarketOrder.findOne({ where: { order_no: tx.order_no } });
  if (order && order.pay_status !== 'paid') {
    order.pay_status = 'paid';
    order.order_status = 'pending_accept';
    order.paid_at = tx.paid_at;
    await order.save();
    await applyMarketOrderPaidSideEffects(order);
    console.log(
      `[market/pay] 落库成功 source=${source} order_no=${tx.order_no} out_trade_no=${tx.out_trade_no} tx=${payData.transaction_id || ''}`
    );
  }
  return { applied: true, orderType: 'market' };
}

/** unpaid + tx created 时主动向微信查单并补偿落库 */
async function trySyncPaymentFromWechat(order, tx) {
  if (!order || order.pay_status === 'paid') return false;
  if (!tx || tx.pay_status !== 'created' || !tx.out_trade_no) return false;
  if (!wechat.isWechatPayConfigured()) return false;

  try {
    const wxData = await wechat.queryJsapiOrderByOutTradeNo(tx.out_trade_no);
    if (wxData.trade_state !== 'SUCCESS') return false;
    const result = await applyMarketPaySuccess(tx, wxData, {
      source: 'status-query-sync',
      notifyRaw: { source: 'payments/status-query-sync', wx: wxData }
    });
    return result.applied;
  } catch (e) {
    console.warn('[market/payments/status] V3 查单补偿失败:', tx.out_trade_no, e.message || e);
    return false;
  }
}

function genOutTradeNo(orderNo) {
  const rnd = Math.floor(Math.random() * 900000) + 100000;
  // 微信 out_trade_no 最长 32 字符
  return `${Date.now()}${rnd}`.slice(0, 32);
}

function isVirtualPayWhenWechatMissing() {
  return process.env.MARKET_PAY_VIRTUAL_SUCCESS !== 'false';
}

/** 未配置微信商户时的临时联调：占位五参 + 直接记已支付（勿用于生产真实收款） */
function buildVirtualWxPayParams() {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=VIRTUAL_${timeStamp}_${crypto.randomBytes(6).toString('hex')}`;
  const paySign = `VIRTUAL_${crypto.randomBytes(32).toString('hex')}`;
  return {
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign,
    time_stamp: timeStamp,
    nonce_str: nonceStr,
    sign_type: 'RSA',
    pay_sign: paySign
  };
}

async function virtualPaySuccessFlow(order, orderNo) {
  let tx = await MarketPayTransaction.findOne({ where: { order_no: orderNo, pay_status: 'created' } });
  if (!tx) {
    tx = await MarketPayTransaction.create({
      order_no: orderNo,
      out_trade_no: genOutTradeNo(orderNo),
      channel: 'wechat_jsapi',
      pay_status: 'created',
      amount: order.payable_amount
    });
  }
  const now = new Date();
  tx.pay_status = 'success';
  tx.transaction_id = `VIRTUAL_TX_${Date.now()}`;
  tx.paid_at = now;
  tx.notify_raw = { source: 'payments/create-virtual-no-wx-config', order_no: orderNo };
  tx.notify_count = (tx.notify_count || 0) + 1;
  tx.last_notify_at = now;
  await tx.save();

  order.pay_status = 'paid';
  order.order_status = 'pending_accept';
  order.paid_at = now;
  await order.save();

  await applyMarketOrderPaidSideEffects(order);

  return { tx, wxPayParams: buildVirtualWxPayParams() };
}

async function unifiedOrderWithRetry(tx, order, user) {
  const notifyUrl = process.env.WX_PAY_NOTIFY_URL;
  if (!notifyUrl) {
    throw new Error('缺少 WX_PAY_NOTIFY_URL（须为外网 HTTPS 可访问的完整回调地址）');
  }
  const amountFen = wechat.yuanToFen(order.payable_amount);
  const description = `本地集市订单 ${order.order_no}`.slice(0, 127);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await wechat.jsapiUnifiedOrder({
        out_trade_no: tx.out_trade_no,
        description,
        amountFen,
        notify_url: notifyUrl,
        openid: user.openid
      });
      return resp;
    } catch (e) {
      lastErr = e;
      const code = e.body && e.body.code;
      const detail = (e.body && (e.body.detail || e.body.message)) || '';
      const dup =
        code === 'INVALID_REQUEST' ||
        /商户订单号|out_trade_no|重复|已存在/i.test(String(detail));
      if (attempt === 0 && dup) {
        tx.out_trade_no = genOutTradeNo(order.order_no);
        await tx.save();
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// POST /api/v1/market/payments/create
exports.createPayment = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return bizError(res, 401, '未登录');
    const { order_no } = req.body;
    if (!order_no) return res.status(400).json({ code: 400, msg: '缺少 order_no', data: null });

    const order = await MarketOrder.findOne({ where: { order_no, user_id: userId } });
    if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });
    if (order.order_status !== 'pending_payment' || order.pay_status !== 'unpaid') {
      return bizError(res, 20031, '订单状态不允许发起支付');
    }

    if (!wechat.isWechatPayConfigured()) {
      if (!isVirtualPayWhenWechatMissing()) {
        const cfg = wechat.getWechatPayConfigStatus();
        const parts = [];
        if (cfg.missing.length) parts.push(`缺少/非法: ${cfg.missing.join('、')}`);
        if (cfg.privateKeyLoadError) parts.push(`私钥读取失败: ${cfg.privateKeyLoadError}`);
        parts.push('请确认是当前运行进程读取到这些环境变量（修改 .env 后需重启服务）');
        return bizError(res, 20044, `未配置微信支付，${parts.join('；')}`);
      }
      console.warn(
        '[market/payments/create] 未配置 WX_PAY_*，临时虚拟支付：订单将直接记为已支付；配置真支付后请设 MARKET_PAY_VIRTUAL_SUCCESS=false 或补齐环境变量'
      );
      const { tx, wxPayParams } = await virtualPaySuccessFlow(order, order_no);
      return res.json(
        ok({
          order_no,
          out_trade_no: tx.out_trade_no,
          amount: String(tx.amount),
          pay_mode: 'virtual',
          virtual_pay: true,
          payment_mode: 'virtual',
          wx_pay_params: wxPayParams,
          payment: { wx_pay_params: wxPayParams },
          jsapi: wxPayParams,
          timeStamp: wxPayParams.timeStamp,
          nonceStr: wxPayParams.nonceStr,
          package: wxPayParams.package,
          signType: wxPayParams.signType,
          paySign: wxPayParams.paySign,
          time_stamp: wxPayParams.time_stamp,
          nonce_str: wxPayParams.nonce_str
        })
      );
    }

    const user = await User.findByPk(userId);
    if (!user || !user.openid) {
      return bizError(res, 20043, '用户未绑定微信 openid，无法发起小程序支付');
    }

    const amountFen = wechat.yuanToFen(order.payable_amount);
    if (amountFen <= 0) {
      return bizError(res, 20046, '订单金额为 0，请与运营确认是否免支付流程');
    }

    let tx = await MarketPayTransaction.findOne({ where: { order_no, pay_status: 'created' } });
    if (!tx) {
      const outTradeNo = genOutTradeNo(order_no);
      tx = await MarketPayTransaction.create({
        order_no,
        out_trade_no: outTradeNo,
        channel: 'wechat_jsapi',
        pay_status: 'created',
        amount: order.payable_amount
      });
    } else if (tx.out_trade_no && tx.out_trade_no.length > 32) {
      tx.out_trade_no = genOutTradeNo(order_no);
      await tx.save();
    }

    let prepayResp;
    try {
      prepayResp = await unifiedOrderWithRetry(tx, order, user);
    } catch (e) {
      console.error('wechat jsapi unified order:', e.body || e.message);
      const msg =
        (e.body && (e.body.message || e.body.detail)) ||
        e.message ||
        '微信统一下单失败';
      return bizError(res, 20045, String(msg).slice(0, 200));
    }

    const prepayId = prepayResp && prepayResp.prepay_id;
    if (!prepayId) {
      return bizError(res, 20045, '微信未返回 prepay_id');
    }

    const pay = wechat.buildJsapiPayParams(prepayId);
    // 与《06_BE》第 4 节对齐：五参数优先放在 wx_pay_params；蛇形别名与 payment 嵌套供前端递归解析
    const wxPayParams = {
      timeStamp: pay.timeStamp,
      nonceStr: pay.nonceStr,
      package: pay.package,
      signType: pay.signType,
      paySign: pay.paySign,
      time_stamp: pay.timeStamp,
      nonce_str: pay.nonceStr,
      sign_type: pay.signType,
      pay_sign: pay.paySign
    };

    return res.json(
      ok({
        order_no,
        out_trade_no: tx.out_trade_no,
        amount: String(tx.amount),
        pay_mode: 'wechat',
        virtual_pay: false,
        payment_mode: 'wechat',
        wx_pay_params: wxPayParams,
        payment: { wx_pay_params: wxPayParams },
        jsapi: wxPayParams,
        timeStamp: pay.timeStamp,
        nonceStr: pay.nonceStr,
        package: pay.package,
        signType: pay.signType,
        paySign: pay.paySign,
        time_stamp: pay.timeStamp,
        nonce_str: pay.nonceStr
      })
    );
  } catch (e) {
    console.error('payments/create error:', e);
    res.status(500).json({ code: 500, msg: '支付创建失败', data: null });
  }
};

// GET /api/v1/market/payments/create
// 用于快速识别“POST 被错误改成 GET”的网关/重定向问题，避免返回默认 Cannot GET 文本。
exports.createPaymentGetNotAllowed = async (req, res) => {
  return res.status(405).json({
    code: 405,
    msg: '该接口仅支持 POST /api/v1/market/payments/create；请检查是否发生 301/302 重定向导致方法从 POST 变为 GET（应使用 307/308）',
    data: null
  });
};

// GET /api/v1/market/payments/status?order_no=xxx
exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return bizError(res, 401, '未登录');
    const orderNo = String(req.query.order_no || '').trim();
    if (!orderNo) return res.status(400).json({ code: 400, msg: '缺少 order_no', data: null });

    const order = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });

    const tx = await MarketPayTransaction.findOne({ where: { order_no: orderNo }, order: [['created_at', 'DESC']] });

    if (order.pay_status !== 'paid' && tx && tx.pay_status === 'created' && tx.out_trade_no) {
      await trySyncPaymentFromWechat(order, tx);
      await order.reload();
      if (tx) await tx.reload();
    }

    res.json(
      ok({
        order_no: orderNo,
        order_status: order.order_status,
        pay_status: order.pay_status,
        tx_pay_status: tx ? tx.pay_status : null,
        out_trade_no: tx ? tx.out_trade_no : null,
        paid_at: order.paid_at || null
      })
    );
  } catch (e) {
    console.error('payments/status error:', e);
    res.status(500).json({ code: 500, msg: '查询支付状态失败', data: null });
  }
};

// POST /api/v1/market/pay/callback（不走 JWT）
function verifyLegacySignature(req) {
  const secret = process.env.PAY_CALLBACK_SECRET;
  if (!secret) return { ok: false, msg: 'missing PAY_CALLBACK_SECRET' };
  const { out_trade_no, trade_state, transaction_id, paid_at, signature } = req.body || {};
  const base = `out_trade_no=${out_trade_no}&trade_state=${trade_state}&transaction_id=${transaction_id || ''}&paid_at=${paid_at || ''}`;
  const sign = crypto.createHmac('sha256', secret).update(base).digest('hex');
  if (sign !== signature) return { ok: false, msg: 'invalid signature' };
  return { ok: true };
}

exports.payCallback = async (req, res) => {
  try {
    const rawStr = req.rawBodyForWechat || '';
    const wechatSig = req.headers['wechatpay-signature'];

    if (wechatSig && !wechat.isWechatPayConfigured()) {
      console.error('pay/callback: Wechatpay-Signature present but WX_PAY_* not configured');
      return res.status(503).json({ code: 'FAIL', message: '微信支付商户未配置' });
    }

    if (wechatSig && wechat.isWechatPayConfigured()) {
      let parsed;
      try {
        parsed = await wechat.parsePayNotification(req.headers, rawStr);
      } catch (err) {
        const peek = wechat.tryPeekNotifyPlain(rawStr);
        const serial = req.headers['wechatpay-serial'] || '';
        console.error(
          'pay/callback v3 verify:',
          err.message,
          peek ? `out_trade_no=${peek.out_trade_no}` : 'out_trade_no=unknown',
          `serial=${serial}`
        );
        return res.status(401).json({ code: 'FAIL', message: err.message || '验签失败' });
      }

      const { plain, outer } = parsed;
      const outTradeNo = plain.out_trade_no;

      const tx = await MarketPayTransaction.findOne({ where: { out_trade_no: outTradeNo } });
      if (!tx) {
        console.warn('pay/callback: unknown out_trade_no', outTradeNo);
        return res.status(200).json(wechat.wechatSuccessBody());
      }

      await applyMarketPaySuccess(tx, plain, {
        source: 'callback',
        notifyRaw: { v3_plain: plain, v3_outer: outer }
      });

      return res.status(200).json(wechat.wechatSuccessBody());
    }

    // 一期自定义 HMAC（联调/迁移期保留）
    const verify = verifyLegacySignature(req);
    if (!verify.ok) {
      const isDev = process.env.NODE_ENV !== 'production';
      return res.status(401).json({
        code: 20042,
        msg: '回调验签失败',
        data: null,
        ...(isDev && { errMsg: verify.msg })
      });
    }

    const { out_trade_no, trade_state, transaction_id, paid_at } = req.body;
    const tx = await MarketPayTransaction.findOne({ where: { out_trade_no } });
    if (!tx) {
      return res.json({ code: 0, msg: 'SUCCESS', data: null });
    }

    const legacyResult = await applyMarketPaySuccess(tx, {
      trade_state,
      transaction_id,
      success_time: paid_at,
      out_trade_no
    }, {
      source: 'legacy-callback',
      notifyRaw: req.body
    });

    return res.json({
      code: 0,
      msg: 'SUCCESS',
      data: legacyResult.idempotent ? { idempotent: true } : null
    });
  } catch (e) {
    console.error('pay/callback error:', e);
    return res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
};

// POST /api/v1/market/payments/mock-success (开发联调专用，需登录)
exports.mockSuccess = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ code: 403, msg: '生产环境禁用该接口', data: null });
    }

    const userId = getUserId(req);
    if (!userId) return bizError(res, 401, '未登录');
    const { order_no, out_trade_no, transaction_id, paid_at } = req.body || {};
    if (!order_no && !out_trade_no) {
      return res.status(400).json({ code: 400, msg: '缺少 order_no 或 out_trade_no', data: null });
    }

    let tx = null;
    let order = null;

    if (out_trade_no) {
      tx = await MarketPayTransaction.findOne({ where: { out_trade_no } });
      if (!tx) return res.status(404).json({ code: 404, msg: '支付流水不存在', data: null });
      order = await MarketOrder.findOne({ where: { order_no: tx.order_no, user_id: userId } });
    } else {
      order = await MarketOrder.findOne({ where: { order_no, user_id: userId } });
      if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });
      tx = await MarketPayTransaction.findOne({ where: { order_no: order.order_no }, order: [['created_at', 'DESC']] });
      if (!tx) return bizError(res, 20041, '支付流水不存在，请先创建支付单');
    }

    if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });

    if (tx.pay_status !== 'success') {
      tx.pay_status = 'success';
      tx.transaction_id = transaction_id || `MOCK_TX_${Date.now()}`;
      tx.paid_at = paid_at ? new Date(paid_at) : new Date();
      tx.notify_raw = {
        source: 'mock-success-api',
        order_no: order.order_no,
        out_trade_no: tx.out_trade_no
      };
      tx.notify_count = (tx.notify_count || 0) + 1;
      tx.last_notify_at = new Date();
      await tx.save();
    }

    if (order.pay_status !== 'paid' || order.order_status !== 'pending_accept') {
      order.pay_status = 'paid';
      order.order_status = 'pending_accept';
      order.paid_at = tx.paid_at || new Date();
      await order.save();
      await applyMarketOrderPaidSideEffects(order);
    }

    return res.json(
      ok({
        order_no: order.order_no,
        out_trade_no: tx.out_trade_no,
        order_status: order.order_status,
        pay_status: order.pay_status,
        tx_pay_status: tx.pay_status,
        paid_at: tx.paid_at
      })
    );
  } catch (e) {
    console.error('payments/mock-success error:', e);
    return res.status(500).json({ code: 500, msg: '模拟支付成功失败', data: null });
  }
};
