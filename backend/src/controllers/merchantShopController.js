/**
 * 集市商家店铺信息（用户 JWT，/market/merchant/shop）
 * 读写 production 表 market_shops 的 logo_url / cover_url
 */
const db = require('../models');
const { MarketShop } = db;
const { resolveUserIdFromReq } = require('../utils/resolveUserId');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, status = 400) => res.status(status).json({ code: 1, msg, errmsg: msg });

function normalizeShopRow(row) {
  if (!row) return null;
  const j = row.get ? row.get({ plain: true }) : row;
  return {
    id: j.id,
    shop_id: j.id,
    name: j.name || '',
    shop_name: j.name || '',
    logo: j.logo_url || '',
    logo_url: j.logo_url || '',
    logoUrl: j.logo_url || '',
    cover: j.cover_url || '',
    cover_url: j.cover_url || '',
    coverUrl: j.cover_url || '',
    contact_name: j.contact_name || '',
    contact_phone: j.contact_phone || '',
    phone: j.contact_phone || '',
    business_hours: j.business_hours || '',
    notice: j.notice || '',
    description: j.notice || '',
    address: j.address || '',
    is_open: j.is_open,
    is_active: j.is_active,
    community_id: null
  };
}

async function findShopByUserId(userId) {
  if (!userId || !MarketShop) return null;
  return MarketShop.findOne({
    where: { user_id: userId, is_active: 1 },
    order: [['id', 'DESC']]
  });
}

function mapPatchBody(body) {
  const b = { ...(body || {}) };
  if (b.logo !== undefined && b.logo_url === undefined) b.logo_url = b.logo;
  if (b.logoUrl !== undefined && b.logo_url === undefined) b.logo_url = b.logoUrl;
  if (b.cover !== undefined && b.cover_url === undefined) b.cover_url = b.cover;
  if (b.coverUrl !== undefined && b.cover_url === undefined) b.cover_url = b.coverUrl;
  if (b.cover_image !== undefined && b.cover_url === undefined) b.cover_url = b.cover_image;
  if (b.phone !== undefined && b.contact_phone === undefined) b.contact_phone = b.phone;
  if (b.description !== undefined && b.notice === undefined) b.notice = b.description;
  return b;
}

const PATCHABLE = ['notice', 'contact_name', 'contact_phone', 'business_hours', 'logo_url', 'cover_url', 'name'];
const FIELD_MAX = {
  notice: 255,
  contact_name: 50,
  contact_phone: 30,
  business_hours: 100,
  logo_url: 500,
  cover_url: 500,
  name: 100
};

exports.getShop = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await findShopByUserId(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);
    return ok(res, { shop: normalizeShopRow(shop) });
  } catch (e) {
    console.error('[merchantShop/getShop]', e);
    return fail(res, '获取店铺信息失败', 500);
  }
};

exports.patchShop = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await findShopByUserId(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const b = mapPatchBody(req.body);
    if (b.community_id !== undefined || b.communityId !== undefined) {
      return fail(res, 'community_id 暂不支持修改，请走入驻信息变更流程', 400);
    }

    PATCHABLE.forEach((k) => {
      if (b[k] !== undefined && b[k] !== null) {
        const max = FIELD_MAX[k] || 255;
        shop[k] = String(b[k]).slice(0, max);
      }
    });
    if (b.is_open !== undefined && b.is_open !== null) {
      const v = b.is_open === true || b.is_open === 1 || b.is_open === '1';
      shop.is_open = v ? 1 : 0;
    }
    await shop.save();
    return ok(res, { shop: normalizeShopRow(shop) }, '更新成功');
  } catch (e) {
    console.error('[merchantShop/patchShop]', e);
    return fail(res, '更新店铺信息失败', 500);
  }
};
