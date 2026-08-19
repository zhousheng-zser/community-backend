#!/usr/bin/env node
/**
 * 为店铺绑定聚合配送平台门店 ID（首店联调：测试店铺）
 *
 * 用法:
 *   node scripts/bind-test-shop-delivery.js --shop-no TEST001 --provider meituan --mock
 *   node scripts/bind-test-shop-delivery.js --shop-no TEST001 --provider meituan --external-shop-id test_0001
 *   node scripts/bind-test-shop-delivery.js --shop-name 测试店铺 --provider meituan --register
 */
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true
});

const db = require('../src/models');
const shopBinding = require('../src/services/shopDeliveryBinding.service');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mock') out.mock = true;
    else if (a === '--register') out.register = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function findShop(args) {
  const MarketShop = db.MarketShop;
  const MerchantShop = db.MerchantShop;
  const where = {};
  if (args.shop_no) {
    if (MarketShop) {
      const row = await MarketShop.findOne({ where: { shop_no: args.shop_no } });
      if (row) return row;
    }
  }
  if (args.shop_name) {
    if (MerchantShop) {
      const row = await MerchantShop.findOne({ where: { name: args.shop_name } });
      if (row) return row;
    }
    if (MarketShop) {
      const row = await MarketShop.findOne({ where: { name: args.shop_name } });
      if (row) return row;
    }
  }
  if (args.shop_id) {
    if (MerchantShop) {
      const row = await MerchantShop.findByPk(Number(args.shop_id));
      if (row) return row;
    }
    if (MarketShop) {
      const row = await MarketShop.findByPk(Number(args.shop_id));
      if (row) return row;
    }
  }
  return null;
}

async function ensureShopGeo(shop) {
  const lat = shop.latitude != null ? Number(shop.latitude) : null;
  const lng = shop.longitude != null ? Number(shop.longitude) : null;
  const phone = shop.contact_phone || shop.phone || '';
  const address = shop.address || '';

  if (Number.isFinite(lat) && Number.isFinite(lng) && phone && address && address.length >= 5) {
    return shop;
  }

  const patch = {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    patch.latitude = 31.1694;
    patch.longitude = 121.3783;
  }
  if (!phone) patch.contact_phone = '13800000000';
  if (!address || address.length < 5) {
    patch.address = '上海市闵行区合川路地铁站附近（测试店铺联调）';
  }
  if (Object.keys(patch).length) {
    await shop.update(patch);
    console.log('[bind] 已补全店铺坐标/电话/地址:', patch);
    return shop.reload();
  }
  return shop;
}

async function main() {
  const args = parseArgs(process.argv);
  const provider = String(args.provider || 'meituan').trim();

  await db.sequelize.authenticate();
  await shopBinding.ensureBindingTable();

  const shop = await findShop(args);
  if (!shop) {
    console.error('未找到店铺，请指定 --shop-no TEST001 或 --shop-name 测试店铺');
    process.exit(1);
  }

  await ensureShopGeo(shop);
  shopBinding.validateShopForDelivery(shop);

  console.log(`[bind] 店铺 id=${shop.id} name=${shop.name || shop.shop_name} provider=${provider}`);

  let binding;
  if (args.mock) {
    binding = await shopBinding.bindMockShop(shop, provider);
    console.log(`[bind] Mock 绑定成功 external_shop_id=${binding.external_shop_id}`);
  } else if (args.register) {
    if (provider !== 'meituan') {
      throw new Error('当前仅支持 --register 注册美团门店');
    }
    const result = await shopBinding.registerShopOnMeituan(shop);
    binding = result.binding;
    console.log(`[bind] 美团 shop/create 成功 external_shop_id=${result.external_shop_id}`);
  } else {
    const externalShopId = String(args.external_shop_id || 'test_0001').trim();
    if (provider === 'meituan') {
      binding = await shopBinding.bindMeituanTestShop(shop, externalShopId);
    } else {
      binding = await shopBinding.upsertBinding(shop.id, provider, {
        external_shop_id: externalShopId,
        status: 'active',
        bind_payload_json: { source: 'cli_bind', external_shop_id: externalShopId }
      });
    }
    console.log(`[bind] 绑定成功 external_shop_id=${binding.external_shop_id}`);
  }

  const view = await shopBinding.getBindingsView(shop.id);
  console.log(JSON.stringify({ shop_id: shop.id, binding: shopBinding.bindingToView(binding), bindings: view }, null, 2));

  await db.sequelize.close();
}

main().catch((e) => {
  console.error('[bind-test-shop-delivery]', e.message);
  process.exit(1);
});
