#!/usr/bin/env node
/** 内部联调：对指定订单发起 Mock 美团配送 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), override: true, quiet: true });

const db = require('../src/models');
const delivery = require('../src/services/marketDelivery.service');

async function main() {
  const orderNo = process.argv[2] || 'MK17811895229814312';
  process.env.DELIVERY_MOCK = process.env.DELIVERY_MOCK || '1';

  const order = await db.MarketOrder.findOne({ where: { order_no: orderNo } });
  if (!order) throw new Error('订单不存在: ' + orderNo);

  let shop = null;
  if (db.MerchantShop) shop = await db.MerchantShop.findByPk(order.shop_id);
  if (!shop && db.MarketShop) shop = await db.MarketShop.findByPk(order.shop_id);
  if (!shop) throw new Error('店铺不存在: ' + order.shop_id);

  const providers = await delivery.listProviderOptionsForShop(order.delivery_mode, shop.id);
  console.log('[e2e] providers:', JSON.stringify(providers, null, 2));

  const job = await delivery.launchDelivery(order, shop, 'meituan');
  console.log('[e2e] job created:', {
    id: job.id,
    provider: job.provider,
    external_order_no: job.external_order_no,
    job_status: job.job_status
  });

  const view = await delivery.getDeliveryView(orderNo);
  console.log('[e2e] delivery view:', JSON.stringify(view, null, 2));

  const refreshed = await db.MarketOrder.findOne({ where: { order_no: orderNo } });
  console.log('[e2e] order delivery fields:', {
    delivery_carrier: refreshed.delivery_carrier,
    delivery_job_status: refreshed.delivery_job_status,
    delivery_external_no: refreshed.delivery_external_no
  });

  await db.sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
