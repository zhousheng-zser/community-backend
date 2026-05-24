'use strict';

const crypto = require('crypto');
const { postForm } = require('./deliveryHttp');

const API_BASE = process.env.MEITUAN_API_BASE || 'https://peisongopen.meituan.com/api';

function getConfig() {
  return {
    appKey: process.env.MEITUAN_APP_KEY || '',
    secret: process.env.MEITUAN_SECRET || '',
    shopId: process.env.MEITUAN_SHOP_ID || '',
    serviceCode: parseInt(process.env.MEITUAN_SERVICE_CODE || '4012', 10),
    payTypeCode: parseInt(process.env.MEITUAN_PAY_TYPE || '0', 10),
    orderSource: process.env.MEITUAN_ORDER_SOURCE || '202'
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.appKey && c.secret && c.shopId);
}

/** 美团配送签名：secret + 按 key 排序拼接 key+value，SHA1 小写 */
function buildSign(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort();
  let str = secret;
  keys.forEach((k) => { str += k + String(params[k]); });
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex').toLowerCase();
}

function toCoordInt(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e6);
}

async function invoke(method, bizParams) {
  const cfg = getConfig();
  if (!cfg.appKey || !cfg.secret) {
    throw new Error('美团配送未配置 MEITUAN_APP_KEY / MEITUAN_SECRET');
  }
  const params = Object.assign({}, bizParams, {
    appkey: cfg.appKey,
    timestamp: Math.floor(Date.now() / 1000),
    version: '1.0'
  });
  params.sign = buildSign(params, cfg.secret);
  const url = `${API_BASE.replace(/\/$/, '')}/${method}`;
  const res = await postForm(url, params);
  if (Number(res.code) !== 0) {
    const err = new Error(res.message || `美团配送错误 code=${res.code}`);
    err.code = res.code;
    err.response = res;
    throw err;
  }
  return res.data || res;
}

/**
 * 门店发单 order/createByShop
 * @see https://peisong.meituan.com/open/doc
 */
async function createByShop(ctx) {
  const cfg = getConfig();
  const deliveryId = ctx.deliveryId || Date.now();
  const goodsDetail = JSON.stringify({
    goods: (ctx.items || [{ goodName: '集市商品', goodCount: 1, goodPrice: Number(ctx.goodsValue || 0) }]).map((it) => ({
      goodCount: Math.max(parseInt(it.goodCount || it.quantity || 1, 10) || 1, 1),
      goodName: String(it.goodName || it.goods_name_snapshot || it.name || '商品').slice(0, 128),
      goodPrice: Number(it.goodPrice || it.unit_price_snapshot || 0),
      goodUnit: it.goodUnit || '份'
    }))
  });
  const biz = {
    delivery_id: deliveryId,
    order_id: String(ctx.orderId).slice(0, 32),
    outer_order_source_desc: cfg.orderSource,
    shop_id: cfg.shopId,
    delivery_service_code: cfg.serviceCode,
    receiver_name: String(ctx.receiverName || '收货人').slice(0, 256),
    receiver_address: String(ctx.receiverAddress || '').slice(0, 512),
    receiver_phone: String(ctx.receiverPhone || '').slice(0, 64),
    receiver_lng: toCoordInt(ctx.receiverLng),
    receiver_lat: toCoordInt(ctx.receiverLat),
    coordinate_type: 0,
    goods_value: Number(ctx.goodsValue || 0).toFixed(2),
    goods_weight: Number(ctx.goodsWeight || 1).toFixed(2),
    goods_detail: goodsDetail,
    pay_type_code: cfg.payTypeCode,
    note: String(ctx.note || '').slice(0, 200)
  };
  if (!biz.receiver_lng || !biz.receiver_lat) {
    throw new Error('收货坐标缺失，下单时请选择带地图定位的收货地址');
  }
  const data = await invoke('order/createByShop', biz);
  return {
    external_order_no: data.mt_peisong_id,
    delivery_id: data.delivery_id || deliveryId,
    order_id: data.order_id || biz.order_id,
    fee: Number(data.pay_amount || data.delivery_fee || 0),
    raw: data
  };
}

async function queryStatus(ctx) {
  const data = await invoke('order/status/query', {
    delivery_id: ctx.deliveryId,
    mt_peisong_id: String(ctx.mtPeisongId || ctx.externalOrderNo)
  });
  return data;
}

function verifyWebhookSign(params) {
  const cfg = getConfig();
  if (!cfg.secret) return false;
  const sign = params.sign;
  if (!sign) return false;
  const expected = buildSign(params, cfg.secret);
  return String(sign).toLowerCase() === expected;
}

/** 美团 status: 0待调度 20已接单 30已取货 50已送达 99已取消 */
function mapStatus(mtStatus) {
  const s = Number(mtStatus);
  if (s === 0) return 'waiting_rider';
  if (s === 20) return 'rider_accepted';
  if (s === 30) return 'picked_up';
  if (s === 50) return 'delivered';
  if (s === 99) return 'cancelled';
  return null;
}

module.exports = {
  getConfig,
  isConfigured,
  buildSign,
  createByShop,
  queryStatus,
  verifyWebhookSign,
  mapStatus,
  toCoordInt
};
