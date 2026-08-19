'use strict';

const db = require('../models');
const meituan = require('./delivery/meituanPeisong.client');
const fengniao = require('./delivery/fengniaoDelivery.client');

const ACTIVE_STATUS = 'active';

function getBindingModel() {
  return db.MerchantShopDeliveryBinding;
}

async function ensureBindingTable() {
  const Model = getBindingModel();
  if (Model && Model.sync) await Model.sync();
}

function envFallbackShopId(provider) {
  if (provider === 'meituan') {
    return process.env.MEITUAN_SHOP_ID || '';
  }
  if (provider === 'eleme') {
    return process.env.ELEME_CHAIN_STORE_CODE || process.env.ELEME_SHOP_ID || '';
  }
  return '';
}

function isPlatformCredentialsReady(provider) {
  if (provider === 'meituan') return meituan.isConfigured();
  if (provider === 'eleme') return fengniao.isConfigured();
  return false;
}

async function getBinding(shopId, provider) {
  const Model = getBindingModel();
  if (!Model) return null;
  return Model.findOne({
    where: {
      shop_id: Number(shopId),
      provider: String(provider)
    }
  });
}

async function listBindings(shopId) {
  const Model = getBindingModel();
  if (!Model) return [];
  return Model.findAll({
    where: { shop_id: Number(shopId) },
    order: [['provider', 'ASC']]
  });
}

async function upsertBinding(shopId, provider, data) {
  await ensureBindingTable();
  const Model = getBindingModel();
  if (!Model) throw new Error('配送绑定模型未加载');

  const shopIdNum = Number(shopId);
  const prov = String(provider);
  const payload = {
    external_shop_id: String(data.external_shop_id || ''),
    external_shop_code: data.external_shop_code != null ? String(data.external_shop_code) : null,
    status: data.status || ACTIVE_STATUS,
    bind_payload_json: data.bind_payload_json
      ? (typeof data.bind_payload_json === 'string' ? data.bind_payload_json : JSON.stringify(data.bind_payload_json))
      : null
  };

  if (!payload.external_shop_id) {
    throw new Error('external_shop_id 不能为空');
  }

  const existing = await getBinding(shopIdNum, prov);
  if (existing) {
    await existing.update(payload);
    return existing.reload();
  }

  return Model.create({
    shop_id: shopIdNum,
    provider: prov,
    ...payload
  });
}

async function resolveExternalShopId(shopId, provider) {
  const binding = await getBinding(shopId, provider);
  if (binding && binding.status === ACTIVE_STATUS && binding.external_shop_id) {
    return binding.external_shop_id;
  }
  const fallback = envFallbackShopId(provider);
  return fallback || null;
}

async function resolveExternalShopCode(shopId, provider) {
  const binding = await getBinding(shopId, provider);
  if (binding && binding.status === ACTIVE_STATUS && binding.external_shop_code) {
    return binding.external_shop_code;
  }
  if (provider === 'eleme') {
    return envFallbackShopId('eleme') || null;
  }
  return null;
}

async function hasShopBinding(shopId, provider) {
  const extId = await resolveExternalShopId(shopId, provider);
  return !!extId;
}

async function isShopProviderReady(shopId, provider) {
  if (provider === 'self') return true;
  if (!isPlatformCredentialsReady(provider)) return false;
  return hasShopBinding(shopId, provider);
}

function formatMeituanShopName(shop) {
  const raw = String(shop.name || shop.shop_name || '门店').trim();
  if (/[-（(].*店[）)]?$/.test(raw)) return raw.slice(0, 50);
  const base = raw.replace(/店$/, '') || '门店';
  return `家事速配-${base}店`.slice(0, 50);
}

function validateShopForDelivery(shop) {
  const lat = shop.latitude != null ? Number(shop.latitude) : null;
  const lng = shop.longitude != null ? Number(shop.longitude) : null;
  const phone = shop.contact_phone || shop.phone || '';
  const address = shop.address || '';
  const missing = [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) missing.push('经纬度');
  if (!phone) missing.push('联系电话');
  if (!address || address.length < 5) missing.push('门店地址');
  if (missing.length) {
    throw new Error(`店铺资料不完整，缺少：${missing.join('、')}`);
  }
  return { lat, lng, phone, address };
}

/**
 * 调用美团 shop/create 注册门店并写入绑定表
 */
async function registerShopOnMeituan(shop) {
  if (!meituan.isConfigured()) {
    throw new Error('美团配送未配置 MEITUAN_APP_KEY / MEITUAN_SECRET');
  }
  validateShopForDelivery(shop);

  const shopIdStr = String(shop.id);
  const created = await meituan.createShop({
    shopId: shopIdStr,
    shopName: formatMeituanShopName(shop),
    contactName: shop.contact_name || '门店联系人',
    contactPhone: shop.contact_phone || shop.phone,
    shopAddress: shop.address,
    shopLat: shop.latitude,
    shopLng: shop.longitude
  });

  const externalShopId = created.shop_id || shopIdStr;
  const binding = await upsertBinding(shop.id, 'meituan', {
    external_shop_id: String(externalShopId),
    status: created.status === 0 ? ACTIVE_STATUS : 'pending',
    bind_payload_json: created.raw || created
  });

  return {
    binding,
    external_shop_id: String(externalShopId),
    meituan_status: created.status,
    raw: created.raw
  };
}

async function bindMeituanTestShop(shop, externalShopId = 'test_0001') {
  validateShopForDelivery(shop);
  const binding = await upsertBinding(shop.id, 'meituan', {
    external_shop_id: String(externalShopId),
    status: ACTIVE_STATUS,
    bind_payload_json: { source: 'test_bind', external_shop_id: externalShopId }
  });
  return binding;
}

async function bindMockShop(shop, provider = 'meituan') {
  const binding = await upsertBinding(shop.id, provider, {
    external_shop_id: `MOCK_${provider}_${shop.id}`,
    status: ACTIVE_STATUS,
    bind_payload_json: { source: 'mock_bind', mock: true }
  });
  return binding;
}

function bindingToView(row) {
  if (!row) return null;
  let payload = null;
  if (row.bind_payload_json) {
    try {
      payload = JSON.parse(row.bind_payload_json);
    } catch (e) {
      payload = row.bind_payload_json;
    }
  }
  return {
    id: row.id,
    shop_id: row.shop_id,
    provider: row.provider,
    external_shop_id: row.external_shop_id,
    external_shop_code: row.external_shop_code,
    status: row.status,
    bind_payload: payload,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getBindingsView(shopId) {
  const rows = await listBindings(shopId);
  const providers = ['meituan', 'eleme'];
  const map = new Map(rows.map((r) => [r.provider, r]));

  return providers.map((provider) => {
    const row = map.get(provider);
    const credReady = isPlatformCredentialsReady(provider);
    const bound = !!row && row.status === ACTIVE_STATUS;
    return {
      provider,
      platform_configured: credReady,
      bound,
      binding: bindingToView(row),
      env_fallback: envFallbackShopId(provider) || null,
      ready: credReady && (bound || !!envFallbackShopId(provider))
    };
  });
}

module.exports = {
  ensureBindingTable,
  getBinding,
  listBindings,
  upsertBinding,
  resolveExternalShopId,
  resolveExternalShopCode,
  hasShopBinding,
  isShopProviderReady,
  isPlatformCredentialsReady,
  registerShopOnMeituan,
  bindMeituanTestShop,
  bindMockShop,
  validateShopForDelivery,
  formatMeituanShopName,
  bindingToView,
  getBindingsView,
  envFallbackShopId
};
