'use strict';

const { MarketCartItem, MarketGood, MarketShop } = require('../models');

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data };
}

function mapCartGoods(g) {
  if (!g) return null;
  const onSale = g.status === 'on_sale';
  return {
    id: g.id,
    name: g.name,
    title: g.name,
    image: g.main_image,
    main_image: g.main_image,
    price: String(g.price),
    stock: g.stock,
    status: g.status,
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

// GET /api/v1/market/cart/summary
exports.getCartSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await MarketCartItem.findAll({
      where: { user_id: userId },
      attributes: ['quantity', 'shop_id']
    });
    const itemCount = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const shopIds = [...new Set(rows.map((r) => Number(r.shop_id)).filter(Boolean))];
    res.json(ok({ item_count: itemCount, sku_count: rows.length, shop_count: shopIds.length }));
  } catch (e) {
    console.error('getCartSummary error:', e);
    res.status(500).json({ code: 500, msg: '获取购物车数量失败', data: null });
  }
};

// GET /api/v1/market/cart?shop_id=xxx（shop_id 可选，不传则返回全店分组）
exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const shopId = parseInt(req.query.shop_id || req.query.shopId, 10) || 0;
    const where = { user_id: userId };
    if (shopId) where.shop_id = shopId;

    const rows = await MarketCartItem.findAll({ where, order: [['created_at', 'DESC']] });
    const goodsIds = [...new Set(rows.map((r) => Number(r.goods_id)).filter(Boolean))];
    const shopIds = [...new Set(rows.map((r) => Number(r.shop_id)).filter(Boolean))];
    const [goodsRows, shopRows] = await Promise.all([
      goodsIds.length ? MarketGood.findAll({ where: { id: goodsIds } }) : [],
      shopIds.length ? MarketShop.findAll({ where: { id: shopIds } }) : []
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
            shop_logo: shop && (shop.logo_url || shop.cover_url) ? (shop.logo_url || shop.cover_url) : '',
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

    res.json(ok({
      list,
      groups,
      summary: {
        item_count: itemCount,
        sku_count: list.length,
        shop_count: shopId ? 1 : shopIds.length
      }
    }));
  } catch (e) {
    console.error('getCart error:', e);
    res.status(500).json({ code: 500, msg: '获取购物车失败', data: null });
  }
};

// POST /api/v1/market/cart/items  { shop_id, goods_id, quantity }
exports.addItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shop_id, goods_id, quantity = 1 } = req.body;
    if (!shop_id || !goods_id) {
      return res.status(400).json({ code: 400, msg: '缺少 shop_id 或 goods_id', data: null });
    }
    const goods = await MarketGood.findByPk(goods_id);
    if (!goods || goods.shop_id !== Number(shop_id) || goods.status !== 'on_sale') {
      return res.status(404).json({ code: 20011, msg: '商品不存在或已下架', data: null });
    }
    const [item, created] = await MarketCartItem.findOrCreate({
      where: { user_id: userId, shop_id, goods_id },
      defaults: { quantity, checked: 1 }
    });
    if (!created) {
      item.quantity = Math.min(Number(item.quantity) + Number(quantity), 999);
      await item.save();
    }
    res.json(ok(item, '加入购物车成功'));
  } catch (e) {
    console.error('addItem error:', e);
    res.status(500).json({ code: 500, msg: '加入购物车失败', data: null });
  }
};

// PUT /api/v1/market/cart/items/:itemId { quantity }
exports.updateItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quantity } = req.body;
    if (quantity == null || quantity < 0) {
      return res.status(400).json({ code: 400, msg: 'quantity 非法', data: null });
    }
    const item = await MarketCartItem.findByPk(req.params.itemId);
    if (!item || item.user_id !== userId) {
      return res.status(404).json({ code: 404, msg: '购物车项不存在', data: null });
    }
    if (quantity === 0) {
      await item.destroy();
      return res.json(ok({ id: item.id, deleted: true }));
    }
    item.quantity = Math.min(Number(quantity), 999);
    await item.save();
    res.json(ok({ id: item.id, quantity: item.quantity }, '更新成功'));
  } catch (e) {
    console.error('updateItem error:', e);
    res.status(500).json({ code: 500, msg: '更新购物车失败', data: null });
  }
};

// DELETE /api/v1/market/cart/items/:itemId
exports.deleteItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const item = await MarketCartItem.findByPk(req.params.itemId);
    if (!item || item.user_id !== userId) {
      return res.status(404).json({ code: 404, msg: '购物车项不存在', data: null });
    }
    await item.destroy();
    res.json(ok({ id: item.id, deleted: true }, '删除成功'));
  } catch (e) {
    console.error('deleteItem error:', e);
    res.status(500).json({ code: 500, msg: '删除购物车失败', data: null });
  }
};

// DELETE /api/v1/market/cart?shop_id=xxx（shop_id 可选，不传则清空全部）
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const shopId = parseInt(req.query.shop_id || req.query.shopId, 10) || 0;
    const where = { user_id: userId };
    if (shopId) where.shop_id = shopId;
    const deleted = await MarketCartItem.destroy({ where });
    res.json(ok({ cleared: true, deleted_count: deleted, shop_id: shopId || null }, shopId ? '已清空该店购物车' : '已清空全部购物车'));
  } catch (e) {
    console.error('clearCart error:', e);
    res.status(500).json({ code: 500, msg: '清空购物车失败', data: null });
  }
};
