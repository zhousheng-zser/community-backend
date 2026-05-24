const db = require('../../../models');
const { MerchantShop, MerchantGoods, MarketShopCategory, MarketCartItem, MarketOrder, MarketOrderItem, MarketRefundOrder } = db;
const couponService = require('../../coupon/services/coupon.service');
const orderPoints = require('../../../services/orderPoints.service');
const commissionService = require('../../commission/services/commission.service');
const orderSettlement = require('../../../services/orderSettlement.service');
const platformFeeService = require('../../../services/platformFee.service');
const { resolveUserIdFromReq } = require('../../../utils/resolveUserId');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });
let marketTablesReady = false;

async function ensureMarketTables() {
  if (marketTablesReady) return;
  await Promise.all([
    MarketCartItem && MarketCartItem.sync ? MarketCartItem.sync() : Promise.resolve(),
    MarketOrder && MarketOrder.sync ? MarketOrder.sync() : Promise.resolve(),
    MarketOrderItem && MarketOrderItem.sync ? MarketOrderItem.sync() : Promise.resolve(),
    MarketRefundOrder && MarketRefundOrder.sync ? MarketRefundOrder.sync() : Promise.resolve()
  ]);
  marketTablesReady = true;
}

function getUserId(req) {
  return resolveUserIdFromReq(req);
}

function isAdmin(req) {
  const roleRaw = req.user && req.user.role;
  if (Array.isArray(roleRaw)) return roleRaw.includes('admin');
  if (typeof roleRaw === 'string') return roleRaw.split(',').map((x) => x.trim()).includes('admin');
  return false;
}

// POST /market/apply
exports.apply = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const body = req.body || {};
    const shopName = String(body.shop_name || body.shopName || '').trim();
    const contactName = String(body.contact_name || body.contactName || '').trim();
    const phone = String(body.phone || '').trim();

    if (!shopName) return fail(res, '商家名称不能为空');
    if (!contactName) return fail(res, '联系人姓名不能为空');
    if (!phone) return fail(res, '联系电话不能为空');

    // 检查是否已有申请记录
    const existing = await MerchantShop.findOne({
      where: { user_id: userId },
      order: [['created_at', 'DESC']]
    });

    if (existing) {
      if (existing.status === 'approved') {
        return fail(res, '您已是认证商家，无需重复申请');
      }
      // 更新已有记录
      await existing.update({
        name: shopName,
        contact_name: contactName,
        contact_phone: phone,
        address: body.address || existing.address,
        latitude: body.latitude != null ? Number(body.latitude) : existing.latitude,
        longitude: body.longitude != null ? Number(body.longitude) : existing.longitude,
        description: body.description || existing.description,
        category: body.category || existing.category,
        logo: body.logo_url || body.logoUrl || existing.logo,
        status: 'pending',
        reject_reason: ''
      });
      return ok(res, { id: existing.id, status: 'pending' }, '提交成功，等待审核');
    }

    // 创建新店铺
    const shop = await MerchantShop.create({
      user_id: userId,
      name: shopName,
      contact_name: contactName,
      contact_phone: phone,
      address: body.address || '',
      latitude: body.latitude != null ? Number(body.latitude) : null,
      longitude: body.longitude != null ? Number(body.longitude) : null,
      description: body.description || '',
      category: body.category || '',
      logo: body.logo_url || body.logoUrl || '',
      status: 'pending',
      reject_reason: ''
    });

    ok(res, { id: shop.id, status: 'pending' }, '提交成功，等待审核');
  } catch (err) {
    console.error('[market/apply]', err);
    fail(res, '提交失败，请重试', 500);
  }
};

// GET /market/search
exports.search = async (req, res) => {
  try {
    const query = req.query || {};
    const keyword = String(query.keyword || '').trim();
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const offset = (page - 1) * limit;
    const type = String(query.type || 'all').trim(); // all | shop | goods

    const result = { shops: [], goods: [] };

    if (type === 'all' || type === 'shop') {
      const shopWhere = { status: 'approved' };
      if (keyword) {
        shopWhere.name = { [db.Sequelize.Op.like]: `%${keyword}%` };
      }
      const { count, rows } = await MerchantShop.findAndCountAll({
        where: shopWhere,
        order: [['created_at', 'DESC']],
        limit: type === 'all' ? Math.min(limit, 10) : limit,
        offset
      });
      result.shops = rows.map((r) => ({
        id: r.id,
        name: r.name,
        logo: r.logo,
        address: r.address,
        category: r.category,
        description: r.description,
        type: 'shop'
      }));
      result.shopTotal = count;
    }

    if (type === 'all' || type === 'goods') {
      const goodsWhere = { status: 'on_sale', is_published: 1 };
      if (keyword) {
        goodsWhere[db.Sequelize.Op.or] = [
          { name: { [db.Sequelize.Op.like]: `%${keyword}%` } },
          { title: { [db.Sequelize.Op.like]: `%${keyword}%` } }
        ];
      }
      const { count, rows } = await MerchantGoods.findAndCountAll({
        where: goodsWhere,
        order: [['sort_order', 'DESC'], ['created_at', 'DESC']],
        limit: type === 'all' ? Math.min(limit, 10) : limit,
        offset
      });
      const shopIds = [...new Set(rows.map((r) => r.shop_id).filter(Boolean))];
      const shops = shopIds.length ? await MerchantShop.findAll({
        where: { id: shopIds, status: 'approved' },
        attributes: ['id', 'name', 'logo']
      }) : [];
      const shopMap = new Map(shops.map((s) => [s.id, s]));
      result.goods = rows.map((r) => {
        const shop = shopMap.get(r.shop_id);
        return {
          id: r.id,
          name: r.name,
          title: r.title || r.name,
          main_image: r.main_image,
          price: Number(r.price),
          stock: r.stock,
          shop_id: r.shop_id,
          shop_name: shop ? shop.name : '',
          type: 'goods'
        };
      }).filter((g) => g.shop_name);
      result.goodsTotal = count;
    }

    ok(res, {
      list: [...result.shops, ...result.goods],
      shops: result.shops,
      goods: result.goods,
      total: (result.shopTotal || 0) + (result.goodsTotal || 0),
      page,
      limit,
      keyword
    });
  } catch (err) {
    console.error('[market/search]', err);
    fail(res, '搜索失败', 500);
  }
};

// GET /market/shops
exports.getShops = async (req, res) => {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const offset = (page - 1) * limit;

    const where = { status: 'approved' };
    // 支持按名称搜索
    if (query.keyword) {
      where.name = { [db.Sequelize.Op.like]: `%${String(query.keyword).trim()}%` };
    }
    // 支持按分类筛选
    if (query.category) {
      where.category = String(query.category).trim();
    }

    const { count, rows } = await MerchantShop.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map((r) => ({
        id: r.id,
        name: r.name,
        logo: r.logo,
        address: r.address,
        category: r.category,
        business_hours: r.business_hours,
        description: r.description,
        latitude: r.latitude,
        longitude: r.longitude
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[market/shops]', err);
    fail(res, '获取店铺列表失败', 500);
  }
};

// GET /market/shops/:shopId
exports.getShopDetail = async (req, res) => {
  try {
    const shopId = Number(req.params.shopId);
    if (!shopId) return fail(res, '无效店铺ID');

    const shop = await MerchantShop.findByPk(shopId);
    if (!shop) return fail(res, '店铺不存在', 404);
    if (shop.status !== 'approved') return fail(res, '店铺暂未通过审核', 403);

    // 统计商品数量
    const goodsCount = await MerchantGoods.count({
      where: { shop_id: shopId, status: 'on_sale', is_published: 1 }
    });

    ok(res, {
      id: shop.id,
      name: shop.name,
      logo: shop.logo || shop.logo_url || '',
      logo_url: shop.logo_url || shop.logo || '',
      cover_url: shop.cover_url || shop.cover || '',
      cover: shop.cover_url || shop.cover || '',
      contact_name: shop.contact_name,
      contact_phone: shop.contact_phone,
      address: shop.address,
      latitude: shop.latitude,
      longitude: shop.longitude,
      business_hours: shop.business_hours,
      description: shop.description,
      category: shop.category,
      goods_count: goodsCount
    });
  } catch (err) {
    console.error('[market/shop/detail]', err);
    fail(res, '获取店铺详情失败', 500);
  }
};

// GET /market/shops/:shopId/goods
exports.getShopGoods = async (req, res) => {
  try {
    const shopId = Number(req.params.shopId);
    if (!shopId) return fail(res, '无效店铺ID');

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const where = {
      shop_id: shopId,
      status: 'on_sale',
      is_published: 1
    };

    if (query.category_key) {
      where.category_key = query.category_key;
    }

    const { count, rows } = await MerchantGoods.findAndCountAll({
      where,
      order: [['sort_order', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map((r) => ({
        id: r.id,
        shop_id: r.shop_id,
        name: r.name,
        title: r.title || r.name,
        main_image: r.main_image,
        image: r.main_image,
        price: Number(r.price),
        stock: r.stock,
        safe_stock: r.safe_stock,
        sales_count: r.sales_count,
        description: r.description,
        desc: r.description,
        status: r.status,
        category_key: r.category_key || 'local',
        categoryKey: r.category_key || 'local',
        created_at: r.created_at
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[market/shops/goods]', err);
    fail(res, '获取店铺商品失败', 500);
  }
};

// GET /market/shops/:shopId/categories
exports.getShopCategories = async (req, res) => {
  try {
    const shopId = Number(req.params.shopId);
    if (!shopId) return fail(res, '无效店铺ID');

    const rows = await MarketShopCategory.findAll({
      where: { shop_id: shopId },
      order: [['sort_order', 'ASC'], ['id', 'ASC']]
    });

    ok(res, {
      list: rows.map((r) => ({
        id: r.id,
        shop_id: r.shop_id,
        category_key: r.category_key,
        categoryKey: r.category_key,
        category_name: r.category_name,
        categoryName: r.category_name,
        sort_order: r.sort_order
      }))
    });
  } catch (err) {
    console.error('[market/shops/categories]', err);
    fail(res, '获取店铺分类失败', 500);
  }
};

// GET /market/goods/:goodsId
exports.getGoodsDetail = async (req, res) => {
  try {
    const goodsId = Number(req.params.goodsId);
    if (!goodsId) return fail(res, '无效商品ID');

    const row = await MerchantGoods.findByPk(goodsId);
    if (!row) return fail(res, '商品不存在', 404);

    // 查询所属店铺信息
    const shop = await MerchantShop.findByPk(row.shop_id);

    ok(res, {
      id: row.id,
      shop_id: row.shop_id,
      name: row.name,
      title: row.title || row.name,
      main_image: row.main_image,
      image: row.main_image,
      price: Number(row.price),
      original_price: row.original_price ? Number(row.original_price) : null,
      stock: row.stock,
      safe_stock: row.safe_stock,
      sales_count: row.sales_count,
      description: row.description,
      desc: row.description,
      status: row.status,
      is_published: row.is_published,
      category_key: row.category_key || 'local',
      categoryKey: row.category_key || 'local',
      shop: shop ? {
        id: shop.id,
        name: shop.name,
        address: shop.address
      } : null
    });
  } catch (err) {
    console.error('[market/goods/detail]', err);
    fail(res, '获取商品详情失败', 500);
  }
};

// GET /market/shops/:shopId/contact
exports.getShopContact = async (req, res) => {
  try {
    const shopId = Number(req.params.shopId);
    if (!shopId) return fail(res, '无效店铺ID');
    const shop = await MerchantShop.findByPk(shopId);
    if (!shop) return fail(res, '店铺不存在', 404);
    ok(res, {
      shop_id: shop.id,
      shop_name: shop.name,
      contact_name: shop.contact_name || '',
      contact_phone: shop.contact_phone || ''
    });
  } catch (err) {
    console.error('[market/shops/contact]', err);
    fail(res, '获取商家联系方式失败', 500);
  }
};

function mapCartGoods(g) {
  if (!g) return null;
  const onSale = g.status === 'on_sale' && g.is_published !== false && g.is_published !== 0;
  return {
    id: g.id,
    name: g.name,
    title: g.title || g.name,
    image: g.main_image,
    main_image: g.main_image,
    price: String(g.price),
    stock: g.stock,
    status: g.status,
    is_published: g.is_published,
    invalid: !onSale || Number(g.stock) <= 0
  };
}

function mapCartRow(r, goodsMap, shopMap) {
  const g = goodsMap.get(Number(r.goods_id));
  const shop = shopMap.get(Number(r.shop_id));
  const goods = mapCartGoods(g);
  const price = goods ? Number(goods.price) || 0 : 0;
  const qty = Number(r.quantity) || 0;
  return {
    id: r.id,
    shop_id: r.shop_id,
    shop_name: shop ? shop.name : '',
    goods_id: r.goods_id,
    quantity: qty,
    subtotal: (price * qty).toFixed(2),
    invalid: !goods || goods.invalid,
    goods
  };
}

// GET /market/cart/summary
exports.getCartSummary = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const rows = await MarketCartItem.findAll({
      where: { user_id: userId },
      attributes: ['quantity', 'shop_id']
    });
    const itemCount = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const shopIds = [...new Set(rows.map((r) => Number(r.shop_id)).filter(Boolean))];
    ok(res, {
      item_count: itemCount,
      sku_count: rows.length,
      shop_count: shopIds.length
    });
  } catch (err) {
    console.error('[market/cart/summary]', err);
    fail(res, '获取购物车数量失败', 500);
  }
};

// GET /market/cart
exports.getCart = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shopId = Number(req.query.shop_id || req.query.shopId || 0);
    const where = { user_id: userId };
    if (shopId) where.shop_id = shopId;
    const rows = await MarketCartItem.findAll({ where, order: [['created_at', 'DESC']] });
    const goodsIds = [...new Set(rows.map((r) => Number(r.goods_id)).filter(Boolean))];
    const shopIds = [...new Set(rows.map((r) => Number(r.shop_id)).filter(Boolean))];
    const [goodsRows, shopRows] = await Promise.all([
      goodsIds.length ? MerchantGoods.findAll({ where: { id: goodsIds } }) : [],
      shopIds.length ? MerchantShop.findAll({ where: { id: shopIds } }) : []
    ]);
    const goodsMap = new Map(goodsRows.map((g) => [Number(g.id), g]));
    const shopMap = new Map(shopRows.map((s) => [Number(s.id), s]));
    const list = rows.map((r) => mapCartRow(r, goodsMap, shopMap));

    const itemCount = list.reduce((s, it) => s + Number(it.quantity || 0), 0);
    let groups = null;
    if (!shopId) {
      const byShop = new Map();
      list.forEach((item) => {
        const sid = Number(item.shop_id);
        if (!byShop.has(sid)) {
          const shop = shopMap.get(sid);
          byShop.set(sid, {
            shop_id: sid,
            shop_name: shop ? shop.name : (item.shop_name || '店铺'),
            shop_logo: shop && (shop.logo || shop.cover_image) ? (shop.logo || shop.cover_image) : '',
            items: [],
            subtotal: '0.00',
            item_count: 0
          });
        }
        const g = byShop.get(sid);
        g.items.push(item);
        if (!item.invalid) {
          g.item_count += Number(item.quantity || 0);
          g.subtotal = (Number(g.subtotal) + Number(item.subtotal || 0)).toFixed(2);
        }
      });
      groups = Array.from(byShop.values());
    }

    ok(res, {
      list,
      groups,
      summary: {
        item_count: itemCount,
        sku_count: list.length,
        shop_count: shopId ? 1 : shopIds.length
      }
    });
  } catch (err) {
    console.error('[market/cart/get]', err);
    fail(res, '获取购物车失败', 500);
  }
};

// POST /market/cart/items
exports.addCartItem = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const body = req.body || {};
    const shopId = Number(body.shop_id || body.shopId || 0);
    const goodsId = Number(body.goods_id || body.goodsId || 0);
    const quantity = Math.max(parseInt(body.quantity, 10) || 1, 1);
    if (!shopId || !goodsId) return fail(res, '缺少 shop_id 或 goods_id');
    const good = await MerchantGoods.findOne({ where: { id: goodsId, shop_id: shopId } });
    if (!good) return fail(res, '商品不存在', 404);
    let row = await MarketCartItem.findOne({ where: { user_id: userId, shop_id: shopId, goods_id: goodsId } });
    if (row) {
      await row.update({ quantity: Math.min(row.quantity + quantity, 999) });
    } else {
      row = await MarketCartItem.create({ user_id: userId, shop_id: shopId, goods_id: goodsId, quantity: Math.min(quantity, 999) });
    }
    ok(res, { id: row.id, quantity: row.quantity }, '加入购物车成功');
  } catch (err) {
    console.error('[market/cart/add]', err);
    fail(res, '加入购物车失败', 500);
  }
};

// PUT /market/cart/items/:itemId
exports.updateCartItem = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const itemId = Number(req.params.itemId);
    if (!itemId) return fail(res, '无效购物车项');
    const quantity = Math.max(parseInt((req.body || {}).quantity, 10) || 0, 0);
    const row = await MarketCartItem.findOne({ where: { id: itemId, user_id: userId } });
    if (!row) return fail(res, '购物车项不存在', 404);
    if (quantity <= 0) {
      await row.destroy();
      return ok(res, { id: itemId, deleted: true });
    }
    await row.update({ quantity: Math.min(quantity, 999) });
    ok(res, { id: row.id, quantity: row.quantity }, '更新成功');
  } catch (err) {
    console.error('[market/cart/update]', err);
    fail(res, '更新购物车失败', 500);
  }
};

// DELETE /market/cart/items/:itemId
exports.deleteCartItem = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const itemId = Number(req.params.itemId);
    if (!itemId) return fail(res, '无效购物车项');
    await MarketCartItem.destroy({ where: { id: itemId, user_id: userId } });
    ok(res, { id: itemId, deleted: true }, '删除成功');
  } catch (err) {
    console.error('[market/cart/delete]', err);
    fail(res, '删除购物车失败', 500);
  }
};

// DELETE /market/cart
exports.clearCart = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const shopId = Number(req.query.shop_id || req.query.shopId || 0);
    const where = { user_id: userId };
    if (shopId) where.shop_id = shopId;
    const deleted = await MarketCartItem.destroy({ where });
    ok(res, { cleared: true, deleted_count: deleted, shop_id: shopId || null }, shopId ? '已清空该店购物车' : '已清空全部购物车');
  } catch (err) {
    console.error('[market/cart/clear]', err);
    fail(res, '清空购物车失败', 500);
  }
};

// POST /market/orders/preview
exports.previewOrder = async (req, res) => {
  try {
    await ensureMarketTables();
    const body = req.body || {};
    const shopId = Number(body.shop_id || body.shopId || 0);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!shopId || !items.length) return fail(res, '缺少 shop_id 或 items');
    const shop = await MerchantShop.findByPk(shopId);
    if (!shop || shop.status !== 'approved') return fail(res, '店铺不可用', 403);

    let goodsAmount = 0;
    const lines = [];
    for (const it of items) {
      const goodsId = Number(it.goods_id || it.goodsId || 0);
      const qty = Math.max(parseInt(it.quantity || it.qty, 10) || 1, 1);
      const g = await MerchantGoods.findOne({ where: { id: goodsId, shop_id: shopId, status: 'on_sale', is_published: 1 } });
      if (!g) return fail(res, `商品不存在或已下架: ${goodsId}`);
      if (Number(g.stock) < qty) return fail(res, `库存不足: ${g.name}`);
      const lineAmount = Number(g.price) * qty;
      goodsAmount += lineAmount;
      lines.push({
        goods_id: g.id,
        name: g.name,
        image: g.main_image,
        price: Number(g.price).toFixed(2),
        quantity: qty,
        amount: lineAmount.toFixed(2)
      });
    }

    const deliveryFee = body.delivery_mode === 'pickup' ? 0 : 0;
    let discountAmount = 0;
    const userId = getUserId(req);
    const couponIssueId = Number(body.coupon_issue_id || body.couponIssueId || 0) || 0;
    if (userId && couponIssueId > 0) {
      try {
        const applied = await couponService.validateCouponForOrder(
          userId,
          couponIssueId,
          goodsAmount,
          null,
          'market'
        );
        discountAmount = applied.discount;
      } catch (couponErr) {
        return fail(res, couponErr.message || '优惠券不可用', couponErr.statusCode || 400);
      }
    }
    const payableAmount = Number((goodsAmount + deliveryFee - discountAmount).toFixed(2));
    const feeFields = await platformFeeService.calcPlatformFee(payableAmount, 'market');
    ok(res, {
      shop_id: shopId,
      goods_amount: goodsAmount.toFixed(2),
      delivery_fee: deliveryFee.toFixed(2),
      discount_amount: discountAmount.toFixed(2),
      payable_amount: payableAmount.toFixed(2),
      platform_fee_rate: feeFields.platform_fee_rate,
      platform_fee_amount: feeFields.platform_fee_amount,
      settlement_amount: feeFields.settlement_amount,
      coupon_issue_id: couponIssueId || null,
      lines
    });
  } catch (err) {
    console.error('[market/orders/preview]', err);
    fail(res, '预结算失败', 500);
  }
};

// POST /market/orders
exports.createOrder = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) {
      await t.rollback();
      return fail(res, '未登录', 401);
    }
    const body = req.body || {};
    const shopId = Number(body.shop_id || body.shopId || 0);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!shopId || !items.length) {
      await t.rollback();
      return fail(res, '缺少 shop_id 或 items');
    }
    const shop = await MerchantShop.findByPk(shopId, { transaction: t });
    if (!shop || shop.status !== 'approved') {
      await t.rollback();
      return fail(res, '店铺不可用', 403);
    }
    const deliveryMode = body.delivery_mode === 'pickup' ? 'pickup' : 'express';
    const addressObj = (body.address && typeof body.address === 'object') ? body.address : {};
    const receiverName = String(body.receiver_name || addressObj.receiver_name || addressObj.name || '').trim() || null;
    const receiverPhone = String(body.receiver_phone || addressObj.receiver_phone || addressObj.phone || '').trim() || null;
    let receiverAddress = String(
      body.receiver_address || addressObj.receiver_address || addressObj.address || ''
    ).trim();
    if (!receiverAddress && addressObj.detail) {
      receiverAddress = [addressObj.province, addressObj.city, addressObj.district, addressObj.detail]
        .filter(Boolean)
        .join('');
    }
    receiverAddress = receiverAddress || null;
    const receiverLat = addressObj.latitude != null ? Number(addressObj.latitude)
      : (body.receiver_latitude != null ? Number(body.receiver_latitude) : null);
    const receiverLng = addressObj.longitude != null ? Number(addressObj.longitude)
      : (body.receiver_longitude != null ? Number(body.receiver_longitude) : null);
    if (deliveryMode === 'express' && (!receiverPhone || !receiverAddress)) {
      await t.rollback();
      return fail(res, '配送订单请填写收货电话和地址');
    }

    let goodsAmount = 0;
    const orderNo = `MK${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
    const itemRows = [];
    for (const it of items) {
      const goodsId = Number(it.goods_id || it.goodsId || 0);
      const qty = Math.max(parseInt(it.quantity || it.qty, 10) || 1, 1);
      const g = await MerchantGoods.findOne({
        where: { id: goodsId, shop_id: shopId, status: 'on_sale', is_published: 1 },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!g) {
        await t.rollback();
        return fail(res, `商品不存在或已下架: ${goodsId}`);
      }
      if (Number(g.stock) < qty) {
        await t.rollback();
        return fail(res, `库存不足: ${g.name}`);
      }
      const nextStock = Number(g.stock) - qty;
      const nextSales = Number(g.sales_count || 0) + qty;
      await g.update({ stock: nextStock, sales_count: nextSales }, { transaction: t });
      const unit = Number(g.price);
      const amount = Number((unit * qty).toFixed(2));
      goodsAmount += amount;
      itemRows.push({
        order_no: orderNo,
        shop_id: shopId,
        goods_id: g.id,
        goods_name_snapshot: g.name,
        goods_image_snapshot: g.main_image || '',
        unit_price_snapshot: unit,
        quantity: qty,
        amount
      });
    }

    const deliveryFee = deliveryMode === 'pickup' ? 0 : 0;
    let discountAmount = 0;
    let couponIssueId = Number(body.coupon_issue_id || body.couponIssueId || 0) || 0;
    if (couponIssueId > 0) {
      try {
        const applied = await couponService.validateCouponForOrder(userId, couponIssueId, goodsAmount, t, 'market');
        discountAmount = applied.discount;
      } catch (couponErr) {
        await t.rollback();
        return fail(res, couponErr.message || '优惠券不可用', couponErr.statusCode || 400);
      }
    }
    const payableAmount = Number((goodsAmount + deliveryFee - discountAmount).toFixed(2));
    const feeFields = await platformFeeService.calcPlatformFee(payableAmount, 'market');
    const row = await MarketOrder.create({
      order_no: orderNo,
      user_id: userId,
      shop_id: shopId,
      order_status: 'pending_payment',
      pay_status: 'unpaid',
      delivery_mode: deliveryMode,
      goods_amount: goodsAmount,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      payable_amount: payableAmount,
      platform_fee_rate: feeFields.platform_fee_rate,
      platform_fee_amount: feeFields.platform_fee_amount,
      settlement_amount: feeFields.settlement_amount,
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      receiver_address: receiverAddress,
      receiver_latitude: Number.isFinite(receiverLat) ? receiverLat : null,
      receiver_longitude: Number.isFinite(receiverLng) ? receiverLng : null,
      remark: String(body.remark || '').trim() || null,
      expired_at: new Date(Date.now() + 30 * 60 * 1000)
    }, { transaction: t });
    await MarketOrderItem.bulkCreate(itemRows.map((it) => ({ ...it, order_id: row.id })), { transaction: t });
    if (couponIssueId > 0) {
      await couponService.markCouponUsed(couponIssueId, 'market', row.order_no, t);
    }
    await t.commit();
    ok(res, {
      id: row.id,
      orderNo: row.order_no,
      order_no: row.order_no,
      order_status: row.order_status,
      pay_status: row.pay_status,
      goods_amount: Number(row.goods_amount).toFixed(2),
      discount_amount: Number(row.discount_amount).toFixed(2),
      payable_amount: Number(row.payable_amount).toFixed(2)
    }, '订单创建成功');
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    console.error('[market/orders/create]', err);
    fail(res, '创建订单失败', 500);
  }
};

// GET /market/orders
exports.getMyOrders = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size || req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * pageSize;
    const where = { user_id: userId };
    if (req.query.status) where.order_status = String(req.query.status);
    const { count, rows } = await MarketOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset,
      limit: pageSize
    });
    const list = [];
    for (const r of rows) {
      const items = await MarketOrderItem.findAll({ where: { order_no: r.order_no } });
      const shop = await MerchantShop.findByPk(r.shop_id);
      list.push({
        orderNo: r.order_no,
        order_no: r.order_no,
        status: r.order_status,
        order_status: r.order_status,
        amount: Number(r.payable_amount).toFixed(2),
        payable_amount: Number(r.payable_amount).toFixed(2),
        shopName: shop ? shop.name : '',
        shop_name: shop ? shop.name : '',
        shopId: r.shop_id,
        shop_id: r.shop_id,
        items: items.map((it) => ({
          id: it.goods_id,
          goods_id: it.goods_id,
          name: it.goods_name_snapshot,
          goods_name_snapshot: it.goods_name_snapshot,
          image: it.goods_image_snapshot,
          goods_image_snapshot: it.goods_image_snapshot,
          price: Number(it.unit_price_snapshot).toFixed(2),
          unit_price_snapshot: Number(it.unit_price_snapshot).toFixed(2),
          quantity: it.quantity
        })),
        created_at: r.created_at
      });
    }
    ok(res, { list, total: count, page, page_size: pageSize });
  } catch (err) {
    console.error('[market/orders/list]', err);
    fail(res, '获取订单列表失败', 500);
  }
};

// GET /market/orders/:orderNo
exports.getOrderDetail = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    if (!orderNo) return fail(res, '缺少订单号');
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    const items = await MarketOrderItem.findAll({ where: { order_no: orderNo } });
    const shop = await MerchantShop.findByPk(row.shop_id);
    ok(res, {
      order: {
        id: row.id,
        orderNo: row.order_no,
        order_no: row.order_no,
        status: row.order_status,
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
        created_at: row.created_at,
        paid_at: row.paid_at,
        delivery_time: row.delivered_at
      },
      shop: shop ? { id: shop.id, name: shop.name, contact_phone: shop.contact_phone } : null,
      items: items.map((it) => ({
        id: it.goods_id,
        goods_id: it.goods_id,
        name: it.goods_name_snapshot,
        goods_name_snapshot: it.goods_name_snapshot,
        image: it.goods_image_snapshot,
        goods_image_snapshot: it.goods_image_snapshot,
        price: Number(it.unit_price_snapshot).toFixed(2),
        unit_price_snapshot: Number(it.unit_price_snapshot).toFixed(2),
        quantity: it.quantity
      })),
      fulfillment_events: [],
      delivery: await (async () => {
        try {
          const deliverySvc = require('../../../services/marketDelivery.service');
          return await deliverySvc.getDeliveryView(orderNo);
        } catch (e) {
          return { has_delivery: false, timeline: [] };
        }
      })()
    });
  } catch (err) {
    console.error('[market/orders/detail]', err);
    fail(res, '获取订单详情失败', 500);
  }
};

// POST /market/orders/:orderNo/cancel
exports.cancelOrder = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) {
      await t.rollback();
      return fail(res, '未登录', 401);
    }
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({
      where: { order_no: orderNo, user_id: userId },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!row) {
      await t.rollback();
      return fail(res, '订单不存在', 404);
    }
    if (!['pending_payment', 'pending_accept'].includes(String(row.order_status))) {
      await t.rollback();
      return fail(res, '当前状态不可取消');
    }
    const items = await MarketOrderItem.findAll({ where: { order_no: orderNo }, transaction: t });
    for (const it of items) {
      await MerchantGoods.increment('stock', { by: Number(it.quantity), where: { id: it.goods_id }, transaction: t });
      await MerchantGoods.increment('sales_count', { by: -Number(it.quantity), where: { id: it.goods_id }, transaction: t });
    }
    const nextPayStatus = row.pay_status === 'paid' ? 'refunded' : row.pay_status;
    if (row.pay_status === 'paid') {
      await orderPoints.revokePointsOnOrderRefund(MarketOrder, row, t);
      try { await commissionService.revertCommission(row.order_no); } catch (ce) { console.warn('[market/commission-revert]', ce.message); }
    }
    await row.update({
      order_status: row.pay_status === 'paid' ? 'refunded' : 'cancelled',
      pay_status: nextPayStatus,
      cancelled_at: new Date(),
      cancel_reason: String((req.body || {}).reason || 'user_cancel')
    }, { transaction: t });
    await t.commit();
    ok(res, { order_no: row.order_no, order_status: row.order_status, pay_status: row.pay_status }, '订单已取消');
  } catch (err) {
    await t.rollback();
    console.error('[market/orders/cancel]', err);
    fail(res, '取消订单失败', 500);
  }
};

// DELETE /market/orders/:orderNo
exports.deleteOrder = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['completed', 'cancelled', 'refunded'].includes(String(row.order_status))) {
      return fail(res, '仅已完成/已取消/已退款订单可删除');
    }
    await row.destroy();
    ok(res, { order_no: orderNo, deleted: true }, '删除成功');
  } catch (err) {
    console.error('[market/orders/delete]', err);
    fail(res, '删除订单失败', 500);
  }
};

// POST /market/orders/:orderNo/buy-again
exports.buyAgain = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const order = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!order) return fail(res, '订单不存在', 404);
    const items = await MarketOrderItem.findAll({ where: { order_no: orderNo } });
    for (const it of items) {
      const old = await MarketCartItem.findOne({ where: { user_id: userId, shop_id: order.shop_id, goods_id: it.goods_id } });
      if (old) await old.update({ quantity: Math.min(old.quantity + Number(it.quantity), 999) });
      else await MarketCartItem.create({ user_id: userId, shop_id: order.shop_id, goods_id: it.goods_id, quantity: Math.min(Number(it.quantity), 999) });
    }
    ok(res, { order_no: orderNo, added: items.length }, '已加入购物车');
  } catch (err) {
    console.error('[market/orders/buy-again]', err);
    fail(res, '再来一单失败', 500);
  }
};

// GET /market/orders/:orderNo/logistics
exports.getLogistics = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    const delivery = require('../../../services/marketDelivery.service');
    const view = await delivery.getDeliveryView(orderNo);
    const brand = view.brand || (view.provider_name || '配送');
    ok(res, {
      order_no: orderNo,
      company: view.has_delivery ? brand : '社区配送',
      tracking_no: view.external_order_no || `LOCAL-${orderNo}`,
      status: row.order_status,
      delivery: view,
      timeline: view.timeline || []
    });
  } catch (err) {
    console.error('[market/orders/logistics]', err);
    fail(res, '获取物流失败', 500);
  }
};

// POST /market/payments/create
exports.createPayment = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String((req.body || {}).order_no || '').trim();
    if (!orderNo) return fail(res, '缺少 order_no');
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    if (row.order_status !== 'pending_payment') return fail(res, '订单状态不可支付');
    ok(res, {
      order_no: orderNo,
      out_trade_no: `PAY${Date.now()}`,
      timeStamp: `${Math.floor(Date.now() / 1000)}`,
      nonceStr: `ns_${Date.now()}`,
      package: `prepay_id=mock_${Date.now()}`,
      signType: 'MD5',
      paySign: 'mock-signature'
    });
  } catch (err) {
    console.error('[market/payments/create]', err);
    fail(res, '创建支付失败', 500);
  }
};

// GET /market/payments/status
exports.getPaymentStatus = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.query.order_no || '').trim();
    if (!orderNo) return fail(res, '缺少 order_no');
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    ok(res, { order_no: orderNo, pay_status: row.pay_status, order_status: row.order_status });
  } catch (err) {
    console.error('[market/payments/status]', err);
    fail(res, '查询支付状态失败', 500);
  }
};

// POST /market/payments/mock-success
exports.mockPaymentSuccess = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String((req.body || {}).order_no || '').trim();
    if (!orderNo) return fail(res, '缺少 order_no');
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    if (row.order_status !== 'pending_payment') return fail(res, '当前订单不可模拟支付');
    await row.update({ pay_status: 'paid', order_status: 'pending_accept', paid_at: new Date() });
    await row.reload();
    await orderPoints.grantPointsOnOrderPaid(MarketOrder, row, null);
    try {
      const payAmount = Number(row.payable_amount || row.pay_amount || row.total_amount || row.amount || 0);
      const pool = Number(row.platform_fee_amount || 0);
      if (payAmount > 0 && pool > 0) {
        await commissionService.distributeCommission(row.order_no, 'market', payAmount, userId, pool);
      } else if (payAmount > 0) {
        await commissionService.distributeCommission(row.order_no, 'market', payAmount, userId);
      }
    } catch (ce) { console.warn('[market/commission]', ce.message); }
    ok(res, { order_no: row.order_no, pay_status: row.pay_status, order_status: row.order_status }, '支付成功');
  } catch (err) {
    console.error('[market/payments/mock-success]', err);
    fail(res, '模拟支付失败', 500);
  }
};

// POST /market/orders/:orderNo/confirm-receipt
exports.confirmReceipt = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    if (row.order_status !== 'pending_receipt') return fail(res, '当前状态不可确认收货');
    await row.update({ order_status: 'completed', completed_at: new Date() });
  await row.reload();
  try {
    await orderSettlement.settleMarketOrder(row);
  } catch (se) {
    console.warn('[market/confirm-receipt/settlement]', se.message);
  }
    ok(res, { order_no: orderNo, order_status: row.order_status }, '确认收货成功');
  } catch (err) {
    console.error('[market/orders/confirm-receipt]', err);
    fail(res, '确认收货失败', 500);
  }
};

// POST /market/orders/:orderNo/refund
exports.applyRefund = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['pending_accept', 'pending_service', 'pending_receipt'].includes(String(row.order_status))) {
      return fail(res, '当前状态不可申请退款');
    }
    const reason = String((req.body || {}).reason || '').trim() || '用户申请退款';
    let refund = await MarketRefundOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (refund) {
      await refund.update({ status: 'pending', reason });
    } else {
      refund = await MarketRefundOrder.create({
        order_no: orderNo,
        user_id: userId,
        shop_id: row.shop_id,
        status: 'pending',
        reason,
        amount: row.payable_amount
      });
    }
    await row.update({ pay_status: 'refund_pending' });
    ok(res, { order_no: orderNo, refund_status: 'pending', refund_id: refund.id }, '已提交退款申请');
  } catch (err) {
    console.error('[market/orders/refund/apply]', err);
    fail(res, '申请退款失败', 500);
  }
};

// GET /market/orders/:orderNo/refund
exports.getRefundDetail = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const row = await MarketRefundOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!row) return fail(res, '退款记录不存在', 404);
    ok(res, {
      id: row.id,
      order_no: row.order_no,
      status: row.status,
      reason: row.reason,
      amount: Number(row.amount).toFixed(2),
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  } catch (err) {
    console.error('[market/orders/refund/detail]', err);
    fail(res, '获取退款详情失败', 500);
  }
};

// POST /market/orders/:orderNo/refund/cancel
exports.cancelRefund = async (req, res) => {
  try {
    await ensureMarketTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const orderNo = String(req.params.orderNo || '').trim();
    const refund = await MarketRefundOrder.findOne({ where: { order_no: orderNo, user_id: userId } });
    if (!refund) return fail(res, '退款记录不存在', 404);
    if (refund.status !== 'pending') return fail(res, '当前退款状态不可撤销');
    await refund.update({ status: 'cancelled' });
    await MarketOrder.update({ pay_status: 'paid' }, { where: { order_no: orderNo, user_id: userId, pay_status: 'refund_pending' } });
    ok(res, { order_no: orderNo, refund_status: 'cancelled' }, '已撤销退款申请');
  } catch (err) {
    console.error('[market/orders/refund/cancel]', err);
    fail(res, '撤销退款失败', 500);
  }
};

// ===== 兼容接口：GET /market/shop/goods（商家视角，返回全部商品含下架）=====
exports.getShopGoodsCompat = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    // 查找当前用户的店铺
    const shop = await MerchantShop.findOne({
      where: { user_id: userId },
      order: [['created_at', 'DESC']]
    });
    if (!shop) return fail(res, '暂无店铺信息', 404);

    // 支持前端传入 shop_id 做权限校验
    const qShopId = query.shop_id != null ? Number(query.shop_id) : (query.shopId != null ? Number(query.shopId) : null);
    if (qShopId && qShopId !== shop.id) {
      return fail(res, '无权查看该店铺商品', 403);
    }

    const where = { shop_id: shop.id };

    const { count, rows } = await MerchantGoods.findAndCountAll({
      where,
      order: [['sort_order', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map((r) => ({
        id: r.id,
        shop_id: r.shop_id,
        shopId: r.shop_id,
        name: r.name,
        title: r.title || r.name,
        main_image: r.main_image,
        image: r.main_image,
        price: Number(r.price),
        stock: r.stock,
        inventory: r.stock,
        safe_stock: r.safe_stock,
        low_stock_threshold: r.safe_stock,
        sales_count: r.sales_count,
        sales: r.sales_count,
        description: r.description,
        desc: r.description,
        status: r.status,
        is_published: r.is_published,
        published: r.is_published === 1,
        on_shelf: r.status === 'on_sale',
        created_at: r.created_at
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[market/shop/goods]', err);
    fail(res, '获取商品列表失败', 500);
  }
};

// ===== 管理后台：商家入驻审核 =====

// GET /market/admin/shops（管理后台用：列出所有待审核/已审核店铺）
exports.getAdminShopList = async (req, res) => {
  try {
    if (!isAdmin(req)) return fail(res, '无管理员权限', 403);
    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.name = { [db.Sequelize.Op.like]: `%${String(query.keyword).trim()}%` };
    }

    const { count, rows } = await MerchantShop.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        name: r.name,
        contact_name: r.contact_name,
        contact_phone: r.contact_phone,
        address: r.address,
        category: r.category,
        status: r.status,
        reject_reason: r.reject_reason,
        created_at: r.created_at
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[market/admin/shops]', err);
    fail(res, '获取店铺列表失败', 500);
  }
};

// POST /market/admin/shops/:id/review（审核店铺）
exports.reviewShop = async (req, res) => {
  try {
    if (!isAdmin(req)) return fail(res, '无管理员权限', 403);
    const id = Number(req.params.id);
    if (!id) return fail(res, '无效店铺ID');

    const body = req.body || {};
    const status = body.status;
    if (!status || !['approved', 'rejected'].includes(status)) {
      return fail(res, '审核状态必须是 approved 或 rejected');
    }

    const shop = await MerchantShop.findByPk(id);
    if (!shop) return fail(res, '店铺不存在', 404);

    await shop.update({
      status,
      reject_reason: status === 'rejected' ? (body.reject_reason || '') : ''
    });

    ok(res, { id: shop.id, status: shop.status }, '审核完成');
  } catch (err) {
    console.error('[market/admin/shops/review]', err);
    fail(res, '审核失败', 500);
  }
};
