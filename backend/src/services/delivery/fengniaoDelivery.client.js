'use strict';

const crypto = require('crypto');
const { getJson, postJson } = require('./deliveryHttp');

const API_BASE = process.env.ELEME_API_BASE || 'https://open-anubis.ele.me/anubis-webapi';
const TOKEN_TTL_MS = 50 * 60 * 1000;

let tokenCache = { token: '', expireAt: 0 };

function getConfig() {
  return {
    appId: process.env.ELEME_APP_KEY || process.env.ELEME_APP_ID || '',
    secret: process.env.ELEME_SECRET || process.env.ELEME_SECRET_KEY || '',
    chainStoreCode: process.env.ELEME_CHAIN_STORE_CODE || process.env.ELEME_SHOP_ID || '',
    notifyUrl: process.env.ELEME_NOTIFY_URL || '',
    orderType: parseInt(process.env.ELEME_ORDER_TYPE || '1', 10)
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.appId && c.secret);
}

function randomSalt() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function urlencode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+');
}

function tokenSign(appId, salt, secret) {
  const seed = `app_id=${appId}&salt=${salt}&secret_key=${secret}`;
  return crypto.createHash('md5').update(urlencode(seed), 'utf8').digest('hex').toLowerCase();
}

function businessSign(appId, token, dataEncoded, salt) {
  const seed = `app_id=${appId}&access_token=${token}&data=${dataEncoded}&salt=${salt}`;
  return crypto.createHash('md5').update(seed, 'utf8').digest('hex').toLowerCase();
}

async function fetchToken(force) {
  const cfg = getConfig();
  if (!cfg.appId || !cfg.secret) throw new Error('蜂鸟配送未配置 ELEME_APP_KEY / ELEME_SECRET');
  if (!force && tokenCache.token && tokenCache.expireAt > Date.now()) {
    return tokenCache.token;
  }
  const salt = randomSalt();
  const signature = tokenSign(cfg.appId, salt, cfg.secret);
  const url = `${API_BASE}/get_access_token?app_id=${encodeURIComponent(cfg.appId)}&salt=${salt}&signature=${signature}`;
  const res = await getJson(url);
  const token = (res.data && res.data.access_token) || res.access_token;
  if (!token) {
    throw new Error(res.message || res.msg || '获取蜂鸟 access_token 失败');
  }
  tokenCache = { token, expireAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function invoke(cmd, data, retry) {
  const cfg = getConfig();
  const token = await fetchToken(false);
  const salt = randomSalt();
  const dataJson = JSON.stringify(data);
  const dataEncoded = urlencode(dataJson);
  const signature = businessSign(cfg.appId, token, dataEncoded, salt);
  const url = `${API_BASE}/v2/${cmd.replace(/^\//, '')}`;
  const res = await postJson(url, {
    app_id: cfg.appId,
    salt,
    data: dataEncoded,
    signature
  });
  const code = res.code != null ? Number(res.code) : (res.errno != null ? Number(res.errno) : 0);
  if (code !== 0 && code !== 200) {
    if (!retry && (code === 401 || /token/i.test(String(res.message || res.msg || '')))) {
      tokenCache = { token: '', expireAt: 0 };
      return invoke(cmd, data, true);
    }
    throw new Error(res.message || res.msg || `蜂鸟配送错误 code=${code}`);
  }
  return res.data != null ? res.data : res;
}

function buildNotifyUrl() {
  const cfg = getConfig();
  if (cfg.notifyUrl) return cfg.notifyUrl;
  const base = process.env.DELIVERY_WEBHOOK_BASE || process.env.PUBLIC_API_BASE || '';
  if (!base) return '';
  return `${String(base).replace(/\/$/, '')}/market/delivery/webhook/eleme`;
}

/**
 * 创建配送单 POST /v2/order
 */
async function createOrder(ctx) {
  const cfg = getConfig();
  const partnerCode = String(ctx.orderId).slice(0, 64);
  const now = Date.now();
  const items = (ctx.items || []).map((it, idx) => ({
    item_id: String(it.goods_id || it.item_id || `g${idx}`),
    item_name: String(it.goods_name_snapshot || it.goodName || it.name || '商品').slice(0, 128),
    item_quantity: Math.max(parseInt(it.quantity || it.goodCount || 1, 10) || 1, 1),
    item_price: Number(it.unit_price_snapshot || it.goodPrice || 0),
    item_actual_price: Number(it.amount || it.item_actual_price || it.unit_price_snapshot || 0),
    item_size: 1
  }));
  if (!items.length) {
    items.push({
      item_id: 'default',
      item_name: '集市商品',
      item_quantity: 1,
      item_price: Number(ctx.goodsValue || 0),
      item_actual_price: Number(ctx.goodsValue || 0),
      item_size: 1
    });
  }
  const payload = {
    partner_order_code: partnerCode,
    partner_remark: String(ctx.note || '').slice(0, 200),
    order_type: cfg.orderType,
    notify_url: buildNotifyUrl(),
    chain_store_code: ctx.chainStoreCode || cfg.chainStoreCode || undefined,
    transport_info: {
      transport_name: String(ctx.shopName || '门店').slice(0, 64),
      transport_address: String(ctx.shopAddress || '').slice(0, 255),
      transport_longitude: Number(ctx.shopLng),
      transport_latitude: Number(ctx.shopLat),
      position_source: 3,
      transport_tel: String(ctx.shopPhone || '').slice(0, 20),
      transport_remark: ''
    },
    order_add_time: now,
    order_total_amount: Number(ctx.goodsValue || 0),
    order_actual_amount: Number(ctx.payableAmount || ctx.goodsValue || 0),
    order_weight: Number(ctx.goodsWeight || 1),
    order_remark: String(ctx.note || ''),
    order_payment_status: 1,
    order_payment_method: 1,
    goods_count: items.reduce((s, it) => s + (it.item_quantity || 1), 0),
    receiver_info: {
      receiver_name: String(ctx.receiverName || '收货人').slice(0, 32),
      receiver_primary_phone: String(ctx.receiverPhone || '').slice(0, 20),
      receiver_address: String(ctx.receiverAddress || '').slice(0, 255),
      receiver_longitude: Number(ctx.receiverLng),
      receiver_latitude: Number(ctx.receiverLat),
      position_source: 3
    },
    items_json: items
  };
  if (!payload.transport_info.transport_longitude || !payload.transport_info.transport_latitude) {
    throw new Error('门店坐标缺失，请在店铺资料中配置经纬度');
  }
  if (!payload.receiver_info.receiver_longitude || !payload.receiver_info.receiver_latitude) {
    throw new Error('收货坐标缺失，下单时请选择带地图定位的收货地址');
  }
  const data = await invoke('order', payload);
  return {
    external_order_no: data.order_id || data.eleme_order_id || partnerCode,
    partner_order_code: partnerCode,
    fee: Number(data.order_price || data.delivery_fee || 0),
    raw: data
  };
}

async function queryOrder(partnerOrderCode) {
  return invoke('order/query', { partner_order_code: partnerOrderCode });
}

/**
 * 蜂鸟 order_status 常见：1调度 2接单 3到店 4配送 5完成 6取消
 */
function mapStatus(orderStatus) {
  const s = Number(orderStatus);
  if (s === 1) return 'waiting_rider';
  if (s === 2) return 'rider_accepted';
  if (s === 3) return 'at_shop';
  if (s === 4) return 'delivering';
  if (s === 5) return 'delivered';
  if (s === 6 || s === 7) return 'cancelled';
  return null;
}

function parseWebhookBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (e) { return {}; }
  }
  if (body.data && typeof body.data === 'string') {
    try { return JSON.parse(body.data); } catch (e) { return body; }
  }
  return body;
}

module.exports = {
  getConfig,
  isConfigured,
  createOrder,
  queryOrder,
  mapStatus,
  parseWebhookBody,
  fetchToken
};
