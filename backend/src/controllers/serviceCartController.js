'use strict';

const db = require('../models');
const { ServiceCartItem, ServiceItem, Service, ServiceProviderProfile } = db;
const { resolveServiceProviderProfile } = require('../utils/resolveServiceProviderProfile');

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data };
}

function getUserId(req) {
  const u = req.user || {};
  return u.id != null ? u.id : (u.sub != null ? u.sub : null);
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  if (ServiceCartItem && ServiceCartItem.sync) {
    await ServiceCartItem.sync();
  }
  tableReady = true;
}

async function loadServiceMeta(serviceId, providerId) {
  const sid = Number(serviceId);
  const pid = Number(providerId);
  if (!sid) return null;

  if (ServiceItem) {
    try {
      const where = { id: sid };
      if (pid) where.provider_id = pid;
      const row = await ServiceItem.findOne({ where });
      if (row) {
        const j = row.toJSON ? row.toJSON() : row;
        const onSale = j.is_published === 1 || j.is_published === true || j.status === 'on_sale';
        return {
          id: j.id,
          title: j.title || j.name,
          price: String(j.price != null ? j.price : '0'),
          cover_image: j.cover_image || j.main_image || '',
          invalid: !onSale
        };
      }
    } catch (e) { /* ignore */ }
  }

  if (Service) {
    const row = await Service.findByPk(sid);
    if (!row) return null;
    const j = row.toJSON ? row.toJSON() : row;
    if (pid && Number(j.provider_id) !== pid) return null;
    const onSale = j.status === 'on_sale' || j.is_published === 1 || j.is_published === true;
    const offSale = j.is_published === 0 || j.is_published === false
      || (j.status && j.status !== 'on_sale' && j.is_published == null);
    return {
      id: j.id,
      title: j.title || j.name,
      price: String(j.price != null ? j.price : '0'),
      cover_image: j.cover_image || '',
      invalid: !onSale && offSale
    };
  }
  return null;
}

function mapRow(r, serviceMap, providerMap) {
  const svc = serviceMap.get(Number(r.service_id));
  const prov = providerMap.get(Number(r.provider_id));
  const price = svc ? Number(svc.price) || 0 : 0;
  const qty = Number(r.quantity) || 0;
  return {
    id: r.id,
    provider_id: r.provider_id,
    provider_name: prov ? (prov.display_name || prov.shop_name || prov.name || '') : '',
    service_id: r.service_id,
    group_key: r.group_key || 'default',
    quantity: qty,
    subtotal: (price * qty).toFixed(2),
    invalid: !svc || svc.invalid,
    service: svc
  };
}

exports.getCartSummary = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const rows = await ServiceCartItem.findAll({
      where: { user_id: userId },
      attributes: ['quantity', 'provider_id']
    });
    const itemCount = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const providerIds = [...new Set(rows.map((r) => Number(r.provider_id)).filter(Boolean))];
    res.json(ok({ item_count: itemCount, sku_count: rows.length, provider_count: providerIds.length }));
  } catch (e) {
    console.error('service-cart/summary', e);
    res.status(500).json({ code: 500, msg: '获取购物车数量失败', data: null });
  }
};

exports.getCart = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const providerId = parseInt(req.query.provider_id || req.query.providerId, 10) || 0;
    const where = { user_id: userId };
    if (providerId) where.provider_id = providerId;

    const rows = await ServiceCartItem.findAll({ where, order: [['created_at', 'DESC']] });
    const serviceIds = [...new Set(rows.map((r) => Number(r.service_id)).filter(Boolean))];
    const providerIds = [...new Set(rows.map((r) => Number(r.provider_id)).filter(Boolean))];

    const serviceMap = new Map();
    for (const sid of serviceIds) {
      const row = rows.find((r) => Number(r.service_id) === sid);
      const meta = await loadServiceMeta(sid, row ? row.provider_id : 0);
      if (meta) serviceMap.set(sid, meta);
    }

    const providerRows = providerIds.length && ServiceProviderProfile
      ? await ServiceProviderProfile.findAll({ where: { id: providerIds } })
      : [];
    const providerMap = new Map(providerRows.map((p) => {
      const j = p.toJSON ? p.toJSON() : p;
      return [Number(j.id), j];
    }));

    const list = rows.map((r) => mapRow(r, serviceMap, providerMap));
    const itemCount = list.reduce((s, it) => s + Number(it.quantity || 0), 0);

    let groups = null;
    if (!providerId) {
      const byProvider = new Map();
      list.forEach((item) => {
        const pid = Number(item.provider_id);
        if (!byProvider.has(pid)) {
          const prov = providerMap.get(pid);
          byProvider.set(pid, {
            provider_id: pid,
            provider_name: prov ? (prov.display_name || prov.shop_name || prov.name || item.provider_name || '服务商') : (item.provider_name || '服务商'),
            provider_logo: prov && (prov.cover_image || prov.shop_front_url || prov.avatar_url) ? (prov.cover_image || prov.shop_front_url || prov.avatar_url) : '',
            items: [],
            subtotal: '0.00',
            item_count: 0
          });
        }
        const g = byProvider.get(pid);
        g.items.push(item);
        if (!item.invalid) {
          g.item_count += Number(item.quantity || 0);
          g.subtotal = (Number(g.subtotal) + Number(item.subtotal || 0)).toFixed(2);
        }
      });
      groups = Array.from(byProvider.values());
    }

    res.json(ok({
      list,
      groups,
      summary: {
        item_count: itemCount,
        sku_count: list.length,
        provider_count: providerId ? 1 : providerIds.length
      }
    }));
  } catch (e) {
    console.error('service-cart/get', e);
    res.status(500).json({ code: 500, msg: '获取购物车失败', data: null });
  }
};

exports.addItem = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const body = req.body || {};
    const providerId = parseInt(body.provider_id || body.providerId, 10);
    const serviceId = parseInt(body.service_id || body.serviceId, 10);
    const groupKey = String(body.group_key || body.groupKey || 'default').trim() || 'default';
    const quantity = Math.max(parseInt(body.quantity, 10) || 1, 1);
    if (!providerId || !serviceId) {
      return res.status(400).json({ code: 400, msg: '缺少 provider_id 或 service_id', data: null });
    }
    const prof = await resolveServiceProviderProfile(String(providerId));
    if (!prof) return res.status(404).json({ code: 404, msg: '服务商不存在', data: null });
    const meta = await loadServiceMeta(serviceId, prof.id);
    if (!meta || meta.invalid) {
      return res.status(404).json({ code: 404, msg: '服务不存在或已下架', data: null });
    }

    const pid = Number(prof.id);
    let row = await ServiceCartItem.findOne({
      where: { user_id: userId, provider_id: pid, service_id: serviceId, group_key: groupKey }
    });
    if (row) {
      await row.update({ quantity: Math.min(Number(row.quantity) + quantity, 999) });
    } else {
      row = await ServiceCartItem.create({
        user_id: userId,
        provider_id: pid,
        service_id: serviceId,
        group_key: groupKey,
        quantity: Math.min(quantity, 999)
      });
    }
    res.json(ok({ id: row.id, quantity: row.quantity }, '加入购物车成功'));
  } catch (e) {
    console.error('service-cart/add', e);
    res.status(500).json({ code: 500, msg: '加入购物车失败', data: null });
  }
};

exports.updateItem = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const itemId = parseInt(req.params.itemId, 10);
    const quantity = Math.max(parseInt((req.body || {}).quantity, 10) || 0, 0);
    const row = await ServiceCartItem.findOne({ where: { id: itemId, user_id: userId } });
    if (!row) return res.status(404).json({ code: 404, msg: '购物车项不存在', data: null });
    if (quantity <= 0) {
      await row.destroy();
      return res.json(ok({ id: itemId, deleted: true }));
    }
    await row.update({ quantity: Math.min(quantity, 999) });
    res.json(ok({ id: row.id, quantity: row.quantity }, '更新成功'));
  } catch (e) {
    console.error('service-cart/update', e);
    res.status(500).json({ code: 500, msg: '更新购物车失败', data: null });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const itemId = parseInt(req.params.itemId, 10);
    const row = await ServiceCartItem.findOne({ where: { id: itemId, user_id: userId } });
    if (!row) return res.status(404).json({ code: 404, msg: '购物车项不存在', data: null });
    await row.destroy();
    res.json(ok({ id: itemId, deleted: true }, '删除成功'));
  } catch (e) {
    console.error('service-cart/delete', e);
    res.status(500).json({ code: 500, msg: '删除购物车失败', data: null });
  }
};

exports.clearCart = async (req, res) => {
  try {
    await ensureTable();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 401, msg: '未登录', data: null });
    const providerId = parseInt(req.query.provider_id || req.query.providerId, 10) || 0;
    const where = { user_id: userId };
    if (providerId) where.provider_id = providerId;
    const deleted = await ServiceCartItem.destroy({ where });
    res.json(ok({
      cleared: true,
      deleted_count: deleted,
      provider_id: providerId || null
    }, providerId ? '已清空该服务商购物车' : '已清空全部服务购物车'));
  } catch (e) {
    console.error('service-cart/clear', e);
    res.status(500).json({ code: 500, msg: '清空购物车失败', data: null });
  }
};
