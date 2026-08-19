'use strict';

const db = require('../../../models');
const delivery = require('../../../services/marketDelivery.service');
const shopBinding = require('../../../services/shopDeliveryBinding.service');
const { resolveUserIdFromReq } = require('../../../utils/resolveUserId');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });

/** 254 商家门户用 req.merchantAuth.shop_id + MarketShop；本地开发可用 MerchantShop.user_id */
async function resolveShopForMerchant(req) {
  const shopId = req.merchantAuth && req.merchantAuth.shop_id;
  const MarketShop = db.MarketShop;
  const MerchantShop = db.MerchantShop;
  const ShopModel = MarketShop || MerchantShop;
  if (!ShopModel) return null;
  if (shopId) {
    return ShopModel.findByPk(shopId);
  }
  const userId = resolveUserIdFromReq(req);
  if (!userId || !MerchantShop) return null;
  return MerchantShop.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC']]
  });
}

// POST /market/merchant/orders/:orderNo/delivery/launch
exports.merchantLaunch = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const orderNo = String(req.params.orderNo || '').trim();
    const provider = String((req.body || {}).provider || '').trim();
    const order = await db.MarketOrder.findOne({ where: { order_no: orderNo, shop_id: shop.id } });
    if (!order) return fail(res, '订单不存在', 404);
    const job = await delivery.launchDelivery(order, shop, provider);
    const view = await delivery.getDeliveryView(orderNo);
    ok(res, { job_id: job.id, provider: job.provider, ...view }, '配送已发起');
  } catch (e) {
    console.error('[delivery/launch]', e);
    fail(res, e.message || '发起配送失败', 400);
  }
};

// GET /market/merchant/orders/:orderNo/delivery/track
exports.merchantTrack = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const orderNo = String(req.params.orderNo || '').trim();
    const order = await db.MarketOrder.findOne({ where: { order_no: orderNo, shop_id: shop.id } });
    if (!order) return fail(res, '订单不存在', 404);
    const view = await delivery.getDeliveryView(orderNo);
    ok(res, view);
  } catch (e) {
    fail(res, e.message || '查询失败', 500);
  }
};

// GET /market/merchant/orders/:orderNo/delivery/options
exports.merchantOptions = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const orderNo = String(req.params.orderNo || '').trim();
    const order = await db.MarketOrder.findOne({ where: { order_no: orderNo, shop_id: shop.id } });
    if (!order) return fail(res, '订单不存在', 404);
    ok(res, {
      order_no: orderNo,
      delivery_mode: order.delivery_mode,
      current_carrier: order.delivery_carrier,
      providers: await delivery.listProviderOptionsForShop(order.delivery_mode, shop.id),
      mock_mode: delivery.useMock(),
      shop_id: shop.id
    });
  } catch (e) {
    fail(res, e.message || '查询失败', 500);
  }
};

// GET /market/orders/:orderNo/delivery/track — 买家
exports.buyerTrack = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const order = await db.MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!order) return fail(res, '订单不存在', 404);
    const view = await delivery.getDeliveryView(orderNo);
    ok(res, view);
  } catch (e) {
    fail(res, e.message || '查询失败', 500);
  }
};

function mergeWebhookPayload(req) {
  return Object.assign({}, req.query || {}, req.body || {});
}

// POST /market/delivery/webhook/meituan — application/x-www-form-urlencoded
exports.webhookMeituan = async (req, res) => {
  try {
    const result = await delivery.handleWebhook('meituan', mergeWebhookPayload(req));
    if (result.ok === false && result.reason === 'invalid_sign') {
      return res.status(403).json({ code: 1, msg: 'invalid sign' });
    }
    res.json({ code: 0, msg: 'ok' });
  } catch (e) {
    console.error('[delivery/webhook/meituan]', e);
    res.status(500).json({ code: 1, msg: 'fail' });
  }
};

// POST /market/delivery/webhook/eleme
exports.webhookEleme = async (req, res) => {
  try {
    const result = await delivery.handleWebhook('eleme', mergeWebhookPayload(req));
    if (result.ok === false) {
      return res.json({ code: 0, msg: 'ignored' });
    }
    res.json({ code: 0, msg: 'ok' });
  } catch (e) {
    console.error('[delivery/webhook/eleme]', e);
    res.status(500).json({ code: 1, msg: 'fail' });
  }
};

// GET /market/merchant/delivery/bindings
exports.merchantBindings = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const bindings = await shopBinding.getBindingsView(shop.id);
    ok(res, {
      shop_id: shop.id,
      shop_name: shop.name || shop.shop_name,
      bindings,
      mock_mode: delivery.useMock()
    });
  } catch (e) {
    console.error('[delivery/bindings]', e);
    fail(res, e.message || '查询失败', 500);
  }
};

// POST /market/merchant/delivery/bindings/meituan/register
exports.merchantBindMeituanRegister = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const result = await shopBinding.registerShopOnMeituan(shop);
    ok(res, {
      shop_id: shop.id,
      external_shop_id: result.external_shop_id,
      meituan_status: result.meituan_status,
      binding: shopBinding.bindingToView(result.binding)
    }, '美团门店注册成功');
  } catch (e) {
    console.error('[delivery/bindings/meituan/register]', e);
    fail(res, e.message || '注册失败', 400);
  }
};

// POST /market/merchant/delivery/bindings/meituan/test
exports.merchantBindMeituanTest = async (req, res) => {
  try {
    if (!req.merchantAuth && !resolveUserIdFromReq(req)) return fail(res, '未登录', 401);
    const shop = await resolveShopForMerchant(req);
    if (!shop) return fail(res, '暂无店铺', 404);
    const externalShopId = String((req.body || {}).external_shop_id || 'test_0001').trim();
    const binding = await shopBinding.bindMeituanTestShop(shop, externalShopId);
    ok(res, {
      shop_id: shop.id,
      external_shop_id: externalShopId,
      binding: shopBinding.bindingToView(binding)
    }, '美团测试门店绑定成功');
  } catch (e) {
    console.error('[delivery/bindings/meituan/test]', e);
    fail(res, e.message || '绑定失败', 400);
  }
};
