const crypto = require('crypto');
const {
  ServiceOrder,
  MarketPayTransaction,
  User
} = require('../models');
const wechat = require('../utils/wechatPayV3');
const { applyServiceOrderStatusAfterPayment } = require('../utils/serviceOrderPaidTransition');

function ok(data) {
  return { code: 0, msg: 'ok', data };
}

function bizError(res, code, msg) {
  return res.status(200).json({ code, msg, data: null });
}

function getUserId(req) {
  return req.user && req.user.id != null ? String(req.user.id) : null;
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
      amount: order.amount
    });
  }
  const now = new Date();
  tx.pay_status = 'success';
  tx.transaction_id = `VIRTUAL_TX_${Date.now()}`;
  tx.paid_at = now;
  tx.notify_raw = { source: 'service-payments/create-virtual-no-wx-config', order_no: orderNo };
  tx.notify_count = (tx.notify_count || 0) + 1;
  tx.last_notify_at = now;
  await tx.save();

  order.pay_status = 'paid';
  applyServiceOrderStatusAfterPayment(order);
  await order.save();

  return { tx, wxPayParams: buildVirtualWxPayParams() };
}

async function unifiedOrderWithRetry(tx, order, user) {
  const notifyUrl = process.env.WX_PAY_NOTIFY_URL;
  if (!notifyUrl) {
    throw new Error('缺少 WX_PAY_NOTIFY_URL（须为外网 HTTPS 可访问的完整回调地址）');
  }
  const amountFen = wechat.yuanToFen(order.amount);
  const description = `到家服务订单 ${order.order_no}`.slice(0, 127);
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

// POST /api/v1/service-orders/payments/create
exports.createPayment = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return bizError(res, 401, '未登录');
    const { order_no } = req.body;
    if (!order_no) return res.status(400).json({ code: 400, msg: '缺少 order_no', data: null });

    const order = await ServiceOrder.findOne({ where: { order_no, user_id: userId } });
    if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });
    if (order.status !== 'pending_pay' || order.pay_status !== 'unpaid') {
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
        '[service/payments/create] 未配置 WX_PAY_*，临时虚拟支付：订单将直接记为已支付；配置真支付后请设 MARKET_PAY_VIRTUAL_SUCCESS=false 或补齐环境变量'
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

    const amountFen = wechat.yuanToFen(order.amount);
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
        amount: order.amount
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
    console.error('service payments/create error:', e);
    res.status(500).json({ code: 500, msg: '支付创建失败', data: null });
  }
};

// GET /api/v1/service-orders/payments/status?order_no=xxx
exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return bizError(res, 401, '未登录');
    const orderNo = req.query.order_no;
    if (!orderNo) return res.status(400).json({ code: 400, msg: '缺少 order_no', data: null });

    const order = await ServiceOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!order) return res.status(404).json({ code: 404, msg: '订单不存在', data: null });

    const tx = await MarketPayTransaction.findOne({ where: { order_no: orderNo }, order: [['created_at', 'DESC']] });
    res.json(
      ok({
        order_no: orderNo,
        order_status: order.status,
        pay_status: order.pay_status,
        tx_pay_status: tx ? tx.pay_status : null,
        out_trade_no: tx ? tx.out_trade_no : null,
        paid_at: order.created_at || null
      })
    );
  } catch (e) {
    console.error('service payments/status error:', e);
    res.status(500).json({ code: 500, msg: '查询支付状态失败', data: null });
  }
};

// POST /api/v1/service-orders/payments/mock-success (开发联调专用，需登录)
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
      order = await ServiceOrder.findOne({ where: { order_no: tx.order_no, user_id: userId } });
    } else {
      order = await ServiceOrder.findOne({ where: { order_no, user_id: userId } });
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

    if (order.pay_status !== 'paid') {
      order.pay_status = 'paid';
      applyServiceOrderStatusAfterPayment(order);
      await order.save();
    }

    return res.json(
      ok({
        order_no: order.order_no,
        out_trade_no: tx.out_trade_no,
        order_status: order.status,
        pay_status: order.pay_status,
        tx_pay_status: tx.pay_status,
        paid_at: tx.paid_at
      })
    );
  } catch (e) {
    console.error('service payments/mock-success error:', e);
    return res.status(500).json({ code: 500, msg: '模拟支付成功失败', data: null });
  }
};
