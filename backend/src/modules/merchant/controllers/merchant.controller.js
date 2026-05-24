const db = require('../../../models');
const { MerchantShop, MerchantGoods, MarketOrder, MarketOrderItem, MarketRefundOrder, User } = db;
const orderPoints = require('../../../services/orderPoints.service');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });
let merchantOrderTablesReady = false;

async function ensureMerchantOrderTables() {
  if (merchantOrderTablesReady) return;
  await Promise.all([
    MarketOrder && MarketOrder.sync ? MarketOrder.sync() : Promise.resolve(),
    MarketOrderItem && MarketOrderItem.sync ? MarketOrderItem.sync() : Promise.resolve(),
    MarketRefundOrder && MarketRefundOrder.sync ? MarketRefundOrder.sync() : Promise.resolve()
  ]);
  merchantOrderTablesReady = true;
}

// ===== 辅助函数 =====

const { resolveUserIdFromReq } = require('../../../utils/resolveUserId');

function getUserId(req) {
  return resolveUserIdFromReq(req);
}

async function getShopByUser(userId) {
  if (!userId) return null;
  return MerchantShop.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC']]
  });
}

function normalizeShop(row) {
  if (!row) return null;
  const logo = row.logo || row.logo_url || '';
  const cover = row.cover_url || row.cover || '';
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    logo,
    logo_url: logo,
    cover_url: cover,
    cover,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    business_hours: row.business_hours,
    description: row.description,
    category: row.category,
    status: row.status,
    reject_reason: row.reject_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeGoods(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    user_id: row.user_id,
    name: row.name,
    title: row.title || row.name,
    main_image: row.main_image,
    price: Number(row.price),
    original_price: row.original_price ? Number(row.original_price) : null,
    stock: row.stock,
    safe_stock: row.safe_stock,
    sales_count: row.sales_count,
    description: row.description,
    status: row.status,
    is_published: row.is_published,
    sort_order: row.sort_order,
    category_key: row.category_key || 'local',
    categoryKey: row.category_key || 'local',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// ===== 7.1 仪表盘和店铺 =====

// GET /market/merchant/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    // 统计商品数量
    const goodsCount = await MerchantGoods.count({ where: { shop_id: shop.id } });
    const onSaleCount = await MerchantGoods.count({ where: { shop_id: shop.id, status: 'on_sale' } });
    const lowStockCount = await MerchantGoods.count({
      where: {
        shop_id: shop.id,
        stock: { [db.Sequelize.Op.lte]: db.Sequelize.col('safe_stock') }
      }
    });

    ok(res, {
      shop: normalizeShop(shop),
      stats: {
        goods_total: goodsCount,
        goods_on_sale: onSaleCount,
        goods_low_stock: lowStockCount
      }
    });
  } catch (err) {
    console.error('[merchant/dashboard]', err);
    fail(res, '获取仪表盘失败', 500);
  }
};

// GET /market/merchant/shop
exports.getShop = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    ok(res, normalizeShop(shop));
  } catch (err) {
    console.error('[merchant/shop]', err);
    fail(res, '获取店铺信息失败', 500);
  }
};

// PATCH /market/merchant/shop
exports.updateShop = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const body = req.body || {};
    if (body.logo_url !== undefined && body.logo === undefined) body.logo = body.logo_url;
    if (body.logo !== undefined && body.logo_url === undefined) body.logo_url = body.logo;
    if (body.cover_url !== undefined && body.cover === undefined) body.cover = body.cover_url;
    if (body.cover !== undefined && body.cover_url === undefined) body.cover_url = body.cover;
    const allowed = ['name', 'logo', 'logo_url', 'cover_url', 'cover', 'contact_name', 'contact_phone', 'address',
      'latitude', 'longitude', 'business_hours', 'description', 'category'];
    const updateData = {};
    allowed.forEach((k) => {
      if (body[k] !== undefined) updateData[k] = body[k];
    });
    if (updateData.logo_url && !updateData.logo) updateData.logo = updateData.logo_url;

    await shop.update(updateData);
    ok(res, normalizeShop(shop), '更新成功');
  } catch (err) {
    console.error('[merchant/shop/update]', err);
    fail(res, '更新店铺信息失败', 500);
  }
};

// ===== 7.2 商品管理 =====

// GET /market/merchant/goods
exports.getGoodsList = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const where = { shop_id: shop.id };
    // 支持按 shop_id 过滤（前端兼容）
    const qShopId = query.shop_id != null ? Number(query.shop_id) : (query.shopId != null ? Number(query.shopId) : null);
    if (qShopId && qShopId !== shop.id) {
      return fail(res, '无权查看该店铺商品', 403);
    }

    // 上架筛选：on = 与小程序列表一致（在售且已发布）；off = 其余
    if (query.category_key) {
      where.category_key = query.category_key;
    }

    const shelf = query.shelf || query.on_shelf;
    const Op = db.Sequelize.Op;
    if (shelf === 'on' || shelf === '1' || shelf === 'published') {
      where.status = 'on_sale';
      where.is_published = 1;
    } else if (shelf === 'off' || shelf === '0' || shelf === 'unpublished') {
      where[Op.or] = [
        { status: { [Op.ne]: 'on_sale' } },
        { is_published: { [Op.ne]: 1 } }
      ];
    }

    const { count, rows } = await MerchantGoods.findAndCountAll({
      where,
      order: [['sort_order', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map(normalizeGoods),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[merchant/goods]', err);
    fail(res, '获取商品列表失败', 500);
  }
};

// POST /market/merchant/goods
exports.createGoods = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const body = req.body || {};
    const shopId = body.shop_id != null ? Number(body.shop_id) : (body.shopId != null ? Number(body.shopId) : null);

    // 如果没有传入 shop_id，尝试用当前用户的店铺
    let shop;
    if (shopId) {
      shop = await MerchantShop.findByPk(shopId);
      if (!shop) return fail(res, '店铺不存在', 404);
      if (shop.user_id !== userId) return fail(res, '无权操作该店铺', 403);
    } else {
      shop = await getShopByUser(userId);
      if (!shop) return fail(res, '暂无店铺信息，请先入驻', 404);
    }

    const name = String(body.name || body.title || '').trim();
    if (!name) return fail(res, '商品名称不能为空');

    const price = parseFloat(body.price);
    if (!Number.isFinite(price) || price < 0) return fail(res, '价格格式错误');

    const status = body.status === 'on_sale' ? 'on_sale' : 'off_sale';
    const isPublished = body.is_published === 1 || body.is_published === true || body.published === true || body.on_shelf === true ? 1 : 0;

    const row = await MerchantGoods.create({
      shop_id: shop.id,
      user_id: userId,
      name,
      title: name,
      main_image: body.main_image || body.image || '',
      price,
      original_price: body.original_price != null ? parseFloat(body.original_price) : null,
      stock: Math.max(parseInt(body.stock, 10) || 0, 0),
      safe_stock: Math.max(parseInt(body.safe_stock, 10) || 5, 0),
      sales_count: 0,
      description: body.description || body.desc || '',
      status: isPublished ? 'on_sale' : status,
      is_published: isPublished,
      sort_order: parseInt(body.sort_order, 10) || 0,
      category_key: String(body.category_key || body.categoryKey || 'local').trim()
    });

    ok(res, normalizeGoods(row), '创建成功');
  } catch (err) {
    console.error('[merchant/goods/create]', err);
    fail(res, '创建商品失败', 500);
  }
};

// GET /market/merchant/goods/:id
exports.getGoodsDetail = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效商品ID');

    const row = await MerchantGoods.findByPk(id);
    if (!row) return fail(res, '商品不存在', 404);

    // 权限校验：只能查看自己店铺的商品
    const shop = await getShopByUser(userId);
    if (!shop || row.shop_id !== shop.id) {
      return fail(res, '无权查看该商品', 403);
    }

    ok(res, { goods: normalizeGoods(row) });
  } catch (err) {
    console.error('[merchant/goods/detail]', err);
    fail(res, '获取商品详情失败', 500);
  }
};

// PATCH /market/merchant/goods/:id
exports.updateGoods = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效商品ID');

    const row = await MerchantGoods.findByPk(id);
    if (!row) return fail(res, '商品不存在', 404);

    const shop = await getShopByUser(userId);
    if (!shop || row.shop_id !== shop.id) {
      return fail(res, '无权操作该商品', 403);
    }

    const body = req.body || {};
    const updateData = {};

    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) return fail(res, '商品名称不能为空');
      updateData.name = n;
      updateData.title = n;
    }
    if (body.title !== undefined) updateData.title = String(body.title).trim();
    if (body.main_image !== undefined) updateData.main_image = body.main_image;
    if (body.image !== undefined) updateData.main_image = body.image;
    if (body.price !== undefined) {
      const p = parseFloat(body.price);
      if (!Number.isFinite(p) || p < 0) return fail(res, '价格格式错误');
      updateData.price = p;
    }
    if (body.original_price !== undefined) {
      const p = body.original_price != null ? parseFloat(body.original_price) : null;
      updateData.original_price = Number.isFinite(p) ? p : null;
    }
    if (body.stock !== undefined) updateData.stock = Math.max(parseInt(body.stock, 10) || 0, 0);
    if (body.safe_stock !== undefined) updateData.safe_stock = Math.max(parseInt(body.safe_stock, 10) || 5, 0);
    if (body.description !== undefined) updateData.description = body.description;
    if (body.desc !== undefined) updateData.description = body.desc;
    if (body.sort_order !== undefined) updateData.sort_order = parseInt(body.sort_order, 10) || 0;
    if (body.category_key !== undefined) updateData.category_key = String(body.category_key || 'local').trim();
    else if (body.categoryKey !== undefined) updateData.category_key = String(body.categoryKey || 'local').trim();

    // status 和 is_published 在 toggleShelf 中单独处理，这里不覆盖

    await row.update(updateData);
    ok(res, normalizeGoods(row), '更新成功');
  } catch (err) {
    console.error('[merchant/goods/update]', err);
    fail(res, '更新商品失败', 500);
  }
};

// POST /market/merchant/goods/:id/restock
exports.restockGoods = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效商品ID');

    const row = await MerchantGoods.findByPk(id);
    if (!row) return fail(res, '商品不存在', 404);

    const shop = await getShopByUser(userId);
    if (!shop || row.shop_id !== shop.id) {
      return fail(res, '无权操作该商品', 403);
    }

    const body = req.body || {};
    const qty = parseInt(body.quantity || body.qty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      return fail(res, '补货数量必须是正整数');
    }

    await row.update({ stock: row.stock + qty });
    ok(res, normalizeGoods(row), '补货成功');
  } catch (err) {
    console.error('[merchant/goods/restock]', err);
    fail(res, '补货失败', 500);
  }
};

// POST /market/merchant/goods/:id/shelf
exports.toggleShelf = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效商品ID');

    const row = await MerchantGoods.findByPk(id);
    if (!row) return fail(res, '商品不存在', 404);

    const shop = await getShopByUser(userId);
    if (!shop || row.shop_id !== shop.id) {
      return fail(res, '无权操作该商品', 403);
    }

    const body = req.body || {};
    let published;
    if (body.status === 'on_sale') published = true;
    else if (body.status === 'off_sale') published = false;
    else if (body.published === true || body.published === 1) published = true;
    else if (body.published === false || body.published === 0) published = false;
    else if (body.is_published === 1) published = true;
    else if (body.is_published === 0) published = false;
    else {
      // 无显式参数则切换状态
      published = row.status !== 'on_sale';
    }

    const newStatus = published ? 'on_sale' : 'off_sale';
    const newIsPublished = published ? 1 : 0;

    await row.update({ status: newStatus, is_published: newIsPublished });
    ok(res, normalizeGoods(row), published ? '上架成功' : '下架成功');
  } catch (err) {
    console.error('[merchant/goods/shelf]', err);
    fail(res, '上下架操作失败', 500);
  }
};

// ===== 7.3 订单管理（由主后端实现） =====

// GET /market/merchant/orders
exports.getOrders = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const where = { shop_id: shop.id };
    if (req.query.order_status) where.order_status = req.query.order_status;
    if (req.query.pay_status) where.pay_status = req.query.pay_status;
    const { count, rows } = await MarketOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    const buyerIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    let buyerNickMap = {};
    if (buyerIds.length && User) {
      const buyers = await User.findAll({
        where: { id: buyerIds },
        attributes: ['id', 'nickname', 'userName', 'name', 'phone', 'userMobile']
      });
      buyers.forEach((u) => {
        const plain = u.get ? u.get({ plain: true }) : u;
        const nm = plain.nickname || plain.userName || plain.name || plain.phone || plain.userMobile || '';
        buyerNickMap[plain.id] = nm;
      });
    }
    const list = [];
    for (const row of rows) {
      const items = await MarketOrderItem.findAll({ where: { order_no: row.order_no } });
      list.push({
        id: row.id,
        order_no: row.order_no,
        user_id: row.user_id,
        buyer_user_id: row.user_id,
        buyer_nickname: buyerNickMap[row.user_id] || '',
        order_status: row.order_status,
        pay_status: row.pay_status,
        payable_amount: Number(row.payable_amount).toFixed(2),
        receiver_name: row.receiver_name,
        receiver_phone: row.receiver_phone,
        receiver_address: row.receiver_address,
        remark: row.remark,
        delivery_mode: row.delivery_mode,
        delivery_carrier: row.delivery_carrier,
        delivery_job_status: row.delivery_job_status,
        created_at: row.created_at,
        items: items.map((it) => ({
          goods_id: it.goods_id,
          goods_name: it.goods_name_snapshot,
          quantity: it.quantity,
          unit_price: Number(it.unit_price_snapshot).toFixed(2),
          amount: Number(it.amount).toFixed(2),
          image: it.goods_image_snapshot
        }))
      });
    }
    ok(res, { list, total: count, page, limit });
  } catch (err) {
    console.error('[merchant/orders/list]', err);
    fail(res, '获取订单列表失败', 500);
  }
};

// GET /market/merchant/orders/:orderNo
exports.getOrderDetail = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, shop_id: shop.id } });
    if (!row) return fail(res, '订单不存在', 404);
    const items = await MarketOrderItem.findAll({ where: { order_no: orderNo } });
    ok(res, {
      order: {
        id: row.id,
        order_no: row.order_no,
        user_id: row.user_id,
        buyer_user_id: row.user_id,
        order_status: row.order_status,
        pay_status: row.pay_status,
        goods_amount: Number(row.goods_amount).toFixed(2),
        delivery_fee: Number(row.delivery_fee).toFixed(2),
        discount_amount: Number(row.discount_amount).toFixed(2),
        payable_amount: Number(row.payable_amount).toFixed(2),
        receiver_name: row.receiver_name,
        receiver_phone: row.receiver_phone,
        receiver_address: row.receiver_address,
        remark: row.remark,
        delivery_mode: row.delivery_mode,
        delivery_carrier: row.delivery_carrier,
        delivery_job_status: row.delivery_job_status,
        delivery_external_no: row.delivery_external_no,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      delivery: await (async () => {
        try {
          const deliverySvc = require('../../../services/marketDelivery.service');
          return await deliverySvc.getDeliveryView(orderNo);
        } catch (e) {
          return { has_delivery: false, timeline: [] };
        }
      })(),
      items: items.map((it) => ({
        goods_id: it.goods_id,
        goods_name: it.goods_name_snapshot,
        quantity: it.quantity,
        unit_price: Number(it.unit_price_snapshot).toFixed(2),
        amount: Number(it.amount).toFixed(2),
        image: it.goods_image_snapshot
      }))
    });
  } catch (err) {
    console.error('[merchant/orders/detail]', err);
    fail(res, '获取订单详情失败', 500);
  }
};

// POST /market/merchant/orders/:orderNo/action
exports.orderAction = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);
    const orderNo = String(req.params.orderNo || '').trim();
    const action = String((req.body || {}).action || '').trim();
    const note = String((req.body || {}).note || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, shop_id: shop.id } });
    if (!row) return fail(res, '订单不存在', 404);
    if (action === 'accept') {
      if (row.order_status !== 'pending_accept') return fail(res, '当前状态不可接单');
      await row.update({ order_status: 'pending_service' });
    } else if (action === 'reject') {
      if (row.order_status !== 'pending_accept') return fail(res, '当前状态不可拒单');
      const items = await MarketOrderItem.findAll({ where: { order_no: orderNo } });
      for (const it of items) {
        await MerchantGoods.increment('stock', { by: Number(it.quantity), where: { id: it.goods_id } });
        await MerchantGoods.increment('sales_count', { by: -Number(it.quantity), where: { id: it.goods_id } });
      }
      if (row.pay_status === 'paid') {
        await orderPoints.revokePointsOnOrderRefund(MarketOrder, row, null);
      }
      await row.update({ order_status: 'cancelled', pay_status: row.pay_status === 'paid' ? 'refunded' : row.pay_status, cancel_reason: note || '商家拒单', cancelled_at: new Date() });
      await MarketRefundOrder.create({
        order_no: row.order_no,
        user_id: row.user_id,
        shop_id: row.shop_id,
        status: 'approved',
        reason: note || '商家拒单退款',
        amount: row.payable_amount,
        decided_at: new Date(),
        decided_by: `merchant:${userId}`
      }).catch(() => {});
    } else if (action === 'dispatch') {
      if (row.order_status !== 'pending_service') return fail(res, '当前状态不可发货');
      if (row.delivery_carrier && row.delivery_carrier !== 'self') {
        return fail(res, '已使用三方配送，请在配送进度中查看状态');
      }
      const deliverySvc = require('../../../services/marketDelivery.service');
      if (!row.delivery_carrier) {
        await deliverySvc.launchDelivery(row, shop, 'self');
      } else {
        await row.update({ order_status: 'pending_receipt', delivered_at: new Date() });
      }
    } else if (action === 'complete_delivery') {
      if (!['pending_receipt', 'pending_service'].includes(String(row.order_status))) return fail(res, '当前状态不可完成配送');
      await row.update({ order_status: 'completed', completed_at: new Date() });
      await row.reload();
      try {
        const orderSettlement = require('../../../services/orderSettlement.service');
        await orderSettlement.settleMarketOrder(row);
      } catch (se) {
        console.warn('[merchant/complete_delivery/settlement]', se.message);
      }
    } else if (action === 'delivered') {
      if (!['pending_receipt', 'pending_service'].includes(String(row.order_status))) return fail(res, '当前状态不可标记送达');
      const deliverySvc = require('../../../services/marketDelivery.service');
      if (row.delivery_carrier === 'self' || !row.delivery_carrier) {
        await deliverySvc.completeSelfDelivery(orderNo);
      } else {
        await row.update({ order_status: 'pending_receipt', delivered_at: new Date() });
      }
    } else {
      return fail(res, '不支持的操作');
    }
    ok(res, {
      order_no: row.order_no,
      order_status: row.order_status,
      pay_status: row.pay_status
    }, '操作成功');
  } catch (err) {
    console.error('[merchant/orders/action]', err);
    fail(res, '订单操作失败', 500);
  }
};

// GET /market/merchant/payments
exports.getPayments = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const { count, rows } = await MarketOrder.findAndCountAll({
      where: { shop_id: shop.id },
      order: [['paid_at', 'DESC'], ['updated_at', 'DESC']],
      limit,
      offset
    });
    ok(res, {
      list: rows.map((r) => ({
        order_no: r.order_no,
        pay_status: r.pay_status,
        amount: Number(r.payable_amount).toFixed(2),
        paid_at: r.paid_at,
        created_at: r.created_at
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[merchant/payments]', err);
    fail(res, '获取支付记录失败', 500);
  }
};

// ===== 7.4 客户管理 =====

// GET /market/merchant/customers/list
exports.getCustomers = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    // 聚合该店铺所有下单用户（按用户分组统计）
    const { count, rows } = await MarketOrder.findAndCountAll({
      where: { shop_id: shop.id },
      attributes: [
        'user_id',
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'order_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('payable_amount')), 'total_amount']
      ],
      group: ['user_id'],
      order: [[db.Sequelize.fn('MAX', db.Sequelize.col('created_at')), 'DESC']],
      limit,
      offset,
      raw: true
    });

    const list = (Array.isArray(rows) ? rows : []).map((r) => ({
      user_id: r.user_id,
      order_count: parseInt(r.order_count, 10) || 0,
      total_amount: Number(r.total_amount || 0).toFixed(2)
    }));

    ok(res, { list, total: Array.isArray(count) ? count.length : count, page, limit });
  } catch (err) {
    console.error('[merchant/customers]', err);
    fail(res, '获取客户列表失败', 500);
  }
};

// GET /market/merchant/customers/:id/orders
exports.getCustomerOrders = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const customerId = Number(req.params.id);
    if (!customerId) return fail(res, '无效客户ID');

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await MarketOrder.findAndCountAll({
      where: { shop_id: shop.id, user_id: customerId },
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    const list = [];
    for (const row of rows) {
      const items = await MarketOrderItem.findAll({ where: { order_no: row.order_no } });
      list.push({
        id: row.id,
        order_no: row.order_no,
        order_status: row.order_status,
        pay_status: row.pay_status,
        payable_amount: Number(row.payable_amount).toFixed(2),
        receiver_name: row.receiver_name,
        receiver_phone: row.receiver_phone,
        receiver_address: row.receiver_address,
        created_at: row.created_at,
        items: items.map((it) => ({
          goods_id: it.goods_id,
          goods_name: it.goods_name_snapshot,
          quantity: it.quantity,
          unit_price: Number(it.unit_price_snapshot).toFixed(2),
          amount: Number(it.amount).toFixed(2),
          image: it.goods_image_snapshot
        }))
      });
    }

    ok(res, { list, total: count, page, limit });
  } catch (err) {
    console.error('[merchant/customer/orders]', err);
    fail(res, '获取客户订单失败', 500);
  }
};

// GET /market/merchant/customers/:id/stats
exports.getCustomerStats = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const customerId = Number(req.params.id);
    if (!customerId) return fail(res, '无效客户ID');

    const [stats] = await MarketOrder.findAll({
      where: { shop_id: shop.id, user_id: customerId },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'order_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('payable_amount')), 'total_amount'],
        [db.Sequelize.fn('MAX', db.Sequelize.col('created_at')), 'last_order_at']
      ],
      raw: true
    });

    const orderCount = parseInt(stats && stats.order_count, 10) || 0;
    const totalAmount = Number(stats && stats.total_amount || 0).toFixed(2);

    // 统计各状态订单数
    const statusRows = await MarketOrder.findAll({
      where: { shop_id: shop.id, user_id: customerId },
      attributes: ['order_status', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'cnt']],
      group: ['order_status'],
      raw: true
    });
    const statusMap = {};
    for (const s of statusRows) {
      statusMap[s.order_status] = parseInt(s.cnt, 10) || 0;
    }

    ok(res, {
      user_id: customerId,
      order_count: orderCount,
      total_amount: totalAmount,
      last_order_at: stats && stats.last_order_at || null,
      status_breakdown: statusMap
    });
  } catch (err) {
    console.error('[merchant/customer/stats]', err);
    fail(res, '获取客户统计失败', 500);
  }
};

// ===== 7.5 营销管理 =====

// GET /market/merchant/marketing/coupons
exports.getMarketingCoupons = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const CouponTemplate = db.CouponTemplate;
    if (!CouponTemplate) {
      return ok(res, { list: [], total: 0, page, limit });
    }

    const { count, rows } = await CouponTemplate.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    const list = rows.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      discount_amount: t.discount_amount,
      threshold_amount: t.threshold_amount,
      total_count: t.total_count,
      issued_count: t.issued_count,
      valid_from: t.valid_from,
      valid_to: t.valid_to,
      status: t.status
    }));

    ok(res, { list, total: count, page, limit });
  } catch (err) {
    console.error('[merchant/marketing/coupons]', err);
    fail(res, '获取优惠券列表失败', 500);
  }
};

// POST /market/merchant/marketing/coupons
exports.createMarketingCoupon = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return fail(res, '优惠券名称不能为空');

    const CouponTemplate = db.CouponTemplate;
    if (!CouponTemplate) {
      return fail(res, '优惠券模块暂不可用', 503);
    }

    const discountAmount = parseFloat(body.discount_amount || body.coupon_money || 0);
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
      return fail(res, '优惠金额必须大于0');
    }

    const row = await CouponTemplate.create({
      name,
      type: body.type || 'fixed_amount',
      discount_amount: discountAmount,
      threshold_amount: parseFloat(body.threshold_amount || 0) || 0,
      total_count: parseInt(body.total_count || 100, 10) || 100,
      issued_count: 0,
      valid_from: body.valid_from || new Date(),
      valid_to: body.valid_to || null,
      status: body.status || 'active'
    });

    ok(res, {
      id: row.id,
      name: row.name,
      type: row.type,
      discount_amount: row.discount_amount,
      threshold_amount: row.threshold_amount,
      status: row.status
    }, '创建成功');
  } catch (err) {
    console.error('[merchant/marketing/coupons/create]', err);
    fail(res, '创建优惠券失败', 500);
  }
};

// POST /market/merchant/marketing/coupons/:id
exports.updateMarketingCoupon = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效优惠券ID');

    const CouponTemplate = db.CouponTemplate;
    if (!CouponTemplate) {
      return fail(res, '优惠券模块暂不可用', 503);
    }

    const row = await CouponTemplate.findByPk(id);
    if (!row) return fail(res, '优惠券不存在', 404);

    const body = req.body || {};
    const updateData = {};
    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.discount_amount !== undefined) {
      const v = parseFloat(body.discount_amount);
      if (Number.isFinite(v) && v > 0) updateData.discount_amount = v;
    }
    if (body.threshold_amount !== undefined) updateData.threshold_amount = parseFloat(body.threshold_amount) || 0;
    if (body.total_count !== undefined) updateData.total_count = parseInt(body.total_count, 10) || 0;
    if (body.valid_from !== undefined) updateData.valid_from = body.valid_from;
    if (body.valid_to !== undefined) updateData.valid_to = body.valid_to;
    if (body.status !== undefined) updateData.status = body.status;

    await row.update(updateData);
    ok(res, { id: row.id, name: row.name, status: row.status }, '更新成功');
  } catch (err) {
    console.error('[merchant/marketing/coupons/update]', err);
    fail(res, '更新优惠券失败', 500);
  }
};

// GET /market/merchant/marketing/stats
exports.getMarketingStats = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    // 基于订单数据聚合营销统计
    const [totalStats] = await MarketOrder.findAll({
      where: { shop_id: shop.id },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'order_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('payable_amount')), 'total_amount'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('discount_amount')), 'total_discount']
      ],
      raw: true
    });

    const paidStats = await MarketOrder.findAll({
      where: { shop_id: shop.id, pay_status: 'paid' },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'paid_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('payable_amount')), 'paid_amount']
      ],
      raw: true
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayStats] = await MarketOrder.findAll({
      where: { shop_id: shop.id, created_at: { [db.Sequelize.Op.gte]: todayStart } },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'today_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('payable_amount')), 'today_amount']
      ],
      raw: true
    });

    ok(res, {
      order_count: parseInt(totalStats && totalStats.order_count, 10) || 0,
      total_amount: Number(totalStats && totalStats.total_amount || 0).toFixed(2),
      total_discount: Number(totalStats && totalStats.total_discount || 0).toFixed(2),
      paid_count: parseInt(paidStats[0] && paidStats[0].paid_count, 10) || 0,
      paid_amount: Number(paidStats[0] && paidStats[0].paid_amount || 0).toFixed(2),
      today_count: parseInt(todayStats && todayStats.today_count, 10) || 0,
      today_amount: Number(todayStats && todayStats.today_amount || 0).toFixed(2)
    });
  } catch (err) {
    console.error('[merchant/marketing/stats]', err);
    fail(res, '获取营销统计失败', 500);
  }
};

// ===== 7.6 退款管理 =====

// GET /market/merchant/refunds/list
exports.getRefunds = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const where = { shop_id: shop.id };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await MarketRefundOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    const list = rows.map((r) => ({
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      amount: Number(r.amount).toFixed(2),
      status: r.status,
      reason: r.reason,
      decided_at: r.decided_at,
      decided_by: r.decided_by,
      created_at: r.created_at
    }));

    ok(res, { list, total: count, page, limit });
  } catch (err) {
    console.error('[merchant/refunds]', err);
    fail(res, '获取退款列表失败', 500);
  }
};

// GET /market/merchant/refunds/:id
exports.getRefundDetail = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效退款ID');

    const row = await MarketRefundOrder.findOne({ where: { id, shop_id: shop.id } });
    if (!row) return fail(res, '退款记录不存在', 404);

    // 关联订单信息
    const order = await MarketOrder.findOne({ where: { order_no: row.order_no } });
    const items = order ? await MarketOrderItem.findAll({ where: { order_no: row.order_no } }) : [];

    ok(res, {
      refund: {
        id: row.id,
        order_no: row.order_no,
        user_id: row.user_id,
        amount: Number(row.amount).toFixed(2),
        status: row.status,
        reason: row.reason,
        decided_at: row.decided_at,
        decided_by: row.decided_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      order: order ? {
        order_no: order.order_no,
        order_status: order.order_status,
        pay_status: order.pay_status,
        payable_amount: Number(order.payable_amount).toFixed(2),
        receiver_name: order.receiver_name,
        receiver_phone: order.receiver_phone
      } : null,
      items: items.map((it) => ({
        goods_id: it.goods_id,
        goods_name: it.goods_name_snapshot,
        quantity: it.quantity,
        unit_price: Number(it.unit_price_snapshot).toFixed(2),
        amount: Number(it.amount).toFixed(2),
        image: it.goods_image_snapshot
      }))
    });
  } catch (err) {
    console.error('[merchant/refund/detail]', err);
    fail(res, '获取退款详情失败', 500);
  }
};

// POST /market/merchant/refunds/:id/approve
exports.approveRefund = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效退款ID');

    const row = await MarketRefundOrder.findOne({ where: { id, shop_id: shop.id } });
    if (!row) return fail(res, '退款记录不存在', 404);
    if (row.status !== 'pending') return fail(res, '当前退款状态不可操作');

    await row.update({
      status: 'approved',
      decided_at: new Date(),
      decided_by: `merchant:${userId}`
    });

    const mo = await MarketOrder.findOne({ where: { order_no: row.order_no, shop_id: shop.id } });
    if (mo) await orderPoints.revokePointsOnOrderRefund(MarketOrder, mo, null);

    // 同步更新关联订单的退款状态
    await MarketOrder.update(
      { pay_status: 'refunded', order_status: 'cancelled' },
      { where: { order_no: row.order_no, shop_id: shop.id } }
    );

    ok(res, { id: row.id, status: 'approved' }, '退款已同意');
  } catch (err) {
    console.error('[merchant/refund/approve]', err);
    fail(res, '操作失败', 500);
  }
};

// POST /market/merchant/refunds/:id/reject
exports.rejectRefund = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效退款ID');

    const row = await MarketRefundOrder.findOne({ where: { id, shop_id: shop.id } });
    if (!row) return fail(res, '退款记录不存在', 404);
    if (row.status !== 'pending') return fail(res, '当前退款状态不可操作');

    const reason = String((req.body || {}).reason || '').trim();

    await row.update({
      status: 'rejected',
      reason: reason || row.reason,
      decided_at: new Date(),
      decided_by: `merchant:${userId}`
    });

    ok(res, { id: row.id, status: 'rejected' }, '退款已拒绝');
  } catch (err) {
    console.error('[merchant/refund/reject]', err);
    fail(res, '操作失败', 500);
  }
};

// GET /market/merchant/refunds/stats/summary
exports.getRefundStats = async (req, res) => {
  try {
    await ensureMerchantOrderTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shop = await getShopByUser(userId);
    if (!shop) return fail(res, '暂无店铺信息', 404);

    const [totalStats] = await MarketRefundOrder.findAll({
      where: { shop_id: shop.id },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'total_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount']
      ],
      raw: true
    });

    const statusRows = await MarketRefundOrder.findAll({
      where: { shop_id: shop.id },
      attributes: ['status', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'cnt']],
      group: ['status'],
      raw: true
    });

    const statusMap = {};
    for (const s of statusRows) {
      statusMap[s.status] = parseInt(s.cnt, 10) || 0;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayStats] = await MarketRefundOrder.findAll({
      where: { shop_id: shop.id, created_at: { [db.Sequelize.Op.gte]: todayStart } },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'today_count'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'today_amount']
      ],
      raw: true
    });

    ok(res, {
      total_count: parseInt(totalStats && totalStats.total_count, 10) || 0,
      total_amount: Number(totalStats && totalStats.total_amount || 0).toFixed(2),
      status_breakdown: statusMap,
      today_count: parseInt(todayStats && todayStats.today_count, 10) || 0,
      today_amount: Number(todayStats && todayStats.today_amount || 0).toFixed(2)
    });
  } catch (err) {
    console.error('[merchant/refund/stats]', err);
    fail(res, '获取退款统计失败', 500);
  }
};

// GET /market/merchant/balance — 集市商家个人余额（净收入入账）
exports.getBalance = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const commissionService = require('../../commission/services/commission.service');
    const summary = await commissionService.getUserBalance(userId);
    const merchant = summary.roles.find((r) => r.role === 'merchant') || {
      total_earned: 0,
      available_amount: 0,
      withdrawn_amount: 0,
      pending_amount: 0
    };
    ok(res, {
      balance: merchant.available_amount,
      market_merchant_balance: merchant.available_amount,
      available_amount: merchant.available_amount,
      pending_amount: merchant.pending_amount,
      withdrawn_amount: merchant.withdrawn_amount,
      total_earned: merchant.total_earned,
      commission_summary: summary
    });
  } catch (err) {
    console.error('[merchant/balance]', err);
    fail(res, '获取余额失败', 500);
  }
};

// POST /market/merchant/withdraw
exports.withdraw = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const amount = Number(req.body && req.body.amount);
    if (!(amount > 0)) return fail(res, '提现金额需大于0');

    const commissionService = require('../../commission/services/commission.service');
    const { PromoterWithdrawal } = require('../../../models');

    const summary = await commissionService.getUserBalance(userId);
    const merchant = summary.roles.find((r) => r.role === 'merchant');
    const available = merchant ? Number(merchant.available_amount) : 0;
    if (amount > available) return fail(res, '可提现金额不足');

    const withdrawal = await PromoterWithdrawal.create({
      user_id: userId,
      amount,
      status: 'pending',
      remark: 'market_merchant'
    });
    await commissionService.withdrawFromRole(userId, 'merchant', amount);

    ok(res, { id: withdrawal.id, amount, status: withdrawal.status }, '提现申请已提交');
  } catch (err) {
    console.error('[merchant/withdraw]', err);
    fail(res, err.message || '提现失败', 500);
  }
};
