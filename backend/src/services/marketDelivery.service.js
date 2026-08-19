'use strict';

/**
 * 集市订单配送：自配送 / 美团配送 / 饿了么蜂鸟即配
 * 配置 MEITUAN_* / ELEME_* 且 DELIVERY_MOCK=0 时走真实开放平台 API
 */
const db = require('../models');
const meituan = require('./delivery/meituanPeisong.client');
const fengniao = require('./delivery/fengniaoDelivery.client');
const shopBinding = require('./shopDeliveryBinding.service');

const PROVIDERS = {
  self: { code: 'self', name: '商家自配送', brand: '自配送' },
  meituan: { code: 'meituan', name: '美团配送', brand: '美团' },
  eleme: { code: 'eleme', name: '饿了么配送', brand: '饿了么' }
};

const STATUS_LABELS = {
  created: '已创建配送单',
  waiting_rider: '等待骑手接单',
  rider_accepted: '骑手已接单',
  at_shop: '骑手到店取货',
  picked_up: '骑手已取货',
  delivering: '配送中',
  delivered: '已送达',
  cancelled: '配送已取消',
  failed: '配送失败'
};

const MOCK_STEPS = [
  { code: 'waiting_rider', delaySec: 0, rider: false },
  { code: 'rider_accepted', delaySec: 20, rider: true },
  { code: 'at_shop', delaySec: 45, rider: true },
  { code: 'picked_up', delaySec: 70, rider: true },
  { code: 'delivering', delaySec: 100, rider: true },
  { code: 'delivered', delaySec: 140, rider: true }
];

function useMock() {
  if (process.env.DELIVERY_MOCK === '0') return false;
  if (process.env.DELIVERY_MOCK === '1') return true;
  return false;
}

async function providerConfigured(provider, shopId) {
  if (provider === 'self') return true;
  if (shopId != null) {
    return shopBinding.isShopProviderReady(shopId, provider);
  }
  if (provider === 'meituan') return meituan.isConfigured() && !!shopBinding.envFallbackShopId('meituan');
  if (provider === 'eleme') return fengniao.isConfigured() && !!shopBinding.envFallbackShopId('eleme');
  return false;
}

async function shouldUseMock(provider, shopId) {
  if (useMock()) return true;
  if (process.env.DELIVERY_MOCK === '0') return false;
  if (!provider) {
    if (shopId != null) {
      const mt = await providerConfigured('meituan', shopId);
      const el = await providerConfigured('eleme', shopId);
      return !(mt || el);
    }
    return !(meituan.isConfigured() || fengniao.isConfigured());
  }
  return !(await providerConfigured(provider, shopId));
}

/** 商家选项页：是否展示为模拟模式（不依赖具体店铺） */
function isGlobalMockMode() {
  if (useMock()) return true;
  if (process.env.DELIVERY_MOCK === '0') return false;
  return !(meituan.isConfigured() || fengniao.isConfigured());
}

async function ensureDeliveryTables() {
  const Job = db.MarketDeliveryJob;
  const Track = db.MarketDeliveryTrack;
  if (Job && Job.sync) await Job.sync();
  if (Track && Track.sync) await Track.sync();
}

function parsePayload(job) {
  if (!job || !job.payload_json) return {};
  try {
    return JSON.parse(job.payload_json);
  } catch (e) {
    return {};
  }
}

async function loadOrderItems(orderNo) {
  const Item = db.MarketOrderItem;
  if (!Item) return [];
  return Item.findAll({ where: { order_no: orderNo } });
}

function resolveShopGeo(shop) {
  const lat = shop.latitude != null ? Number(shop.latitude) : null;
  const lng = shop.longitude != null ? Number(shop.longitude) : null;
  return {
    shopName: shop.name || shop.shop_name || '门店',
    shopAddress: shop.address || '',
    shopPhone: shop.contact_phone || shop.phone || '',
    shopLat: lat,
    shopLng: lng
  };
}

function resolveReceiverGeo(order) {
  const lat = order.receiver_latitude != null ? Number(order.receiver_latitude) : null;
  const lng = order.receiver_longitude != null ? Number(order.receiver_longitude) : null;
  return { receiverLat: lat, receiverLng: lng };
}

async function appendTrack(job, statusCode, note, extra = {}) {
  const Track = db.MarketDeliveryTrack;
  if (!Track) return;
  const exists = await Track.findOne({
    where: { job_id: job.id, status_code: statusCode }
  });
  if (exists) return exists;
  return Track.create({
    job_id: job.id,
    order_no: job.order_no,
    status_code: statusCode,
    status_text: STATUS_LABELS[statusCode] || statusCode,
    note: note || ''
  });
}

async function applyJobStatus(job, order, statusCode, rider = {}) {
  if (!statusCode || statusCode === job.job_status) {
    if (rider.name || rider.phone) {
      await job.update({
        rider_name: rider.name || job.rider_name,
        rider_phone: rider.phone || job.rider_phone
      });
    }
    return job;
  }
  await job.update({
    job_status: statusCode,
    rider_name: rider.name || job.rider_name,
    rider_phone: rider.phone || job.rider_phone
  });
  await appendTrack(job, statusCode, PROVIDERS[job.provider]?.name || job.provider);
  if (order) await updateOrderDeliveryFields(order, job);
  return job.reload();
}

async function updateOrderDeliveryFields(order, job) {
  const patch = {
    delivery_carrier: job.provider,
    delivery_job_status: job.job_status,
    delivery_external_no: job.external_order_no || null
  };
  if (job.job_status === 'delivering' || job.job_status === 'picked_up') {
    if (order.order_status === 'pending_service') {
      patch.order_status = 'pending_receipt';
      patch.delivered_at = new Date();
    }
  }
  if (job.job_status === 'delivered') {
    patch.order_status = 'pending_receipt';
    patch.delivered_at = order.delivered_at || new Date();
  }
  await order.update(patch);
}

/** MOCK：按创建时间推进配送节点 */
async function syncMockProgress(job) {
  if (job.provider === 'self') return job;
  const elapsed = (Date.now() - new Date(job.created_at).getTime()) / 1000;
  let latest = job.job_status;
  let riderName = job.rider_name;
  let riderPhone = job.rider_phone;
  for (const step of MOCK_STEPS) {
    if (elapsed >= step.delaySec) {
      latest = step.code;
      if (step.rider && !riderName) {
        riderName = job.provider === 'meituan' ? '美团骑手' : '饿了么骑手';
        riderPhone = '13800001234';
      }
      await appendTrack(
        job,
        step.code,
        job.provider === 'meituan' ? '美团配送' : '饿了么配送'
      );
    }
  }
  if (latest !== job.job_status || riderName !== job.rider_name) {
    await job.update({
      job_status: latest,
      rider_name: riderName,
      rider_phone: riderPhone
    });
  }
  return job.reload();
}

async function callThirdPartyCreate(provider, order, shop) {
  const shopId = order.shop_id;
  if (await shouldUseMock(provider, shopId)) {
    const prefix = provider === 'meituan' ? 'MT' : 'ELM';
    return {
      external_order_no: `${prefix}${Date.now()}`,
      fee: provider === 'meituan' ? 6.5 : 5.8,
      mock: true
    };
  }

  const items = await loadOrderItems(order.order_no);
  const geo = resolveShopGeo(shop);
  const recv = resolveReceiverGeo(order);
  const ctx = {
    orderId: order.order_no,
    receiverName: order.receiver_name,
    receiverPhone: order.receiver_phone,
    receiverAddress: order.receiver_address,
    receiverLat: recv.receiverLat,
    receiverLng: recv.receiverLng,
    goodsValue: Number(order.goods_amount || order.payable_amount || 0),
    payableAmount: Number(order.payable_amount || 0),
    goodsWeight: 1,
    note: order.remark || '',
    items,
    ...geo
  };

  if (provider === 'meituan') {
    const externalShopId = await shopBinding.resolveExternalShopId(shopId, 'meituan');
    if (!externalShopId) {
      throw new Error('该店未绑定美团配送门店，请先在商家后台完成绑定');
    }
    const deliveryId = Date.now();
    const created = await meituan.createByShop({ ...ctx, shopId: externalShopId, deliveryId });
    return {
      external_order_no: created.external_order_no,
      fee: created.fee,
      mock: false,
      payload: {
        delivery_id: created.delivery_id,
        mt_peisong_id: created.external_order_no,
        order_id: created.order_id,
        shop_id: externalShopId
      }
    };
  }

  if (provider === 'eleme') {
    const chainStoreCode = await shopBinding.resolveExternalShopCode(shopId, 'eleme')
      || await shopBinding.resolveExternalShopId(shopId, 'eleme');
    if (!chainStoreCode) {
      throw new Error('该店未绑定饿了么蜂鸟门店，请先在商家后台完成绑定');
    }
    const created = await fengniao.createOrder({ ...ctx, chainStoreCode });
    return {
      external_order_no: created.external_order_no,
      fee: created.fee,
      mock: false,
      payload: {
        partner_order_code: created.partner_order_code,
        chain_store_code: chainStoreCode
      }
    };
  }

  throw new Error(`不支持的配送渠道: ${provider}`);
}

async function syncThirdPartyProgress(job, order) {
  const payload = parsePayload(job);
  if (await shouldUseMock(job.provider, job.shop_id)) {
    return syncMockProgress(job);
  }

  if (job.provider === 'meituan') {
    const data = await meituan.queryStatus({
      deliveryId: payload.delivery_id,
      mtPeisongId: job.external_order_no,
      externalOrderNo: job.external_order_no
    });
    const mapped = meituan.mapStatus(data.status);
    if (mapped) {
      await applyJobStatus(job, order, mapped, {
        name: data.courier_name,
        phone: data.courier_phone
      });
    }
    return job.reload();
  }

  if (job.provider === 'eleme') {
    const partnerCode = payload.partner_order_code || job.order_no;
    const data = await fengniao.queryOrder(partnerCode);
    const mapped = fengniao.mapStatus(data.order_status);
    if (mapped) {
      await applyJobStatus(job, order, mapped, {
        name: data.carrier_driver_name || data.driver_name,
        phone: data.carrier_driver_phone || data.driver_phone
      });
    }
    return job.reload();
  }

  return job;
}

/**
 * 商家发起配送
 */
async function launchDelivery(order, shop, providerCode) {
  await ensureDeliveryTables();
  const MarketOrder = db.MarketOrder;
  const Job = db.MarketDeliveryJob;
  if (!Job || !MarketOrder) throw new Error('配送模型未加载');

  const provider = String(providerCode || '').trim();
  if (!PROVIDERS[provider]) throw new Error('不支持的配送方式');

  if (order.delivery_mode === 'pickup' && provider !== 'self') {
    throw new Error('自提订单仅支持商家自配送（通知用户取货）');
  }
  if (!['pending_service', 'pending_receipt'].includes(String(order.order_status))) {
    throw new Error('当前订单状态不可发起配送');
  }
  if (order.delivery_carrier && order.delivery_carrier !== provider) {
    throw new Error('已选择其他配送方式，请勿重复切换');
  }

  let job = await Job.findOne({ where: { order_no: order.order_no } });
  if (job && job.provider === provider && job.job_status !== 'cancelled' && job.job_status !== 'failed') {
    await syncJobProgress(job, order);
    return job;
  }

  if (provider === 'self') {
    job = await Job.create({
      order_no: order.order_no,
      shop_id: order.shop_id,
      user_id: order.user_id,
      provider: 'self',
      external_order_no: null,
      job_status: 'delivering',
      fee_amount: 0
    });
    await appendTrack(job, 'created', '商家自配送');
    await appendTrack(job, 'delivering', '商家配送中');
    await order.update({
      delivery_carrier: 'self',
      delivery_job_status: 'delivering',
      order_status: 'pending_receipt',
      delivered_at: new Date()
    });
    return job;
  }

  const ext = await callThirdPartyCreate(provider, order, shop);
  job = await Job.create({
    order_no: order.order_no,
    shop_id: order.shop_id,
    user_id: order.user_id,
    provider,
    external_order_no: ext.external_order_no,
    job_status: 'waiting_rider',
    fee_amount: ext.fee || 0,
    payload_json: JSON.stringify({ mock: !!ext.mock, ...(ext.payload || {}) })
  });
  await appendTrack(job, 'created', `${PROVIDERS[provider].name}下单成功`);
  await appendTrack(job, 'waiting_rider', '等待骑手接单');
  await updateOrderDeliveryFields(order, job);
  await syncJobProgress(job, order);
  return job.reload();
}

async function syncJobProgress(job, order) {
  if (!job) return null;
  if (job.provider === 'self') return job;
  try {
    job = await syncThirdPartyProgress(job, order);
  } catch (e) {
    console.error('[delivery/sync]', job.provider, job.order_no, e.message);
    if (await shouldUseMock(job.provider, job.shop_id)) {
      job = await syncMockProgress(job);
    }
  }
  if (order) await updateOrderDeliveryFields(order, job);
  return job;
}

async function getDeliveryView(orderNo) {
  await ensureDeliveryTables();
  const Job = db.MarketDeliveryJob;
  const Track = db.MarketDeliveryTrack;
  const job = Job ? await Job.findOne({ where: { order_no: orderNo }, order: [['id', 'DESC']] }) : null;
  if (!job) {
    return {
      has_delivery: false,
      provider: null,
      provider_name: null,
      job_status: null,
      job_status_text: null,
      external_order_no: null,
      rider_name: null,
      rider_phone: null,
      timeline: []
    };
  }
  const order = db.MarketOrder ? await db.MarketOrder.findOne({ where: { order_no: orderNo } }) : null;
  if (order) await syncJobProgress(job, order);

  const tracks = Track
    ? await Track.findAll({ where: { job_id: job.id }, order: [['id', 'ASC']] })
    : [];
  const prov = PROVIDERS[job.provider] || { name: job.provider };
  return {
    has_delivery: true,
    provider: job.provider,
    provider_name: prov.name,
    brand: prov.brand,
    job_status: job.job_status,
    job_status_text: STATUS_LABELS[job.job_status] || job.job_status,
    external_order_no: job.external_order_no,
    rider_name: job.rider_name,
    rider_phone: job.rider_phone,
    fee_amount: Number(job.fee_amount || 0).toFixed(2),
    mock_mode: await shouldUseMock(job.provider, job.shop_id),
    timeline: tracks.map((t) => ({
      status_code: t.status_code,
      status_text: t.status_text,
      note: t.note,
      created_at: t.created_at
    }))
  };
}

/** 商家自配送完成 */
async function completeSelfDelivery(orderNo) {
  const Job = db.MarketDeliveryJob;
  const order = await db.MarketOrder.findOne({ where: { order_no: orderNo } });
  if (!order) throw new Error('订单不存在');
  const job = Job ? await Job.findOne({ where: { order_no: orderNo, provider: 'self' } }) : null;
  if (job) {
    await appendTrack(job, 'delivered', '商家确认送达');
    await job.update({ job_status: 'delivered' });
  }
  await order.update({
    delivery_job_status: 'delivered',
    order_status: 'pending_receipt',
    delivered_at: order.delivered_at || new Date()
  });
  return order;
}

async function findJobForWebhook(provider, body) {
  const Job = db.MarketDeliveryJob;
  if (!Job) return null;
  if (provider === 'meituan') {
    const orderId = body.order_id;
    const mtId = body.mt_peisong_id;
    if (mtId) {
      const byExt = await Job.findOne({ where: { external_order_no: String(mtId), provider } });
      if (byExt) return byExt;
    }
    if (orderId) {
      return Job.findOne({ where: { order_no: String(orderId), provider } });
    }
  }
  if (provider === 'eleme') {
    const parsed = fengniao.parseWebhookBody(body);
    const code = parsed.partner_order_code || body.partner_order_code;
    if (code) {
      return Job.findOne({ where: { order_no: String(code), provider } });
    }
  }
  return null;
}

async function handleWebhook(provider, body) {
  const params = body || {};
  if (provider === 'meituan') {
    if (!meituan.verifyWebhookSign(params)) {
      console.warn('[delivery/webhook/meituan] sign invalid');
      return { ok: false, reason: 'invalid_sign' };
    }
    const mapped = meituan.mapStatus(params.status);
    if (!mapped) return { ok: true, skipped: true };
    const job = await findJobForWebhook('meituan', params);
    if (!job) return { ok: false, reason: 'job_not_found' };
    const order = await db.MarketOrder.findOne({ where: { order_no: job.order_no } });
    await applyJobStatus(job, order, mapped, {
      name: params.courier_name,
      phone: params.courier_phone
    });
    return { ok: true };
  }

  if (provider === 'eleme') {
    const parsed = fengniao.parseWebhookBody(params);
    const mapped = fengniao.mapStatus(parsed.order_status || parsed.status);
    if (!mapped) return { ok: true, skipped: true };
    const job = await findJobForWebhook('eleme', parsed);
    if (!job) return { ok: false, reason: 'job_not_found' };
    const order = await db.MarketOrder.findOne({ where: { order_no: job.order_no } });
    await applyJobStatus(job, order, mapped, {
      name: parsed.carrier_driver_name || parsed.driver_name,
      phone: parsed.carrier_driver_phone || parsed.driver_phone
    });
    return { ok: true };
  }

  return { ok: false };
}

function listProviderOptions(deliveryMode) {
  const base = [
    { code: 'self', name: '商家自配送', desc: '由店铺自行送货或通知用户自提' }
  ];
  if (deliveryMode !== 'pickup') {
    base.push(
      { code: 'meituan', name: '美团配送', desc: '呼叫美团骑手，双方可查看配送进度' },
      { code: 'eleme', name: '饿了么配送', desc: '呼叫饿了么骑手，双方可查看配送进度' }
    );
  }
  return base;
}

async function listProviderOptionsForShop(deliveryMode, shopId) {
  const base = [
    { code: 'self', name: '商家自配送', desc: '由店铺自行送货或通知用户自提', available: true }
  ];
  if (deliveryMode === 'pickup') return base;

  const mockGlobal = await shouldUseMock(null, shopId);
  for (const item of [
    { code: 'meituan', name: '美团配送', desc: '呼叫美团骑手，双方可查看配送进度' },
    { code: 'eleme', name: '饿了么配送', desc: '呼叫饿了么骑手，双方可查看配送进度' }
  ]) {
    const binding = shopId != null ? await shopBinding.getBinding(shopId, item.code) : null;
    const hasBinding = binding && binding.status === 'active';
    const credReady = shopBinding.isPlatformCredentialsReady(item.code);
    const ready = shopId != null ? await shopBinding.isShopProviderReady(shopId, item.code) : credReady;
    base.push({
      ...item,
      available: ready || (mockGlobal && hasBinding),
      platform_configured: credReady,
      bound: !!hasBinding,
      external_shop_id: binding ? binding.external_shop_id : null,
      mock_eligible: mockGlobal && hasBinding
    });
  }
  return base;
}

module.exports = {
  PROVIDERS,
  STATUS_LABELS,
  useMock: isGlobalMockMode,
  shouldUseMock,
  launchDelivery,
  syncJobProgress,
  getDeliveryView,
  completeSelfDelivery,
  handleWebhook,
  listProviderOptions,
  listProviderOptionsForShop,
  providerConfigured
};
